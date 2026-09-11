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

import type { Game, CachedData, Snapshot, CardViewModel, BootstrapStatus } from "../types/index.js";
import { buildEarlyActivity } from "./earlyActivity.js";
import {
  compute24hAvgFromHourly,
  compute24hGainFromHourly,
  computeRetentionAvgFromHourly,
  computeRetentionGainFromHourly,
  computeRetentionWindowLabel,
  computeLatestChangePctFromHourly,
  computeLocalPeak,
  computeWindowMin,
} from "./trend.js";
import {
  buildAvailableGraphWindows,
  hasEnoughGraphHistoryFromHourly,
  sparklineColor,
  filterSnapshotsByWindow,
  GRAPH_WINDOW_MS,
} from "./sparkline.js";
import { formatError } from "./log.js";
import { isQualifiedSnapshot, normalizeHourly } from "./series.js";
import { analyzeSeasonalTrendFromHourly } from "./seasonal.js";

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
  const data      = cache[game.appid];
  const observations = snaps.filter((snapshot) => isQualifiedSnapshot(snapshot) && snapshot.ts <= now);
  const hourly = normalizeHourly(observations, now);
  const current   = data?.current ?? null;
  const observedPeak = computeLocalPeak(observations);
  const allTimePeak = data?.freshness?.allTimePeak?.source === "steamcharts" && data.freshness.allTimePeak.acquiredAt !== undefined ? data.allTimePeak ?? null : null;
  const peak24h    = data?.peak24h ?? null;
  const avg24h     = compute24hAvgFromHourly(hourly, now);
  const gain24h    = compute24hGainFromHourly(hourly, now);
  const retentionAvg = computeRetentionAvgFromHourly(hourly, retentionDays, now);
  const retentionGain = computeRetentionGainFromHourly(hourly, retentionDays, now);
  const retentionWindowLabel = computeRetentionWindowLabel(snaps, retentionDays, now);
  const availableGraphWindows = buildAvailableGraphWindows(retentionDays)
    .filter((window) => hasEnoughGraphHistoryFromHourly(hourly, window.windowMs, now));
  const defaultGraphWindow = availableGraphWindows.find((w) => w.key !== "all")?.key ?? availableGraphWindows[0]?.key ?? null;
  const seasonalAnalysis = analyzeSeasonalTrendFromHourly(hourly, now);
  const trend = seasonalAnalysis.status === "ready" ? seasonalAnalysis.trend : null;
  const trendCls   = trend?.level.cls ?? "stable";
  const latestChangePct = computeLatestChangePctFromHourly(hourly, now);
  const stroke = trend ? sparklineColor(observations) : "#00c8ff";

  const activeWindowKey = defaultGraphWindow ?? "all";
  const activeWindowMs = GRAPH_WINDOW_MS[activeWindowKey];
  const filteredSnapsForWindow = filterSnapshotsByWindow(observations, activeWindowMs, now);
  const recordLow = computeWindowMin(filteredSnapsForWindow);
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
    ...(seasonalAnalysis.status !== "ready" ? { earlyActivity: buildEarlyActivity(observations, hourly, now) } : {}),
    displayTrendPct: trend?.pct ?? null,
    displayTrendIcon: trend?.level.icon ?? null,
    displayTrendCls: trend?.level.cls ?? "stable",
    ...(avg24h != null ? { avg24h } : {}),
    ...(gain24h != null ? { gain24h } : {}),
    ...(retentionAvg != null ? { retentionAvg } : {}),
    ...(retentionGain != null ? { retentionGain } : {}),
    retentionDays,
    retentionWindowLabel,
    availableGraphWindows,
    defaultGraphWindow,
    trend,
    trendCls,
    latestChangePct,
    snaps: observations,
    sparklineStroke: stroke,
    fetchedAt: data?.fetchedAt ?? 0,
    ...(data?.freshness ? { freshness: data.freshness } : {}),
    ...(data?.twitchViewers != null ? { twitchViewers: data.twitchViewers } : {}),
    recordLow,
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
  loadHistoryStatus?: (appid: string) => Promise<BootstrapStatus | null>,
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
      let historyStatus: BootstrapStatus | null = null;
      try {
        historyStatus = loadHistoryStatus ? await loadHistoryStatus(game.appid) : null;
      } catch (error) {
        console.warn(`[SteamWatch] Failed to load history status for ${game.appid}: ${formatError(error)}`);
      }
      return { game, snaps, historyStatus };
    }),
  );
  const models: CardViewModel[] = [];
  for (const [index, item] of loaded.entries()) {
    // Yield between games so ten full histories do not occupy one UI task.
    if (index > 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    models.push({ ...buildCardViewModel(item.game, cache, item.snaps, retentionDays, now), ...(item.historyStatus ? { historyStatus: item.historyStatus } : {}) });
  }
  return models;
}
