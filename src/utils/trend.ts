// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/trend.ts
// Pure functions: no side effects, no I/O, easy to test.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Snapshot,
  TrendLevel,
  TrendResult,
  SpikeResult,
  ForecastResult,
} from "../types/index.js";

// ── Trend level table (order matters: highest first) ──────────────────────────

export const TREND_LEVELS: readonly TrendLevel[] = [
  { key: "EXPLOSION",  label: "Explosion!",   icon: "🚀🚀", cls: "explosion",  minPct: 50  },
  { key: "STRONG_UP",  label: "Strong Rise",  icon: "🚀",   cls: "strong-up",  minPct: 20  },
  { key: "UP",         label: "Rising",       icon: "📈",   cls: "up",         minPct: 5   },
  { key: "STABLE",     label: "Stable",       icon: "➡️",   cls: "stable",     minPct: -5  },
  { key: "DOWN",       label: "Declining",    icon: "📉",   cls: "down",       minPct: -20 },
  { key: "STRONG_DOWN",label: "Strong Drop",  icon: "⬇️",   cls: "strong-down",minPct: -50 },
  { key: "CRASH",      label: "Crash",        icon: "💀",   cls: "crash",      minPct: -Infinity },
] as const;

// ── Core trend computation ────────────────────────────────────────────────────

/**
 * Compare smoothed averages: last N snapshots vs previous N snapshots.
 * Returns null if there are not enough data points yet.
 *
 * Using a window of 3 each side: spike-resistant without excessive lag.
 */
export function computeTrend(
  snapshots: readonly Snapshot[],
  windowSize = 3
): TrendResult | null {
  const needed = windowSize * 2;
  if (snapshots.length < needed) return null;

  const recent = snapshots.slice(-windowSize);
  const prev   = snapshots.slice(-needed, -windowSize);

  const recentAvg = average(recent.map((s) => s.current));
  const prevAvg   = average(prev.map((s) => s.current));

  if (prevAvg === 0) return null;

  const pct   = round1(((recentAvg - prevAvg) / prevAvg) * 100);
  const delta = Math.round(recentAvg - prevAvg);
  const level = TREND_LEVELS.find((t) => pct >= t.minPct) ?? TREND_LEVELS[TREND_LEVELS.length - 1]!;

  return { level, pct, delta };
}

/**
 * Detect a large single-interval change (last snapshot vs second-to-last).
 * Returns null if not enough data or below threshold.
 */
export function detectSpike(
  snapshots: readonly Snapshot[],
  thresholdPct = 40
): SpikeResult | null {
  if (snapshots.length < 2) return null;

  const last = snapshots[snapshots.length - 1]!;
  const prev = snapshots[snapshots.length - 2]!;

  if (prev.current === 0) return null;

  const pct = ((last.current - prev.current) / prev.current) * 100;

  if (Math.abs(pct) < thresholdPct) return null;

  return {
    type: pct > 0 ? "spike_up" : "spike_down",
    pct: Math.round(pct),
  };
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
  const recent = getReliableWindowSnapshots(snapshots, retentionDays * 86_400_000);
  if (!recent) return null;
  return Math.round(average(recent.map((s) => s.current)));
}

export function computeRetentionGain(
  snapshots: readonly Snapshot[],
  retentionDays: number,
): number | null {
  const recent = getReliableWindowSnapshots(snapshots, retentionDays * 86_400_000);
  if (!recent) return null;
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last) return null;
  return last.current - first.current;
}

export function computeLocalPeak(snapshots: readonly Snapshot[]): number | null {
  if (snapshots.length === 0) return null;
  return Math.max(...snapshots.map((s) => s.current));
}

export function computeWindowMin(
  snapshots: readonly Snapshot[],
): { value: number; timestamp: number } | null {
  if (snapshots.length === 0) return null;
  let min = snapshots[0]!;
  for (const snap of snapshots) {
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

// ── Forecast ──────────────────────────────────────────────────────────────────

/**
 * Project the player count `hoursAhead` hours into the future using OLS
 * linear regression over the available snapshots.
 *
 * ### Why naïve extrapolation produces garbage
 * Linear regression on a short window (e.g. 1.5h) and then projecting 6h
 * ahead is a 4× extrapolation — statistically unsound. For a game that
 * gained 10k players in 1.5h, the model predicts +40k more: physically
 * impossible. We guard against this with two mechanisms:
 *
 * 1. **Minimum data span**: at least 1 hour of history required.
 * 2. **Extrapolation cap**: the projected change is bounded by the
 *    extrapolation ratio — the more we're projecting beyond the data window,
 *    the smaller the allowed swing. At 4× extrapolation the cap is ±25% of
 *    current; at 1× it is ±100%.
 * 3. **Hard ceiling / floor**: projected value never exceeds
 *    `historicalPeak × 2` (games don't 2× peak overnight) and never < 0.
 *
 * `reliable` is true only when data is ≥ 3h, R² ≥ 0.5, and we have ≥ 12
 * snapshots — meaning the extension has been running for at least 3 hours.
 *
 * @param snapshots   Historical snapshots in chronological order
 * @param hoursAhead  How many hours ahead to project (default: 6)
 */
export function computeForecast(
  snapshots: readonly Snapshot[],
  hoursAhead = 6
): ForecastResult | null {
  if (snapshots.length < 6) return null;

  // ── Minimum span guard ────────────────────────────────────────────────────
  // Refuse to forecast if the data window is less than 1 hour.
  const spanHours = (snapshots.at(-1)!.ts - snapshots[0]!.ts) / 3_600_000;
  if (spanHours < 1) return null;

  // ── OLS linear regression ─────────────────────────────────────────────────
  const t0 = snapshots[0]!.ts;
  const xs  = snapshots.map((s) => (s.ts - t0) / 3_600_000);   // hours
  const ys  = snapshots.map((s) => s.current);
  const n   = xs.length;

  const sumX  = xs.reduce((a, b) => a + b, 0);
  const sumY  = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i]!, 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // ── Raw projection ────────────────────────────────────────────────────────
  const lastX     = xs.at(-1)!;
  const targetX   = lastX + hoursAhead;
  const rawProjected = intercept + slope * targetX;

  // ── Extrapolation-ratio cap ───────────────────────────────────────────────
  // extrapolationRatio = hoursAhead / spanHours
  //   ratio = 1 → projecting as far as we have data → cap ±80%
  //   ratio = 2 → projecting 2× data window → cap ±50%
  //   ratio = 4 → projecting 4× data window → cap ±25%
  // Formula: maxChangeFraction = 0.8 / ratio  (never > 0.8)
  const extrapolationRatio = hoursAhead / spanHours;
  const maxChangeFraction  = Math.min(0.8, 0.8 / extrapolationRatio);

  const current       = snapshots.at(-1)!.current;
  const histPeak      = Math.max(...ys);                 // peak observed so far
  const maxProjected  = Math.max(current, histPeak) * 2; // hard ceiling
  const minProjected  = 0;                               // hard floor

  // Apply the extrapolation cap around current value
  const capped = Math.min(
    Math.max(
      rawProjected,
      current * (1 - maxChangeFraction),      // lower bound
    ),
    current * (1 + maxChangeFraction),         // upper bound
  );

  const projected = Math.round(
    Math.max(minProjected, Math.min(maxProjected, capped))
  );

  // ── R² goodness-of-fit ────────────────────────────────────────────────────
  const meanY = sumY / n;
  const ssTot = ys.reduce((a, y) => a + (y - meanY) ** 2, 0);
  const ssRes = ys.reduce((a, y, i) => a + (y - (intercept + slope * xs[i]!)) ** 2, 0);
  const r2    = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  const changePct = current === 0
    ? 0
    : round1(((projected - current) / current) * 100);

  // Reliable: need ≥ 3h of data, ≥ 12 snapshots, R² ≥ 0.5
  // (i.e. the extension has been running for at least 3h)
  const reliable = spanHours >= 3 && n >= 12 && r2 >= 0.5;

  return {
    projected,
    changePct,
    hoursAhead,
    r2: Math.round(r2 * 100) / 100,
    reliable,
  };
}
