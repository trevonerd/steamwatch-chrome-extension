import type { EarlyActivity, Snapshot } from "../types/index.js";
import { HOUR_MS, isQualifiedSnapshot, type HourlyPoint } from "./series.js";

/** Descriptive context for limited history; never an input to trend alerts. */
export function buildEarlyActivity(snapshots: readonly Snapshot[], hourly: readonly HourlyPoint[], now: number): EarlyActivity {
  const valid = snapshots.filter((point) => point.ts <= now && isQualifiedSnapshot(point));
  const timestamps = valid.map((point) => point.ts);
  const latest = timestamps.length ? Math.max(...timestamps) : 0;
  const earliest = timestamps.length ? Math.min(...timestamps) : 0;
  const base = {
    observations: valid.length,
    spanHours: Math.max(0, (latest - earliest) / HOUR_MS),
    minimum: valid.length ? Math.min(...valid.map((point) => point.current)) : null,
    maximum: valid.length ? Math.max(...valid.map((point) => point.current)) : null,
  };
  if (!valid.length) return { ...base, status: "collecting", reason: "Waiting for history. Current players are shown separately when available." };
  if (now - latest > 2 * HOUR_MS) return { ...base, status: "stale", reason: "Historical observations are stale. Refresh is needed before comparing activity." };
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  const start = end - 24 * HOUR_MS;
  const byHour = new Map(hourly.filter((point) => point.observedAt <= now && point.hour < end).map((point) => [point.hour, point]));
  const pairs: { recent: number; baseline: number }[] = [];
  for (let hour = start; hour < end; hour += HOUR_MS) {
    const recent = byHour.get(hour);
    const baseline = byHour.get(hour - 24 * HOUR_MS);
    if (recent && baseline) pairs.push({ recent: recent.value, baseline: baseline.value });
  }
  const endpoint = byHour.get(end - HOUR_MS);
  if (pairs.length < 20 || !endpoint || now - endpoint.observedAt > 2 * HOUR_MS || !byHour.has(end - 25 * HOUR_MS)) {
    return { ...base, status: "collecting", reason: "Building a baseline. A preliminary daily comparison needs two days with at least 20 matched hours; a weekly trend needs two weeks." };
  }
  const recentMean = pairs.reduce((sum, point) => sum + point.recent, 0) / pairs.length;
  const baselineMean = pairs.reduce((sum, point) => sum + point.baseline, 0) / pairs.length;
  return {
    ...base, status: "preliminary",
    reason: "Preliminary daily activity only. Launch effects and weekday/weekend differences are not established; this does not trigger trend alerts.",
    comparison: { startTs: start, endTs: end, recentMean, baselineMean, matchedHours: pairs.length,
      pct: baselineMean >= 10 ? Math.round((recentMean / baselineMean - 1) * 1000) / 10 : null,
      delta: Math.round(recentMean - baselineMean),
    },
  };
}
