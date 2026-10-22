// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/card.ts
// Pure factory for CardViewModel.
//
// Every piece of derived display data lives here — the popup renderer, the
// share-text builder, and the canvas renderer all consume this model without
// re-computing anything independently. Change the derivation logic once,
// everywhere benefits.
//
// No side effects. No I/O. Fully unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

import type { CachedData, CardViewModel, Game, PlayerChange, Snapshot } from "../types/index.js";
import { buildEarlyActivity } from "./earlyActivity.js";
import { formatError } from "./log.js";
import { analyzeLatestAvailableSeasonalTrendFromHourly, detectPlayerChanges } from "./seasonal.js";
import { HOUR_MS, isQualifiedSnapshot, normalizeHourly } from "./series.js";
import { buildAvailableGraphWindows, hasEnoughGraphHistory } from "./sparkline.js";
import { computeLatestChangePctFromHourly, computeLocalPeak, computeWindowMin, fmtNumber, fmtPct } from "./trend.js";

/**
 * Build the complete view model for a single game card.
 *
 * All derived card metrics happen exactly once per render cycle, regardless
 * of how many consumers read the model.
 *
 * @param game   The tracked game object.
 * @param cache  Full cache map (keyed by appid).
 * @param snaps  All locally stored snapshots for this game (chronological).
 */
export function buildCardViewModel(
  game: Game,
  cache: Record<string, CachedData>,
  snaps: readonly Snapshot[],
  retentionDays: number,
  now = Date.now(),
): CardViewModel {
  const data = cache[game.appid];
  const observations = snaps.filter((snapshot) => isQualifiedSnapshot(snapshot) && snapshot.ts <= now);
  const hourly = normalizeHourly(observations, now);
  const current = data?.current ?? null;
  const observedPeak = computeLocalPeak(observations);
  const allTimePeak =
    data?.freshness?.allTimePeak?.source === "steamcharts" && data.freshness.allTimePeak.acquiredAt !== undefined
      ? (data.allTimePeak ?? null)
      : null;
  const peak24h = data?.peak24h ?? null;
  const availableGraphWindows = buildAvailableGraphWindows(retentionDays).filter((window) =>
    hasEnoughGraphHistory(observations, window.windowMs, now),
  );
  const defaultGraphWindow =
    availableGraphWindows.find((w) => w.key !== "all")?.key ?? availableGraphWindows[0]?.key ?? null;
  const seasonalAnalysis = analyzeLatestAvailableSeasonalTrendFromHourly(hourly, now);
  const trend = seasonalAnalysis.status === "ready" ? seasonalAnalysis.trend : null;
  const comparisonEnd = seasonalAnalysis.status === "ready" ? seasonalAnalysis.comparison?.endTs : undefined;
  const trendAsOf =
    comparisonEnd !== undefined && comparisonEnd < Math.floor(now / HOUR_MS) * HOUR_MS ? comparisonEnd : undefined;
  const trendCls = trend?.level.cls ?? "stable";
  const latestChangePct = computeLatestChangePctFromHourly(hourly, now);
  const allTimeLow = computeWindowMin(observations);

  return {
    game,
    evaluatedAt: now,
    current,
    peak24h,
    allTimePeak,
    ...(allTimePeak !== null && data?.allTimePeakLabel ? { allTimePeakLabel: data.allTimePeakLabel } : {}),
    ...(observedPeak !== null ? { observedPeak } : {}),
    seasonalAnalysis,
    ...(trendAsOf !== undefined ? { trendAsOf } : {}),
    ...(seasonalAnalysis.status !== "ready" ? { earlyActivity: buildEarlyActivity(observations, hourly, now) } : {}),
    displayTrendPct: trend?.pct ?? null,
    displayTrendIcon: trend?.level.icon ?? null,
    displayTrendCls: trend?.level.cls ?? "stable",
    availableGraphWindows,
    defaultGraphWindow,
    trend,
    trendCls,
    latestChangePct,
    snaps: observations,
    fetchedAt: data?.fetchedAt ?? 0,
    ...(data?.freshness ? { freshness: data.freshness } : {}),
    ...(data?.twitchViewers != null ? { twitchViewers: data.twitchViewers } : {}),
    changes: detectPlayerChanges(hourly, now),
    allTimeLow,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build view models for all games in parallel.
 * Safe: individual snapshot-load failures are swallowed — the card renders
 * with empty snaps rather than crashing the whole list.
 */
export async function buildAllViewModels(
  games: Game[],
  cache: Record<string, CachedData>,
  loadSnaps: (appid: string) => Promise<Snapshot[]>,
  retentionDays: number,
): Promise<CardViewModel[]> {
  const now = Date.now();
  const loaded = await Promise.all(
    games.map(async (game) => {
      let snaps: Snapshot[] = [];
      try {
        snaps = await loadSnaps(game.appid);
      } catch (error) {
        console.warn(`[SteamWatch] Failed to load snapshots for appid ${game.appid}: ${formatError(error)}`);
        snaps = [];
      }
      return { game, snaps };
    }),
  );
  const models: CardViewModel[] = [];
  for (const [index, item] of loaded.entries()) {
    // Yield between games so ten full histories do not occupy one UI task.
    if (index > 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    models.push(buildCardViewModel(item.game, cache, item.snaps, retentionDays, now));
  }
  return models;
}

/** Badge text when no momentum comparison is shown and no preliminary 24h comparison exists. */
export function fallbackBadgeLabel(vm: CardViewModel): string {
  // Kept to 12 characters or fewer so the badge never wraps under the stats.
  if (vm.seasonalAnalysis?.status === "low-baseline") return "Low activity";
  if (vm.earlyActivity?.status === "stale") return "Stale data";
  // Steam reports no stats (result 42) for unreleased games: no live count and no history at all.
  if (vm.current === null && !vm.earlyActivity?.observations) return "No data yet";
  return (vm.earlyActivity?.spanHours ?? 0) >= 8 * 24 ? "Partial data" : "Collecting";
}

/** "w/w" (same hours last week) or "vs 7d" (7-day hourly average); short enough to share the stats row. */
export function momentumBasisLabel(vm: CardViewModel): string {
  return isProvisionalMomentum(vm) ? "vs 7d" : "w/w";
}

/** The 7-day hourly average is a weaker baseline than the same hours last week. */
export function isProvisionalMomentum(vm: CardViewModel): boolean {
  return vm.seasonalAnalysis?.status === "ready" && vm.seasonalAnalysis.comparison?.basis === "7d-avg";
}

/** Whole percent from 10% up; one decimal below, where it still carries information. */
export function badgePct(pct: number): number {
  return Math.abs(pct) >= 10 ? Math.round(pct) : pct;
}

/** Visible panel line: what the badge compares, in words. */
export function momentumLine(vm: CardViewModel): string | null {
  const analysis = vm.seasonalAnalysis;
  if (analysis?.status !== "ready" || !analysis.comparison) return null;
  const { comparison } = analysis;
  const basis = comparison.basis === "week" ? "same hours last week" : "7-day average at the same hours";
  return `24h avg ${fmtNumber(Math.round(comparison.recentMean))} vs ${fmtNumber(Math.round(comparison.baselineMean))} ${basis} · ${comparison.matchedHours}/24 h`;
}

/** Momentum numbers for the trend badge tooltip. */
export function momentumDetail(vm: CardViewModel): string {
  const analysis = vm.seasonalAnalysis;
  if (analysis?.status !== "ready" || !analysis.comparison) return "";
  const { comparison } = analysis;
  const parts = [
    `24h average ${fmtNumber(Math.round(comparison.recentMean))} vs ${fmtNumber(Math.round(comparison.baselineMean))}`,
    `peak ${fmtNumber(Math.round(comparison.recentPeak))} vs ${fmtNumber(Math.round(comparison.baselinePeak))}`,
    ...(comparison.weeklyPct !== undefined ? [`7-day average ${fmtPct(comparison.weeklyPct)} vs previous week`] : []),
    `${comparison.matchedHours}/24 matched hours`,
  ];
  const change = latestChange(vm);
  return ` ${parts.join(" · ")}.${change ? ` ${changeLabel(change)}.` : ""}`;
}

/** Most recent detected change in the last 7 days. */
export function latestChange(vm: CardViewModel): PlayerChange | undefined {
  const change = vm.changes.at(-1);
  return change && (vm.evaluatedAt ?? Date.now()) - change.lastTs <= 7 * 24 * HOUR_MS ? change : undefined;
}

export function changeLabel(change: PlayerChange): string {
  const when = new Date(change.startTs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${change.direction === "drop" ? "Drop" : "Rise"} ${fmtPct(change.pct)} since ${when}${change.ongoing ? "" : ` (${change.hours}h)`}`;
}
