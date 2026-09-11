import type { SeasonalTrendAnalysis, Snapshot, TrendLevel, TrendResult } from "../types/index.js";
import { HOUR_MS, hourlyCoverage, normalizeHourly, type HourlyPoint } from "./series.js";

export const TREND_LEVELS: readonly TrendLevel[] = [
  { key: "EXPLOSION", label: "Explosion!", icon: "🚀🚀", cls: "explosion", minPct: 50 },
  { key: "STRONG_UP", label: "Strong Rise", icon: "🚀", cls: "strong-up", minPct: 20 },
  { key: "UP", label: "Rising", icon: "📈", cls: "up", minPct: 5 },
  { key: "STABLE", label: "Stable", icon: "➡️", cls: "stable", minPct: -5 },
  { key: "DOWN", label: "Declining", icon: "📉", cls: "down", minPct: -20 },
  { key: "STRONG_DOWN", label: "Strong Drop", icon: "⬇️", cls: "strong-down", minPct: -50 },
] as const;

export function analyzeSeasonalTrend(snapshots: readonly Snapshot[], now = Date.now()): SeasonalTrendAnalysis {
  return analyzeSeasonalTrendFromHourly(normalizeHourly(snapshots, now), now);
}

/** Compare adjacent weeks using only matched UTC hours, so nights and weekends align. */
export function analyzeSeasonalTrendFromHourly(points: readonly HourlyPoint[], now: number): SeasonalTrendAnalysis {
  const week = 7 * 24 * HOUR_MS;
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  const start = end - week;
  const eligible = points.filter((point) => point.observedAt <= now && point.hour < end);
  const latest = eligible.reduce((maximum, point) => Math.max(maximum, point.observedAt), 0);
  const coverage = hourlyCoverage(eligible, start, end);
  if (latest === 0 || now - latest > 2 * HOUR_MS) return { status: "stale", coverage, reason: "No qualified completed-hour observation in the last two hours." };
  const byHour = new Map(eligible.map((point) => [point.hour, point]));
  if (!byHour.has(end - HOUR_MS) || !byHour.has(end - week - HOUR_MS)) {
    return { status: "insufficient", coverage, reason: "The latest completed hour needs a matching observation from the previous week." };
  }
  const comparable: { readonly recent: number; readonly baseline: number; readonly day: number }[] = [];
  for (let hour = start; hour < end; hour += HOUR_MS) {
    const recent = byHour.get(hour);
    const baseline = byHour.get(hour - week);
    if (recent && baseline) comparable.push({ recent: recent.value, baseline: baseline.value, day: Math.floor((hour - start) / (24 * HOUR_MS)) });
  }
  const pairedCoverage = comparable.length / 168;
  const days = Array.from({ length: 7 }, (_, day) => comparable.filter((point) => point.day === day));
  if (pairedCoverage < 0.8 || days.some((day) => day.length < 20)) {
    return { status: "insufficient", coverage: pairedCoverage, reason: "Need two weeks of matched hourly history, with at least 20 comparable hours per day." };
  }
  const recentMean = average(comparable.map((point) => point.recent));
  const baselineMean = average(comparable.map((point) => point.baseline));
  if (baselineMean < 10) return { status: "low-baseline", coverage: pairedCoverage, reason: "Previous-week average is below 10 players." };
  const rawPct = (recentMean / baselineMean - 1) * 100;
  const pct = round1(rawPct);
  const daily = days.map((day) => ({ recent: average(day.map((p) => p.recent)), baseline: average(day.map((p) => p.baseline)) }));
  const dailyPct = daily.map((day) => day.baseline === 0 ? day.recent > 0 ? Number.POSITIVE_INFINITY : 0 : round1((day.recent / day.baseline - 1) * 100));
  const risingDays = dailyPct.filter((value) => value >= 5).length;
  const fallingDays = dailyPct.filter((value) => value < -5).length;
  const sustained = pct >= 5 ? risingDays >= 5 : pct < -5 ? fallingDays >= 5 : false;
  const classified = TREND_LEVELS.find((candidate) => pct >= candidate.minPct) ?? TREND_LEVELS[TREND_LEVELS.length - 1];
  const mixed = (pct >= 5 || pct < -5) && !sustained;
  const level: TrendLevel | undefined = mixed ? { key: "STABLE", label: "Uneven week", icon: "↔", cls: "stable", minPct: -5 } : classified;
  if (!level) return { status: "insufficient", coverage: pairedCoverage, reason: "Trend levels are unavailable." };
  const trend: TrendResult = { level, pct, delta: Math.round(recentMean - baselineMean), sustained };
  return {
    status: "ready", trend, coverage: pairedCoverage,
    reason: mixed ? "Weekly activity changed, but fewer than five days agree; no sustained trend alert." : "Last 7 days versus previous 7 days, using matched hours and weekdays.",
    comparison: { startTs: start, endTs: end, baselineStartTs: start - week, recentMean, baselineMean, matchedHours: comparable.length, risingDays, fallingDays },
  };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
