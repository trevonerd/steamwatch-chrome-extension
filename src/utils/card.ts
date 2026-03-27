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

import type { Game, CachedData, Snapshot, CardViewModel } from "../types/index.js";
import {
  compute24hAvg,
  compute24hGain,
  computeRetentionAvg,
  computeRetentionGain,
  computeTrend,
  computeLatestChangePct,
  computeLocalPeak,
  computeWindowMin,
} from "./trend.js";
import {
  buildAvailableGraphWindows,
  buildSparklineSVG,
  hasEnoughGraphHistory,
  sparklineColor,
  filterSnapshotsByWindow,
  GRAPH_WINDOW_MS,
} from "./sparkline.js";

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
): CardViewModel {
  const data      = cache[game.appid];
  const legacyPeak = (data as (CachedData & { peak?: number }) | undefined)?.peak ?? 0;
  const current   = data?.current ?? null;
  const localSnap = computeLocalPeak(snaps);
  const stored    = data?.localAllTimePeak ?? 0;
  const rawAllTimePeak = Math.max(data?.allTimePeak ?? 0, legacyPeak, stored, localSnap ?? 0);
  const allTimePeak = rawAllTimePeak > 0 ? rawAllTimePeak : null;
  const peak24h    = data?.peak24h ?? null;
  const avg24h     = compute24hAvg(snaps);
  const gain24h    = compute24hGain(snaps);
  const retentionAvg = computeRetentionAvg(snaps, retentionDays);
  const retentionGain = computeRetentionGain(snaps, retentionDays);
  const availableGraphWindows = buildAvailableGraphWindows(retentionDays)
    .filter((window) => hasEnoughGraphHistory(snaps, window.windowMs));
  const defaultGraphWindow = availableGraphWindows.find((w) => w.key !== "all")?.key ?? null;
  const trend      = computeTrend(snaps);
  const trendCls   = trend?.level.cls ?? "stable";
  const latestChangePct = computeLatestChangePct(snaps);
  const display = computeDisplayTrend(trend, latestChangePct);
  const stroke     = sparklineColor(snaps);
  const svgStr     = buildSparklineSVG(snaps);
  
  const activeWindowKey = defaultGraphWindow ?? "all";
  const activeWindowMs = GRAPH_WINDOW_MS[activeWindowKey];
  const filteredSnapsForWindow = filterSnapshotsByWindow(snaps, activeWindowMs);
  const recordLow = computeWindowMin(filteredSnapsForWindow);
  const allTimeLow = computeWindowMin(snaps);

  return {
    game,
    current,
    peak24h,
    allTimePeak,
    ...(data?.allTimePeakLabel ? { allTimePeakLabel: data.allTimePeakLabel } : {}),
    displayTrendPct: display.pct,
    displayTrendIcon: display.icon,
    displayTrendCls: display.cls,
    ...(avg24h != null ? { avg24h } : {}),
    ...(gain24h != null ? { gain24h } : {}),
    ...(retentionAvg != null ? { retentionAvg } : {}),
    ...(retentionGain != null ? { retentionGain } : {}),
    retentionDays,
    availableGraphWindows,
    defaultGraphWindow,
    trend,
    trendCls,
    latestChangePct,
    snaps,
    sparklineStroke: stroke,
    svgStr,
    fetchedAt: data?.fetchedAt ?? 0,
    ...(data?.twitchViewers != null ? { twitchViewers: data.twitchViewers } : {}),
    ...(data?.discountPct   != null ? { discountPct:   data.discountPct   } : {}),
    ...(data?.priceFormatted         ? { priceFormatted:         data.priceFormatted         } : {}),
    ...(data?.priceOriginalFormatted ? { priceOriginalFormatted: data.priceOriginalFormatted } : {}),
    recordLow,
    allTimeLow,
    ...(data?.itadHistoricalLow ? { itadHistoricalLow: data.itadHistoricalLow } : {}),
    ...(data?.itadUuid ? { itadUuid: data.itadUuid } : {}),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeDisplayTrend(
  trend: ReturnType<typeof computeTrend>,
  latestChangePct: number | null,
): { pct: number | null; icon: string | null; cls: string } {
  if (trend) {
    return { pct: trend.pct, icon: trend.level.icon, cls: trend.level.cls };
  }
  if (latestChangePct != null) {
    // When we don't yet have enough history for a smoothed trend,
    // fall back to the last-interval change (still useful early on).
    return { pct: latestChangePct, icon: "↕", cls: pctToBadgeClass(latestChangePct) };
  }
  return { pct: null, icon: null, cls: "stable" };
}

function pctToBadgeClass(pct: number): string {
  if (pct >= 8) return "strong-up";
  if (pct >= 2) return "up";
  if (pct <= -8) return "strong-down";
  if (pct <= -2) return "down";
  return "stable";
}

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
  return Promise.all(
    games.map(async (game) => {
      let snaps: Snapshot[] = [];
      try {
        snaps = await loadSnaps(game.appid);
      } catch {
        /* non-critical — render card without trend/sparkline */
      }
      return buildCardViewModel(game, cache, snaps, retentionDays);
    }),
  );
}
