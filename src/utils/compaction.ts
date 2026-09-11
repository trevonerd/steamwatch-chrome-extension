import type { Snapshot, SnapshotAggregate, SnapshotSource } from "../types/index.js";
import { idbTransformSnapshotsAtomically } from "./idb-storage.js";

const DAY_MS = 86_400_000;

interface AggregateAccumulator {
  sum: number;
  sampleCount: number;
  min: number;
  max: number;
  minTs: number;
  maxTs: number;
  startTs: number;
  endTs: number;
  observedDurationMs: number;
  sources: Set<SnapshotSource>;
  lastRawTs?: number;
  lastRawSource?: SnapshotSource;
  lastRawGranularity?: Snapshot["granularity"];
}

function startOfDay(ts: number): number {
  const date = new Date(ts);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfWeek(ts: number): number {
  const date = new Date(ts);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function aggregateOf(snapshot: Snapshot): SnapshotAggregate {
  return snapshot.aggregate ?? {
    startTs: snapshot.ts,
    endTs: snapshot.ts,
    sampleCount: 1,
    sum: snapshot.current,
    min: snapshot.current,
    max: snapshot.current,
    minTs: snapshot.ts,
    maxTs: snapshot.ts,
    observedDurationMs: 0,
  };
}

function addToAccumulator(accumulator: AggregateAccumulator, snapshot: Snapshot): void {
  const aggregate = aggregateOf(snapshot);
  accumulator.sum += aggregate.sum;
  accumulator.sampleCount += aggregate.sampleCount;
  accumulator.startTs = Math.min(accumulator.startTs, aggregate.startTs);
  accumulator.endTs = Math.max(accumulator.endTs, aggregate.endTs);
  accumulator.observedDurationMs += aggregate.observedDurationMs;
  accumulator.sources.add(snapshot.source ?? "legacy");
  if (aggregate.min < accumulator.min) {
    accumulator.min = aggregate.min;
    accumulator.minTs = aggregate.minTs;
  }
  if (aggregate.max > accumulator.max) {
    accumulator.max = aggregate.max;
    accumulator.maxTs = aggregate.maxTs;
  }
  addObservedGap(accumulator, snapshot);
}

function maxObservedGap(granularity: Snapshot["granularity"]): number {
  if (granularity === "instant") return 5 * 60_000;
  if (granularity === "hourly") return 60 * 60_000;
  return 0;
}

function addObservedGap(accumulator: AggregateAccumulator, snapshot: Snapshot): void {
  if (snapshot.aggregate) return;
  const source = snapshot.source ?? "legacy";
  const maxGap = maxObservedGap(snapshot.granularity);
  if (
    accumulator.lastRawTs !== undefined
    && accumulator.lastRawSource === source
    && accumulator.lastRawGranularity === snapshot.granularity
  ) {
    const gap = snapshot.ts - accumulator.lastRawTs;
    if (gap > 0 && gap <= maxGap) accumulator.observedDurationMs += gap;
  }
  accumulator.lastRawTs = snapshot.ts;
  accumulator.lastRawSource = source;
  accumulator.lastRawGranularity = snapshot.granularity;
}

function sourceFor(accumulator: AggregateAccumulator): SnapshotSource {
  if (accumulator.sources.size !== 1) return "legacy";
  const [source] = accumulator.sources;
  return source ?? "legacy";
}

function groupSnapshots(
  snapshots: readonly Snapshot[],
  keyFor: (ts: number) => number,
  granularity: "daily" | "weekly",
): Snapshot[] {
  const grouped = new Map<number, AggregateAccumulator>();
  for (const snapshot of [...snapshots].sort((left, right) => left.ts - right.ts)) {
    const key = keyFor(snapshot.ts);
    const aggregate = aggregateOf(snapshot);
    const accumulator = grouped.get(key);
    if (accumulator) {
      addToAccumulator(accumulator, snapshot);
      continue;
    }
    grouped.set(key, {
      sum: aggregate.sum,
      sampleCount: aggregate.sampleCount,
      min: aggregate.min,
      max: aggregate.max,
      minTs: aggregate.minTs,
      maxTs: aggregate.maxTs,
      startTs: aggregate.startTs,
      endTs: aggregate.endTs,
      observedDurationMs: aggregate.observedDurationMs,
      sources: new Set([snapshot.source ?? "legacy"]),
      ...(snapshot.aggregate ? {} : {
        lastRawTs: snapshot.ts,
        lastRawSource: snapshot.source ?? "legacy",
        lastRawGranularity: snapshot.granularity,
      }),
    });
  }

  return [...grouped.entries()]
    .map(([ts, accumulator]) => ({
      ts,
      current: Math.round(accumulator.sum / accumulator.sampleCount),
      source: sourceFor(accumulator),
      granularity,
      aggregate: {
        startTs: accumulator.startTs,
        endTs: accumulator.endTs,
        sampleCount: accumulator.sampleCount,
        sum: accumulator.sum,
        min: accumulator.min,
        max: accumulator.max,
        minTs: accumulator.minTs,
        maxTs: accumulator.maxTs,
        observedDurationMs: accumulator.observedDurationMs,
      },
    }))
    .sort((left, right) => left.ts - right.ts);
}

function compactSeries(
  allSnapshots: readonly Snapshot[],
  fullResolutionDays: number,
  now: number,
): Snapshot[] {
  if (allSnapshots.length === 0) return [];

  const opaqueSnapshots = allSnapshots.filter((snapshot) => (
    snapshot.granularity === "monthly-peak" || snapshot.granularity === "unknown"
  ));
  const observations = allSnapshots.filter((snapshot) => (
    snapshot.granularity !== "monthly-peak" && snapshot.granularity !== "unknown"
  ));
  if (observations.length === 0) return [...opaqueSnapshots];

  const mediumBoundary = now - fullResolutionDays * DAY_MS;
  const oldBoundary = now - 90 * DAY_MS;
  const recent = observations.filter((snapshot) => snapshot.ts >= mediumBoundary);
  const medium = observations.filter((snapshot) => snapshot.ts < mediumBoundary && snapshot.ts >= oldBoundary);
  const old = observations.filter((snapshot) => snapshot.ts < oldBoundary);
  const compactedMedium = groupSnapshots(medium, startOfDay, "daily");
  const compactedOld = groupSnapshots(old, startOfWeek, "weekly");
  return [...opaqueSnapshots, ...recent, ...compactedMedium, ...compactedOld];
}

/** Compacts one game's observation tiers without exposing a partial series. */
export async function compactSnapshots(appId: string, fullResolutionDays: number): Promise<void> {
  const now = Date.now();
  await idbTransformSnapshotsAtomically(appId, (snapshots) => compactSeries(snapshots, fullResolutionDays, now));
}
