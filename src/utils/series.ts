import type { Snapshot } from "../types/index.js";

export const HOUR_MS = 3_600_000;

export interface HourlyPoint {
  readonly hour: number;
  readonly value: number;
  readonly observedAt: number;
  readonly source: "steam" | "steamcharts";
}

export function normalizeHourly(snapshots: readonly Snapshot[], now = Number.POSITIVE_INFINITY): readonly HourlyPoint[] {
  const groups = new Map<number, Snapshot[]>();
  for (const snapshot of snapshots) {
    if (snapshot.ts > now || !isQualifiedSnapshot(snapshot)) continue;
    const hour = Math.floor(snapshot.ts / HOUR_MS) * HOUR_MS;
    const group = groups.get(hour) ?? [];
    group.push(snapshot);
    groups.set(hour, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left - right).flatMap(([hour, samples]) => selectHour(hour, samples));
}

export function hourlyCoverage(points: readonly HourlyPoint[], start: number, end: number): number {
  const expected = Math.max(0, Math.ceil((end - start) / HOUR_MS));
  if (expected === 0) return 0;
  const covered = points.filter((point) => point.hour >= start && point.hour < end).length;
  return covered / expected;
}

export function isQualifiedSnapshot(snapshot: Snapshot): boolean {
  return (snapshot.source === "steam" && snapshot.granularity === "instant")
    || (snapshot.source === "steamcharts" && snapshot.granularity === "hourly");
}

function selectHour(hour: number, samples: readonly Snapshot[]): readonly HourlyPoint[] {
  const steam = samples.filter((sample) => sample.source === "steam" && sample.granularity === "instant");
  if (steam.length > 0 && hasLocalSupport(steam)) {
    return [{ hour, value: median(steam.map((sample) => sample.current)), observedAt: Math.max(...steam.map((sample) => sample.ts)), source: "steam" }];
  }
  const charts = samples.filter((sample) => sample.source === "steamcharts" && sample.granularity === "hourly");
  if (charts.length === 0) return [];
  const latest = charts.reduce((current, sample) => sample.ts > current.ts ? sample : current);
  return [{ hour, value: latest.current, observedAt: latest.ts, source: "steamcharts" }];
}

function hasLocalSupport(samples: readonly Snapshot[]): boolean {
  if (samples.length < 2) return false;
  const ordered = [...samples].sort((left, right) => left.ts - right.ts);
  const first = ordered[0]?.ts ?? 0;
  const last = ordered.at(-1)?.ts ?? 0;
  if (last - first < 45 * 60_000) return false;
  return ordered.every((sample, index) => index === 0 || sample.ts - (ordered[index - 1]?.ts ?? sample.ts) <= 15 * 60_000);
}

export function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length === 0) return 0;
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle] ?? 0;
}
