// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/sparkline.ts
// Generates an inline SVG sparkline from snapshot data.
// Pure function — no side effects, no DOM dependency, fully testable.
// ─────────────────────────────────────────────────────────────────────────────

import type { GraphWindowKey, GraphWindowOption, Snapshot } from "../types/index.js";
import { HOUR_MS, hourlyCoverage, isQualifiedSnapshot, normalizeHourly } from "./series.js";

export interface GraphSeriesPoint {
  readonly x: number;
  readonly y: number;
  readonly ts: number;
  readonly current: number;
}

export interface GraphSeries {
  readonly segments: readonly { readonly points: readonly GraphSeriesPoint[] }[];
  readonly startTs: number;
  readonly endTs: number;
  readonly coverage: number;
}

// ── Coordinate mapper (shared by SVG and Canvas renderers) ───────────────────

/**
 * Convert an array of player-count values to normalised {x, y} canvas/SVG
 * coordinates. Pure function — no side effects.
 *
 * @param values  Data series (must have ≥ 2 entries to be meaningful)
 * @param width   Total drawing width in pixels
 * @param height  Total drawing height in pixels
 * @param padX    Horizontal inset so strokes aren't clipped (default 2)
 * @param padY    Vertical inset so strokes aren't clipped (default 3)
 */
export function mapToPoints(
  values: readonly number[],
  width: number,
  height: number,
  padX = 2,
  padY = 3,
): Array<{ x: number; y: number }> {
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return values.map((v, i) => ({
    x: padX + (i / (values.length - 1)) * (width - padX * 2),
    y: range === 0 ? height / 2 : padY + ((max - v) / range) * (height - padY * 2),
  }));
}

export const GRAPH_WINDOW_MS = {
  "24h": 86_400_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
  "15d": 15 * 86_400_000,
  "1m": 30 * 86_400_000,
  all: 0,
} as const;

/**
 * Find the index of the nearest point in `points` to the given `mouseX`
 * SVG coordinate using binary search.
 *
 * - Returns 0 for empty arrays (safe default).
 * - Clamps to the first/last index when `mouseX` is out of range.
 */
export function findNearestPointIndex(mouseX: number, points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return 0;

  let lo = 0;
  let hi = points.length - 1;

  // Clamp
  if (mouseX <= (points[0]?.x ?? 0)) return 0;
  if (mouseX >= (points[hi]?.x ?? 0)) return hi;

  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if ((points[mid]?.x ?? 0) <= mouseX) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // lo and hi are adjacent — pick nearest
  const distLo = Math.abs((points[lo]?.x ?? 0) - mouseX);
  const distHi = Math.abs((points[hi]?.x ?? 0) - mouseX);
  return distLo <= distHi ? lo : hi;
}

export function filterSnapshotsByWindow(
  snapshots: readonly Snapshot[],
  windowMs: number,
  now = Date.now(),
): Snapshot[] {
  const cutoff = windowMs === 0 ? Number.NEGATIVE_INFINITY : now - windowMs;
  return snapshots.filter((snapshot) => snapshot.ts >= cutoff && snapshot.ts <= now);
}

export function hasEnoughGraphHistory(snapshots: readonly Snapshot[], windowMs: number, now = Date.now()): boolean {
  const start = windowMs === 0 ? Number.NEGATIVE_INFINITY : now - windowMs;
  return snapshots.some((point) => point.ts >= start && point.ts <= now && isQualifiedSnapshot(point));
}

export function buildGraphSeries(
  snapshots: readonly Snapshot[],
  windowMs: number,
  now: number,
  width: number,
  height: number,
  maxPoints = 200,
): GraphSeries {
  const qualified = deduplicateGraphSnapshots(snapshots, now);
  const endTs = windowMs === 0 ? (qualified.at(-1)?.ts ?? now) : now;
  const startTs = windowMs === 0 ? (qualified[0]?.ts ?? now) : now - windowMs;
  const window = qualified.filter((snapshot) => snapshot.ts >= startTs && snapshot.ts <= endTs);
  const normalized = normalizeHourly(window, now);
  const coverage =
    windowMs === 0
      ? hourlyCoverage(
          normalized,
          Math.floor(startTs / HOUR_MS) * HOUR_MS,
          Math.floor(endTs / HOUR_MS) * HOUR_MS + HOUR_MS,
        )
      : hourlyCoverage(normalized, Math.floor(startTs / HOUR_MS) * HOUR_MS, Math.floor(endTs / HOUR_MS) * HOUR_MS);
  const segments = downsampleSegments(splitGaps(window), maxPoints);
  const values = window.map((snapshot) => snapshot.current);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const span = Math.max(1, endTs - startTs);
  return {
    startTs,
    endTs,
    coverage,
    segments: segments.map((segment) => ({
      points: segment.map((snapshot) => ({
        ts: snapshot.ts,
        current: snapshot.current,
        x: ((snapshot.ts - startTs) / span) * width,
        y: range === 0 ? height / 2 : ((max - snapshot.current) / range) * height,
      })),
    })),
  };
}

export function buildAvailableGraphWindows(retentionDays: number): GraphWindowOption[] {
  const retentionMs = retentionDays * 86_400_000;
  const allWindows: Array<[GraphWindowKey, string]> = [
    ["24h", "24h"],
    ["3d", "3d"],
    ["7d", "7d"],
    ["15d", "15d"],
    ["1m", "1m"],
    ["all", "all"],
  ];

  return allWindows
    .filter(([key]) => {
      if (key === "all") return true; // always include "all"
      return retentionMs >= GRAPH_WINDOW_MS[key];
    })
    .map(([key, label]) => ({
      key,
      label,
      windowMs: GRAPH_WINDOW_MS[key],
    }));
}

/**
 * Determine the stroke colour based on the overall direction of the sparkline.
 * Rising → green, falling → red, flat → accent blue.
 */
function segmentColor(prev: number, next: number): string {
  if (prev <= 0) return next > 0 ? "#16a34a" : "#00c8ff";
  const pct = ((next - prev) / prev) * 100;
  if (pct >= 8) return "#16a34a";
  if (pct >= 2) return "#22c55e";
  if (pct <= -8) return "#dc2626";
  if (pct <= -2) return "#ef4444";
  return "#00c8ff";
}

/** Colors plotted intervals, independently of the seasonally adjusted trend. */
export function colorGraphSegments(series: GraphSeries): Array<{ points: GraphSeriesPoint[]; color: string }> {
  const runs: Array<{ points: GraphSeriesPoint[]; color: string }> = [];
  for (const segment of series.segments) {
    const first = segment.points[0];
    if (!first) continue;
    if (segment.points.length === 1) {
      runs.push({ points: [first], color: "#00c8ff" });
      continue;
    }
    let run: { points: GraphSeriesPoint[]; color: string } | undefined;
    for (const [index, point] of segment.points.entries()) {
      const previous = segment.points[index - 1];
      if (!previous) continue;
      const color = segmentColor(previous.current, point.current);
      if (run?.color === color) run.points.push(point);
      else {
        run = { points: [previous, point], color };
        runs.push(run);
      }
    }
  }
  return runs;
}

function deduplicateGraphSnapshots(snapshots: readonly Snapshot[], now: number): Snapshot[] {
  const byTimestamp = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.ts > now || snapshot.aggregate !== undefined || !isQualifiedSnapshot(snapshot)) continue;
    const previous = byTimestamp.get(snapshot.ts);
    if (previous === undefined || (snapshot.source === "steam" && previous.source !== "steam"))
      byTimestamp.set(snapshot.ts, snapshot);
  }
  return [...byTimestamp.values()].sort((left, right) => left.ts - right.ts);
}

function splitGaps(snapshots: readonly Snapshot[]): Snapshot[][] {
  const segments: Snapshot[][] = [];
  for (const snapshot of snapshots) {
    const current = segments.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || snapshot.ts - previous.ts > 2 * HOUR_MS) segments.push([snapshot]);
    else current.push(snapshot);
  }
  return segments;
}

function downsampleSegments(segments: readonly (readonly Snapshot[])[], maxPoints: number): Snapshot[][] {
  const entries = segments.flatMap((segment, segmentIndex) =>
    segment.map((snapshot, index) => ({ snapshot, segmentIndex, index })),
  );
  const limit = Math.max(0, Math.floor(maxPoints));
  if (entries.length <= limit) return segments.map((segment) => [...segment]);
  if (limit === 0) return [];
  const selected = new Set<number>();
  const first = entries[0];
  const last = entries.at(-1);
  if (first) selected.add(0);
  if (last && limit > 1) selected.add(entries.length - 1);
  const minimum = entries.reduce(
    (best, entry, index) =>
      entry.snapshot.current < (entries[best]?.snapshot.current ?? entry.snapshot.current) ? index : best,
    0,
  );
  const maximum = entries.reduce(
    (best, entry, index) =>
      entry.snapshot.current > (entries[best]?.snapshot.current ?? entry.snapshot.current) ? index : best,
    0,
  );
  for (const index of [minimum, maximum]) {
    if (selected.size < limit) selected.add(index);
  }
  const buckets = Math.floor((limit - selected.size) / 2);
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor((bucket * entries.length) / buckets);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * entries.length) / buckets));
    const range = entries.slice(start, end);
    const low = range.reduce(
      (best, entry, offset) =>
        entry.snapshot.current < (range[best]?.snapshot.current ?? entry.snapshot.current) ? offset : best,
      0,
    );
    const high = range.reduce(
      (best, entry, offset) =>
        entry.snapshot.current > (range[best]?.snapshot.current ?? entry.snapshot.current) ? offset : best,
      0,
    );
    if (selected.size < limit) selected.add(start + low);
    if (selected.size < limit) selected.add(start + high);
  }
  for (let index = 0; selected.size < limit && index < entries.length; index += 1)
    selected.add(Math.floor((index * entries.length) / limit));
  const result = new Map<number, Snapshot[]>();
  for (const index of [...selected].sort((left, right) => left - right)) {
    const entry = entries[index];
    if (!entry) continue;
    const segment = result.get(entry.segmentIndex) ?? [];
    segment.push(entry.snapshot);
    result.set(entry.segmentIndex, segment);
  }
  return [...result.entries()].sort(([left], [right]) => left - right).map(([, segment]) => segment);
}
