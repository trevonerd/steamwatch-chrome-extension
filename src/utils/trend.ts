import type { Snapshot, TrendResult } from "../types/index.js";
import { HOUR_MS, hourlyCoverage, normalizeHourly } from "./series.js";
import type { HourlyPoint } from "./series.js";
import { analyzeSeasonalTrend } from "./seasonal.js";

export { analyzeSeasonalTrend, TREND_LEVELS } from "./seasonal.js";

export function computeTrend(snapshots: readonly Snapshot[], now = Date.now()): TrendResult | null {
  const analysis = analyzeSeasonalTrend(snapshots, now);
  return analysis.status === "ready" ? analysis.trend : null;
}

export function compute24hAvg(snapshots: readonly Snapshot[], now = Date.now()): number | null {
  return compute24hAvgFromHourly(normalizeHourly(snapshots, now), now);
}

export function compute24hAvgFromHourly(points: readonly HourlyPoint[], now: number): number | null {
  const values = reliableWindowFromHourly(points, 24, now);
  return values ? Math.round(average(values)) : null;
}

export function compute24hGain(snapshots: readonly Snapshot[], now = Date.now()): number | null {
  return compute24hGainFromHourly(normalizeHourly(snapshots, now), now);
}

export function compute24hGainFromHourly(points: readonly HourlyPoint[], now: number): number | null {
  const values = reliableWindowFromHourly(points, 24, now);
  return gain(values);
}

export function computeRetentionAvg(snapshots: readonly Snapshot[], days: number, now = Date.now()): number | null {
  return computeRetentionAvgFromHourly(normalizeHourly(snapshots, now), days, now);
}

export function computeRetentionAvgFromHourly(points: readonly HourlyPoint[], days: number, now: number): number | null {
  const values = reliableWindowFromHourly(points, days * 24, now);
  return values ? Math.round(average(values)) : null;
}

export function computeRetentionGain(snapshots: readonly Snapshot[], days: number, now = Date.now()): number | null {
  return computeRetentionGainFromHourly(normalizeHourly(snapshots, now), days, now);
}

export function computeRetentionGainFromHourly(points: readonly HourlyPoint[], days: number, now: number): number | null {
  const values = reliableWindowFromHourly(points, days * 24, now);
  return gain(values);
}

export function computeRetentionWindowLabel(snapshots: readonly Snapshot[], days: number, now = Date.now()): string {
  void snapshots;
  void now;
  return `${days}d`;
}

export function computeLocalPeak(snapshots: readonly Snapshot[]): number | null {
  const values = snapshots.filter(isComparableExtrema).map((snapshot) => snapshot.aggregate?.max ?? snapshot.current);
  return values.length === 0 ? null : Math.max(...values);
}

export function computeWindowMin(snapshots: readonly Snapshot[]): { value: number; timestamp: number } | null {
  return snapshots.filter(isComparableExtrema).reduce<{ value: number; timestamp: number } | null>((minimum, snapshot) => {
    const value = snapshot.aggregate?.min ?? snapshot.current;
    const timestamp = snapshot.aggregate?.minTs ?? snapshot.ts;
    return !minimum || value < minimum.value ? { value, timestamp } : minimum;
  }, null);
}

export function fmtNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString("en-US");
}

export function fmtBadge(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function fmtPct(value: number): string { return value >= 0 ? `+${value}%` : `${value}%`; }
export function fmtTimeAgo(timestamp: number, now = Date.now()): string {
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes <= 0) return "just now";
  if (minutes === 1) return "1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1h ago" : `${hours}h ago`;
}

export function computeLatestChangePct(snapshots: readonly Snapshot[], now = Date.now()): number | null {
  return computeLatestChangePctFromHourly(normalizeHourly(snapshots, now), now);
}

export function computeLatestChangePctFromHourly(points: readonly HourlyPoint[], now: number): number | null {
  const previous = points.at(-2);
  const latest = points.at(-1);
  return !previous || !latest || latest.hour - previous.hour !== HOUR_MS || now - latest.observedAt > 2 * HOUR_MS || previous.value === 0
    ? null
    : Math.round(((latest.value - previous.value) / previous.value) * 1_000) / 10;
}

function reliableWindowFromHourly(points: readonly HourlyPoint[], hours: number, now: number): readonly number[] | null {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  const start = end - hours * HOUR_MS;
  const window = points.filter((point) => point.hour >= start && point.hour < end);
  return hasReliableCoverage(window, start, end, hours) ? window.map((point) => point.value) : null;
}

function average(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function gain(values: readonly number[] | null): number | null {
  const first = values?.[0];
  const last = values?.at(-1);
  return first === undefined || last === undefined ? null : last - first;
}

function isComparableExtrema(snapshot: Snapshot): boolean {
  return (snapshot.source === "steam" || snapshot.source === "steamcharts")
    && snapshot.granularity !== "unknown" && snapshot.granularity !== "monthly-peak";
}

function hasReliableCoverage(points: readonly HourlyPoint[], start: number, end: number, hours: number): boolean {
  const first = points[0]?.hour;
  const last = points.at(-1)?.hour;
  if (hourlyCoverage(points, start, end) < 0.8 || first === undefined || last === undefined || first > start + HOUR_MS || last < end - 2 * HOUR_MS) return false;
  if (points.some((point, index) => index > 0 && point.hour - (points[index - 1]?.hour ?? point.hour) > 3 * HOUR_MS)) return false;
  return hours < 48 || Array.from({ length: Math.ceil(hours / 24) }, (_, day) => hourlyCoverage(points, start + day * 24 * HOUR_MS, Math.min(end, start + (day + 1) * 24 * HOUR_MS)) >= 0.8).every(Boolean);
}
