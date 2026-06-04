// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/sparkline.ts
// Generates an inline SVG sparkline from snapshot data.
// Pure function — no side effects, no DOM dependency, fully testable.
// ─────────────────────────────────────────────────────────────────────────────

import type { GraphWindowKey, GraphWindowOption, Snapshot } from "../types/index.js";

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
    y: range === 0
      ? height / 2
      : padY + ((max - v) / range) * (height - padY * 2),
  }));
}

export const GRAPH_WINDOW_MS = {
  "24h": 86_400_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
  "15d": 15 * 86_400_000,
  "1m": 30 * 86_400_000,
  "all": 0,
} as const;

/**
 * Find the index of the nearest point in `points` to the given `mouseX`
 * SVG coordinate using binary search.
 *
 * - Returns 0 for empty arrays (safe default).
 * - Clamps to the first/last index when `mouseX` is out of range.
 */
export function findNearestPointIndex(
  mouseX: number,
  points: ReadonlyArray<{ x: number; y: number }>,
): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return 0;

  let lo = 0;
  let hi = points.length - 1;

  // Clamp
  if (mouseX <= points[0]!.x) return 0;
  if (mouseX >= points[hi]!.x) return hi;

  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.x <= mouseX) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // lo and hi are adjacent — pick nearest
  const distLo = Math.abs(points[lo]!.x - mouseX);
  const distHi = Math.abs(points[hi]!.x - mouseX);
  return distLo <= distHi ? lo : hi;
}


export function filterSnapshotsByWindow(
  snapshots: readonly Snapshot[],
  windowMs: number,
): Snapshot[] {
  if (windowMs === 0) return [...snapshots]; // "all" window = no time filter
  const cutoff = Date.now() - windowMs;
  return snapshots.filter((snapshot) => snapshot.ts >= cutoff);
}

export function downsampleSnapshotsForGraph(
  snapshots: readonly Snapshot[],
  maxPoints: number,
): Snapshot[] {
  if (snapshots.length <= maxPoints) return [...snapshots];
  if (maxPoints < 2) return snapshots.length > 0 ? [snapshots[snapshots.length - 1]!] : [];

  const lastIndex = snapshots.length - 1;
  const step = lastIndex / (maxPoints - 1);
  const indexes = new Set<number>([0, lastIndex]);

  for (let i = 1; i < maxPoints - 1; i++) {
    indexes.add(Math.round(i * step));
  }

  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => snapshots[index]!)
    .filter(Boolean);
}

export function hasEnoughGraphHistory(
  snapshots: readonly Snapshot[],
  windowMs: number,
): boolean {
  const filtered = filterSnapshotsByWindow(snapshots, windowMs);
  if (filtered.length < 6) return false;
  if (windowMs === 0) return true; // "all" window requires only ≥6 snapshots
  const span = (filtered.at(-1)?.ts ?? 0) - (filtered[0]?.ts ?? 0);
  return span >= windowMs * 0.75;
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
export function sparklineColor(snapshots: readonly Snapshot[]): string {
  if (snapshots.length < 2) return "#00c8ff";
  const first = snapshots[0]!.current;
  const last  = snapshots[snapshots.length - 1]!.current;
  if (last > first * 1.02) return "#22c55e";   // up
  if (last < first * 0.98) return "#ef4444";   // down
  return "#00c8ff";                             // flat
}

function segmentColor(prev: number, next: number): string {
  if (prev <= 0) return "#00c8ff";
  const pct = ((next - prev) / prev) * 100;
  if (pct >= 8) return "#16a34a";
  if (pct >= 2) return "#22c55e";
  if (pct <= -8) return "#dc2626";
  if (pct <= -2) return "#ef4444";
  return "#00c8ff";
}
