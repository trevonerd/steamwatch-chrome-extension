import type { Snapshot } from "../types/index.js";
import { idbDeleteSnapshots, idbGetSnapshots, idbSaveSnapshot } from "./idb-storage.js";

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function groupAndAverage(snaps: readonly Snapshot[], keyFn: (ts: number) => number): Snapshot[] {
  const grouped = new Map<number, { sum: number; count: number }>();

  for (const snap of snaps) {
    const key = keyFn(snap.ts);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { sum: snap.current, count: 1 });
      continue;
    }
    current.sum += snap.current;
    current.count += 1;
  }

  return Array.from(grouped.entries())
    .map(([ts, agg]) => ({ ts, current: Math.round(agg.sum / agg.count) }))
    .sort((a, b) => a.ts - b.ts);
}

function excludePreservedMinFromAlreadyCompactedTier(
  snaps: readonly Snapshot[],
  allTimeMin: Snapshot,
  keyFn: (ts: number) => number,
): Snapshot[] {
  const minKey = keyFn(allTimeMin.ts);
  const hasGroupAnchor = snaps.some((snap) => snap.ts === minKey);
  if (!hasGroupAnchor) {
    return [...snaps];
  }
  return snaps.filter((snap) => !(snap.ts === allTimeMin.ts && snap.current === allTimeMin.current));
}

export async function compactSnapshots(appId: string, fullResolutionDays: number): Promise<void> {
  const allSnaps = await idbGetSnapshots(appId);
  if (allSnaps.length === 0) {
    return;
  }

  const now = Date.now();
  const fullResMs = fullResolutionDays * DAY_MS;
  const mediumBoundary = now - fullResMs;
  const oldBoundary = now - 90 * DAY_MS;

  const allTimeMin = allSnaps.reduce((min, snap) => (snap.current < min.current ? snap : min));
  const recentSnaps = allSnaps.filter((s) => s.ts >= mediumBoundary);
  const mediumSnaps = allSnaps.filter((s) => s.ts < mediumBoundary && s.ts >= oldBoundary);
  const oldSnaps = allSnaps.filter((s) => s.ts < oldBoundary);

  const mediumForGrouping = excludePreservedMinFromAlreadyCompactedTier(mediumSnaps, allTimeMin, startOfDay);
  const oldForGrouping = excludePreservedMinFromAlreadyCompactedTier(oldSnaps, allTimeMin, startOfWeek);

  const compactedMedium = groupAndAverage(mediumForGrouping, startOfDay);
  const compactedOld = groupAndAverage(oldForGrouping, startOfWeek);

  await idbDeleteSnapshots(appId);

  const rebuilt = [...recentSnaps, ...compactedMedium, ...compactedOld].sort((a, b) => a.ts - b.ts);
  for (const snap of rebuilt) {
    await idbSaveSnapshot(appId, snap);
  }

  const hasAllTimeMin = rebuilt.some((snap) => snap.current === allTimeMin.current);
  if (!hasAllTimeMin) {
    await idbSaveSnapshot(appId, allTimeMin);
  }
}
