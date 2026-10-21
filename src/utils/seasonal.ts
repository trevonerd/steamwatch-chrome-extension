import type { PlayerChange, SeasonalTrendAnalysis, Snapshot, TrendLevel, TrendResult } from "../types/index.js";
import { HOUR_MS, type HourlyPoint, normalizeHourly } from "./series.js";

const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MIN_MATCHED_HOURS = 20;

const TREND_LEVELS: readonly TrendLevel[] = [
  { key: "EXPLOSION", label: "Explosion!", icon: "🚀🚀", cls: "explosion", minPct: 50 },
  { key: "STRONG_UP", label: "Strong rise", icon: "🚀", cls: "strong-up", minPct: 25 },
  { key: "UP", label: "Rising", icon: "📈", cls: "up", minPct: 10 },
  { key: "STABLE", label: "Stable", icon: "➡️", cls: "stable", minPct: -10 },
  { key: "DOWN", label: "Declining", icon: "📉", cls: "down", minPct: -25 },
  { key: "STRONG_DOWN", label: "Strong drop", icon: "⬇️", cls: "strong-down", minPct: -50 },
  { key: "COLLAPSE", label: "Collapse", icon: "💥", cls: "crash", minPct: Number.NEGATIVE_INFINITY },
] as const;

export function analyzeSeasonalTrend(snapshots: readonly Snapshot[], now = Date.now()): SeasonalTrendAnalysis {
  return analyzeSeasonalTrendFromHourly(normalizeHourly(snapshots, now), now);
}

/** Display-only recovery; alert evaluation must use the current-time analysis. */
export function analyzeLatestAvailableSeasonalTrendFromHourly(
  points: readonly HourlyPoint[],
  now: number,
): SeasonalTrendAnalysis {
  const current = analyzeSeasonalTrendFromHourly(points, now);
  if (current.status !== "stale" && current.status !== "insufficient") return current;
  const oldestEnd = now - 48 * HOUR_MS;
  for (let end = Math.floor(now / HOUR_MS) * HOUR_MS - HOUR_MS; end >= oldestEnd; end -= HOUR_MS) {
    const candidate = analyzeSeasonalTrendFromHourly(points, end);
    if (candidate.status === "ready") return candidate;
  }
  return current;
}

/**
 * Momentum: last 24 completed hours vs the same UTC hours one week earlier, so weekday and time of day align.
 * Falls back to the 7-day average of each hour of day when the week-ago hours are missing.
 */
export function analyzeSeasonalTrendFromHourly(points: readonly HourlyPoint[], now: number): SeasonalTrendAnalysis {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  const start = end - DAY_MS;
  const eligible = points.filter((point) => point.observedAt <= now && point.hour < end);
  const latest = eligible.reduce((maximum, point) => Math.max(maximum, point.observedAt), 0);
  const byHour = new Map(eligible.map((point) => [point.hour, point.value]));
  const recentHours = Array.from({ length: 24 }, (_, index) => start + index * HOUR_MS).filter((hour) =>
    byHour.has(hour),
  );
  const coverage = recentHours.length / 24;
  if (latest === 0 || now - latest > 2 * HOUR_MS)
    return { status: "stale", coverage, reason: "No qualified completed-hour observation in the last two hours." };

  let basis: "week" | "7d-avg" = "week";
  let pairs = recentHours.flatMap((hour) => {
    const baseline = byHour.get(hour - WEEK_MS);
    return baseline === undefined ? [] : [{ recent: byHour.get(hour) ?? 0, baseline }];
  });
  if (pairs.length < MIN_MATCHED_HOURS) {
    basis = "7d-avg";
    pairs = recentHours.flatMap((hour) => {
      const days = Array.from({ length: 7 }, (_, day) => byHour.get(hour - (day + 1) * DAY_MS)).filter(
        (value) => value !== undefined,
      );
      // ponytail: three days per hour keeps a new game's first week usable; raise it if launch spikes skew it.
      return days.length < 3 ? [] : [{ recent: byHour.get(hour) ?? 0, baseline: average(days) }];
    });
  }
  if (pairs.length < MIN_MATCHED_HOURS)
    return {
      status: "insufficient",
      coverage,
      reason: "Need 20 of the last 24 hours with matching hours from the previous week.",
    };

  const recentMean = average(pairs.map((pair) => pair.recent));
  const baselineMean = average(pairs.map((pair) => pair.baseline));
  if (baselineMean < 10) return { status: "low-baseline", coverage, reason: "Baseline average is below 10 players." };
  const pct = round1((recentMean / baselineMean - 1) * 100);
  const level = TREND_LEVELS.find((candidate) => pct >= candidate.minPct) ?? TREND_LEVELS[TREND_LEVELS.length - 1];
  if (!level) return { status: "insufficient", coverage, reason: "Trend levels are unavailable." };
  const trend: TrendResult = { level, pct, delta: Math.round(recentMean - baselineMean) };
  const weeklyPct = weeklyAveragePct(byHour, end);
  return {
    status: "ready",
    trend,
    coverage,
    reason:
      basis === "week"
        ? "Last 24 hours vs the same hours a week earlier."
        : "Last 24 hours vs the 7-day average at the same hours; the week-ago hours are missing.",
    comparison: {
      basis,
      startTs: start,
      // End of the newest observed hour, so a dated comparison never claims hours it did not see.
      endTs: (recentHours.at(-1) ?? end - HOUR_MS) + HOUR_MS,
      recentMean,
      baselineMean,
      recentPeak: Math.max(...pairs.map((pair) => pair.recent)),
      baselinePeak: Math.max(...pairs.map((pair) => pair.baseline)),
      matchedHours: pairs.length,
      ...(weeklyPct !== null ? { weeklyPct } : {}),
    },
  };
}

/**
 * Sustained level changes: at least 6 completed hours, each ≥20% away from the same hour a week earlier.
 * Up to two missing hours inside a run are tolerated; an hour back within ±20% ends it.
 */
export function detectPlayerChanges(points: readonly HourlyPoint[], now: number): readonly PlayerChange[] {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  const byHour = new Map(
    points.filter((point) => point.observedAt <= now && point.hour < end).map((point) => [point.hour, point.value]),
  );
  const changes: PlayerChange[] = [];
  let run: { direction: 1 | -1; start: number; last: number; recent: number[]; baseline: number[] } | null = null;
  const close = () => {
    if (run && run.recent.length >= 6)
      changes.push({
        startTs: run.start,
        lastTs: run.last,
        direction: run.direction === 1 ? "rise" : "drop",
        pct: round1((average(run.recent) / average(run.baseline) - 1) * 100),
        hours: run.recent.length,
        ongoing: run.last >= end - 3 * HOUR_MS,
      });
    run = null;
  };
  const hours = [...byHour.keys()];
  const first = Math.min(...hours) + WEEK_MS;
  for (let hour = first; hour < end; hour += HOUR_MS) {
    const recent = byHour.get(hour);
    const baseline = byHour.get(hour - WEEK_MS);
    if (recent === undefined || baseline === undefined || baseline < 10) {
      if (run && hour - run.last > 2 * HOUR_MS) close();
      continue;
    }
    const pct = (recent / baseline - 1) * 100;
    const direction = pct >= 20 ? 1 : pct <= -20 ? -1 : 0;
    if (direction === 0 || (run && run.direction !== direction)) close();
    if (direction === 0) continue;
    run ??= { direction, start: hour, last: hour, recent: [], baseline: [] };
    run.last = hour;
    run.recent.push(recent);
    run.baseline.push(baseline);
  }
  close();
  return changes;
}

function weeklyAveragePct(byHour: ReadonlyMap<number, number>, end: number): number | null {
  const recent: number[] = [];
  const baseline: number[] = [];
  for (let hour = end - WEEK_MS; hour < end; hour += HOUR_MS) {
    const value = byHour.get(hour);
    const previous = byHour.get(hour - WEEK_MS);
    if (value === undefined || previous === undefined) continue;
    recent.push(value);
    baseline.push(previous);
  }
  const baselineMean = average(baseline);
  return recent.length < 0.8 * 168 || baselineMean < 10 ? null : round1((average(recent) / baselineMean - 1) * 100);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
