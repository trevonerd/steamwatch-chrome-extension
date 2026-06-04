// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/trend.ts
// Pure functions: no side effects, no I/O, easy to test.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Snapshot,
  TrendLevel,
  TrendResult,
} from "../types/index.js";

// ── Trend level table (order matters: highest first) ──────────────────────────

export const TREND_LEVELS: readonly TrendLevel[] = [
  { key: "EXPLOSION",  label: "Explosion!",   icon: "🚀🚀", cls: "explosion",  minPct: 50  },
  { key: "STRONG_UP",  label: "Strong Rise",  icon: "🚀",   cls: "strong-up",  minPct: 20  },
  { key: "UP",         label: "Rising",       icon: "📈",   cls: "up",         minPct: 5   },
  { key: "STABLE",     label: "Stable",       icon: "➡️",   cls: "stable",     minPct: -5  },
  { key: "DOWN",       label: "Declining",    icon: "📉",   cls: "down",       minPct: -20 },
  { key: "STRONG_DOWN",label: "Strong Drop",  icon: "⬇️",   cls: "strong-down",minPct: -50 },
] as const;

// ── Core trend computation ────────────────────────────────────────────────────

/**
 * Compare the average of the older half of snapshots vs the recent half,
 * using up to the last 24 hours of data (or all available data if less).
 *
 * This time-based split ensures the trend reflects the full trajectory:
 * - A game that peaked at 41 and collapsed to 8 will show STRONG_DOWN,
 *   because the older-half average (~25) dwarfs the recent-half average (~8).
 * - A game that surged from 30 to 50 000 will show EXPLOSION because the
 *   recent-half average far exceeds the older-half average.
 *
 * Returns null when fewer than 6 snapshots are available.
 */
export function computeTrend(
  snapshots: readonly Snapshot[],
): TrendResult | null {
  if (snapshots.length < 6) return null;

  // Use last 24 h of data (or everything available).
  const cutoff24h = Date.now() - 86_400_000;
  const window = snapshots.filter((s) => s.ts >= cutoff24h);
  const pool = window.length >= 6 ? window : snapshots.slice(-Math.max(6, snapshots.length));

  if (pool.length < 6) return null;

  // Split by time midpoint so each half represents an equal time span.
  const tStart = pool[0]!.ts;
  const tEnd   = pool[pool.length - 1]!.ts;
  const tMid   = (tStart + tEnd) / 2;

  const olderHalf  = pool.filter((s) => s.ts <= tMid);
  const recentHalf = pool.filter((s) => s.ts > tMid);

  if (olderHalf.length === 0 || recentHalf.length === 0) return null;

  const prevAvg   = average(olderHalf.map((s) => s.current));
  const recentAvg = average(recentHalf.map((s) => s.current));

  if (prevAvg === 0) return null;

  const pct   = round1(((recentAvg - prevAvg) / prevAvg) * 100);
  const delta = Math.round(recentAvg - prevAvg);
  const level = TREND_LEVELS.find((t) => pct >= t.minPct) ?? TREND_LEVELS[TREND_LEVELS.length - 1]!;

  return { level, pct, delta };
}

/**
 * Average concurrent players over the past 24 hours.
 *
 * Returns `null` when fewer than 6 snapshots exist, or when they span less
 * than 95% of the 24-hour window (brand-new install guard).
 */
export function compute24hAvg(snapshots: readonly Snapshot[]): number | null {
  const recent = getReliable24hSnapshots(snapshots);
  if (!recent) return null;

  return Math.round(average(recent.map((s) => s.current)));
}

export function compute24hGain(snapshots: readonly Snapshot[]): number | null {
  const recent = getReliable24hSnapshots(snapshots);
  if (!recent) return null;

  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last) return null;
  return last.current - first.current;
}

export function computeRetentionAvg(
  snapshots: readonly Snapshot[],
  retentionDays: number,
): number | null {
  const recent = getRetentionWindowSnapshots(snapshots, retentionDays * 86_400_000);
  if (!recent) return null;
  return Math.round(average(recent.map((s) => s.current)));
}

export function computeRetentionGain(
  snapshots: readonly Snapshot[],
  retentionDays: number,
): number | null {
  const recent = getRetentionWindowSnapshots(snapshots, retentionDays * 86_400_000);
  if (!recent) return null;
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last) return null;
  return last.current - first.current;
}

export function computeRetentionWindowLabel(
  snapshots: readonly Snapshot[],
  retentionDays: number,
): string {
  const recent = getRetentionWindowSnapshots(snapshots, retentionDays * 86_400_000);
  if (!recent) return `${retentionDays}d`;

  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last) return `${retentionDays}d`;

  const spanMs = Math.max(0, last.ts - first.ts);
  if (spanMs < 86_400_000) {
    const hours = Math.max(1, Math.round(spanMs / 3_600_000));
    return `${hours}h`;
  }

  const days = Math.min(retentionDays, Math.max(1, Math.round(spanMs / 86_400_000)));
  return `${days}d`;
}

export function computeLocalPeak(snapshots: readonly Snapshot[]): number | null {
  if (snapshots.length === 0) return null;
  return Math.max(...snapshots.map((s) => s.current));
}

export function computeWindowMin(
  snapshots: readonly Snapshot[],
): { value: number; timestamp: number } | null {
  if (snapshots.length === 0) return null;

  // Check if any snapshot has non-zero current value
  const hasNonZero = snapshots.some((s) => s.current > 0);

  // If at least one non-zero exists, filter out zeros (failed fetches)
  const filtered = hasNonZero ? snapshots.filter((s) => s.current > 0) : snapshots;

  let min = filtered[0]!;
  for (const snap of filtered) {
    if (snap.current < min.current) min = snap;
  }
  return { value: min.current, timestamp: min.ts };
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

/** Short format for browser badge text (max ~4 chars). */
export function fmtBadge(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`; // "1.2M"
  if (n >= 10_000)    return `${Math.round(n / 1_000)}k`;       // "42k"
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;      // "1.2k"
  return String(n);                                               // "999"
}

export function fmtPct(pct: number): string {
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

export function fmtTimeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins === 0) return "just now";
  if (mins === 1) return "1m ago";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? "1h ago" : `${hrs}h ago`;
}

// ── Private helpers ───────────────────────────────────────────────────────────

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function getReliable24hSnapshots(snapshots: readonly Snapshot[]): Snapshot[] | null {
  return getReliableWindowSnapshots(snapshots, 86_400_000);
}

function getReliableWindowSnapshots(
  snapshots: readonly Snapshot[],
  windowMs: number,
): Snapshot[] | null {
  const cutoff = Date.now() - windowMs;
  const recent = snapshots.filter((s) => s.ts > cutoff);
  if (recent.length < 6) return null;

  // Require close to full-window coverage before exposing aggregate stats.
  const span = (recent.at(-1)?.ts ?? 0) - (recent[0]?.ts ?? 0);
  if (span < windowMs * 0.95) return null;

  return recent;
}

function getRetentionWindowSnapshots(
  snapshots: readonly Snapshot[],
  windowMs: number,
): Snapshot[] | null {
  const cutoff = Date.now() - windowMs;
  const recent = snapshots.filter((s) => s.ts > cutoff);
  if (recent.length < 6) return null;
  return recent;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeLatestChangePct(snapshots: readonly Snapshot[]): number | null {
  if (snapshots.length < 2) return null;
  const prev = snapshots[snapshots.length - 2]!;
  const last = snapshots[snapshots.length - 1]!;
  if (prev.current === 0) return null;
  return round1(((last.current - prev.current) / prev.current) * 100);
}
