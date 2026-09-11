import type { SeasonalTrendAnalysis, Snapshot, TrendLevel, TrendResult } from "../types/index.js";
import { HOUR_MS, hourlyCoverage, median, normalizeHourly, type HourlyPoint } from "./series.js";

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

/** Analyze a previously normalized hourly series without repeating boundary work. */
export function analyzeSeasonalTrendFromHourly(points: readonly HourlyPoint[], now: number): SeasonalTrendAnalysis {
  const latest = points.reduce((maximum, point) => Math.max(maximum, point.observedAt), 0);
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  const start = end - 7 * 24 * HOUR_MS;
  const coverage = hourlyCoverage(points, start, end);
  if (latest === 0 || now - latest > 2 * HOUR_MS) return { status: "stale", coverage, reason: "No qualified observation in the last two hours." };
  if (coverage < 0.8) return { status: "insufficient", coverage, reason: "Recent hourly coverage is below 80%." };

  const byHour = new Map(points.map((point) => [point.hour, point]));
  const comparable: { readonly recent: number; readonly baseline: number; readonly day: number }[] = [];
  for (let hour = start; hour < end; hour += HOUR_MS) {
    const recent = byHour.get(hour);
    if (!recent) continue;
    const baseline = [1, 2, 3, 4].flatMap((week) => {
      const point = byHour.get(hour - week * 7 * 24 * HOUR_MS);
      return point ? [point.value] : [];
    });
    if (baseline.length >= 3) {
      const baselineMedian = median(baseline);
      if (baselineMedian > 0) comparable.push({ recent: recent.value, baseline: baselineMedian, day: Math.floor((hour - start) / (24 * HOUR_MS)) });
    }
  }
  if (comparable.length / (7 * 24) < 0.8 || !hasDailyCoverage(comparable)) {
    return { status: "insufficient", coverage: comparable.length / (7 * 24), reason: "Comparable seasonal coverage is below 80%." };
  }
  const baseline = average(comparable.map((point) => point.baseline));
  if (baseline < 10) return { status: "low-baseline", coverage: comparable.length / (7 * 24), reason: "Seasonal baseline is below 10 players." };
  const pct = round1(median(comparable.map((point) => ((point.recent - point.baseline) / point.baseline) * 100)));
  const level = TREND_LEVELS.find((candidate) => pct >= candidate.minPct) ?? TREND_LEVELS[TREND_LEVELS.length - 1];
  if (!level) return { status: "insufficient", coverage: comparable.length / (7 * 24), reason: "Trend levels are unavailable." };
  const trend: TrendResult = { level, pct, delta: Math.round(baseline * pct / 100) };
  return { status: "ready", trend, coverage: comparable.length / (7 * 24), reason: "Seasonal hourly comparison is ready." };
}

function hasDailyCoverage(points: readonly { readonly day: number }[]): boolean {
  return Array.from({ length: 7 }, (_, day) => points.filter((point) => point.day === day).length >= 20).every(Boolean);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
