// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/background/index.ts
// MV3 Service Worker. Handles alarms, data fetching, notifications,
// and dynamic badge updates.
//
// Not affiliated with Valve Corporation or Steam®.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchCurrentPlayers, fetchSteamChartsData, fetchSteamSpyData, fetchTwitchViewers, fetchPriceData } from "../utils/api.js";
import { compactSnapshots } from "../utils/compaction.js";
import {
  getGames,
  getSettings,
  getGameSettings,
  setCache,
  getCache,
  setLastFetchTime,
} from "../utils/storage.js";
import { idbSaveSnapshot, idbGetSnapshots, idbSaveItadMapping, idbGetItadMapping } from "../utils/idb-storage.js";
import { migrateToIndexedDB } from "../utils/migrate.js";
import { computeTrend, detectSpike, fmtNumber, fmtBadge } from "../utils/trend.js";
import { isQuietNow } from "../utils/quietHours.js";
import { buildCachedData, mergeCycleCache } from "./fetchCycle.js";
import { lookupItadGame, fetchHistoricalLow } from "../utils/itad-api.js";
import type {
  CachedData,
  Game,
  Settings,
  GameSettings,
  Snapshot,
  MessageRequest,
  MessageResponse,
} from "../types/index.js";

const ALARM_NAME = "sw_fetch";
const COMPACTION_ALARM_NAME = "steamwatch-compaction";

const COOLDOWNS: Record<string, number> = {
  spike:      20 * 60_000,
  trend_up:   30 * 60_000,
  trend_down: 30 * 60_000,
  crash:      15 * 60_000,
  absolute:   60 * 60_000,
  price_drop: 120 * 60_000,
};

const lastNotifiedAt = new Map<string, number>();

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => void bootstrap());
chrome.runtime.onStartup.addListener(() => void bootstrap());

async function bootstrap(): Promise<void> {
  void migrateToIndexedDB(); // fire-and-forget — don't block extension startup
  await resetAlarm();
  await resetCompactionAlarm();
  await fetchAll();
}

async function resetAlarm(): Promise<void> {
  const { fetchIntervalMinutes } = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: fetchIntervalMinutes });
}

async function resetCompactionAlarm(): Promise<void> {
  await chrome.alarms.clear(COMPACTION_ALARM_NAME);
  chrome.alarms.create(COMPACTION_ALARM_NAME, { periodInMinutes: 24 * 60 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void fetchAll();
  if (alarm.name === COMPACTION_ALARM_NAME) void runCompaction();
});

async function runCompaction(): Promise<void> {
  const games = await getGames();
  const settings = await getSettings();
  const fullResolutionDays = settings.purgeAfterDays ?? 7;
  await Promise.allSettled(games.map((game) => compactSnapshots(game.appid, fullResolutionDays)));
}

// ── Message handling ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: MessageRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ): boolean => {
    if (message.type === "FETCH_NOW") {
      fetchAll()
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (message.type === "RESET_ALARM") {
      resetAlarm()
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    return false;
  }
);

// ── Core fetch loop ───────────────────────────────────────────────────────────

async function fetchAll(): Promise<void> {
  const [games, settings, prevCache] = await Promise.all([
    getGames(),
    getSettings(),
    getCache(),
  ]);
  if (games.length === 0) {
    updateBadge(0, 0, undefined, {}, new Map());
    return;
  }

  const fetchedAt = Date.now();
  const results = await Promise.allSettled(
    games.map((game) => fetchGame(game, settings, prevCache, fetchedAt))
  );

  let rising = 0;
  let alerting = 0;
  const cacheResults: Array<{ game: Game; cacheData?: CachedData }> = [];
  const gameSignals = new Map<string, "rising" | "alerting" | "stable">();
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.signal === "rising")   rising++;
      if (r.value.signal === "alerting") alerting++;
      gameSignals.set(r.value.game.appid, r.value.signal);
      cacheResults.push({
        game: r.value.game,
        ...(r.value.cacheData ? { cacheData: r.value.cacheData } : {}),
      });
    }
  }

  const uuidLookupList: string[] = [];
  const appIdToItadUuid = new Map<string, string>();
  for (const game of games) {
    const uuid = cacheResults.find(r => r.game.appid === game.appid)?.cacheData?.itadUuid
      ?? prevCache[game.appid]?.itadUuid;
    if (uuid) {
      uuidLookupList.push(uuid);
      appIdToItadUuid.set(game.appid, uuid);
    }
  }

  const itadLowMap = uuidLookupList.length > 0
    ? await fetchHistoricalLow(uuidLookupList).catch(() => new Map<string, { amountInt: number; cut: number; timestamp: string }>())
    : new Map<string, { amountInt: number; cut: number; timestamp: string }>();

  const enrichedResults = cacheResults.map(r => {
    const uuid = appIdToItadUuid.get(r.game.appid);
    if (!r.cacheData || !uuid) return r;
    const low = itadLowMap.get(uuid);
    if (!low) return r;
    return { ...r, cacheData: { ...r.cacheData, itadHistoricalLow: low } };
  });

  const nextCache = mergeCycleCache(prevCache, enrichedResults);
  await setCache(nextCache);

  await setLastFetchTime(fetchedAt);

  updateBadge(rising, alerting, settings.badgeFavoriteAppid, nextCache, gameSignals);
}

async function fetchGame(
  game: Game,
  settings: Settings,
  prevCacheMap: Record<string, CachedData>,
  fetchedAt: number,
): Promise<{
  readonly game: Game;
  readonly signal: "rising" | "alerting" | "stable";
  readonly cacheData?: CachedData;
}> {
  const [currentPlayers, spyData] = await Promise.all([
    fetchCurrentPlayers(game.appid),
    fetchSteamSpyData(game.appid),
  ]);
  const [chartsData, twitchViewers, priceData] = await Promise.all([
    fetchSteamChartsData(game.appid),
    fetchTwitchViewers(game.name).catch(() => null),
    fetchPriceData(game.appid).catch(() => null),
  ]);

  const resolvedCurrent = currentPlayers ?? chartsData.current ?? null;
  if (resolvedCurrent === null) return { game, signal: "stable" };

  const prevCache = prevCacheMap[game.appid];
  const resolvedAllTimePeak = Math.max(
    chartsData.allTimePeak ?? 0,
    spyData.peak,
    prevCache?.allTimePeak ?? 0,
    resolvedCurrent,
  );

  const cacheData = buildCachedData({
    currentPlayers: resolvedCurrent,
    peak24h: chartsData.peak24h,
    allTimePeak: resolvedAllTimePeak > 0 ? resolvedAllTimePeak : undefined,
    allTimePeakLabel: chartsData.allTimePeakLabel,
    prevCache,
    fetchedAt,
    twitchViewers,
    ...(priceData != null
      ? {
          priceOriginal:         priceData.priceOriginal,
          priceCurrent:          priceData.priceCurrent,
          discountPct:           priceData.discountPct,
          priceFormatted:        priceData.currentFormatted,
          priceOriginalFormatted: priceData.originalFormatted,
        }
      : { discountPct: 0 }), // signal "not on sale" so buildCachedData clears prev price
  });

  let itadUuid: string | undefined;
  const existingUuid = await idbGetItadMapping(game.appid).catch(() => null);
  if (existingUuid) {
    itadUuid = existingUuid;
  } else {
    const lookedUp = await lookupItadGame(game.appid).catch(() => null);
    if (lookedUp) {
      itadUuid = lookedUp;
      await idbSaveItadMapping(game.appid, lookedUp).catch(() => undefined);
    }
  }

  const cacheDataWithItad = itadUuid
    ? { ...cacheData, itadUuid }
    : cacheData;

  const perGame = await getGameSettings(game.appid);

  if (settings.notificationsEnabled) {
    await evaluatePriceNotification(game, cacheDataWithItad, prevCache, settings, perGame);
  }

  if (!settings.trendEnabled) {
    if (settings.notificationsEnabled) {
      await evaluateAbsoluteNotification(game, resolvedCurrent, perGame);
    }
    return { game, signal: "stable", cacheData: cacheDataWithItad };
  }

  const snap: Snapshot = { ts: Date.now(), current: resolvedCurrent };
  await idbSaveSnapshot(game.appid, snap);
  const updatedSnaps = await idbGetSnapshots(game.appid);

  if (!settings.notificationsEnabled) {
    return { game, signal: deriveSignal(updatedSnaps), cacheData: cacheDataWithItad };
  }

  const alerted = await evaluateNotifications(game, resolvedCurrent, updatedSnaps, settings, perGame);

  if (alerted === "crash" || alerted === "trend_down") {
    return { game, signal: "alerting", cacheData: cacheDataWithItad };
  }
  if (alerted === "spike_down") {
    return { game, signal: "alerting", cacheData: cacheDataWithItad };
  }
  if (alerted === "trend_up" || alerted === "spike_up") {
    return { game, signal: "rising", cacheData: cacheDataWithItad };
  }
  return { game, signal: deriveSignal(updatedSnaps), cacheData: cacheDataWithItad };
}

function deriveSignal(snaps: readonly Snapshot[]): "rising" | "alerting" | "stable" {
  const trend = computeTrend(snaps);
  if (!trend) return "stable";
  if (trend.pct >= 5)   return "rising";
  if (trend.pct <= -20) return "alerting";
  return "stable";
}

// ── Notification logic ────────────────────────────────────────────────────────

async function evaluateNotifications(
  game: Game,
  current: number,
  snapshots: readonly Snapshot[],
  global: Settings,
  perGame: GameSettings
): Promise<string | null> {
  if (perGame.notificationsEnabled === false) return null;

  const absoluteAlert = await evaluateAbsoluteNotification(game, current, perGame);
  if (absoluteAlert) return absoluteAlert;

  if (global.spikeDetection && snapshots.length >= 2) {
    const spike = detectSpike(snapshots);
    if (spike) {
      const symbol = spike.type === "spike_up" ? "⚡ Spike UP" : "⚡ Spike DOWN";
      const pctStr = spike.pct > 0 ? `+${spike.pct}%` : `${spike.pct}%`;

      await notify(game, "spike", `${symbol} — ${game.name}`, `${pctStr} in one interval`);
      return spike.type;
    }
  }

  const trend = computeTrend(snapshots);
  if (!trend) return null;

  const tUp    = perGame.thresholdUp    ?? global.globalThresholdUp;
  const tDown  = perGame.thresholdDown  ?? global.globalThresholdDown;
  const tCrash = perGame.crashThreshold ?? global.crashThreshold;

  if (trend.pct >= tUp) {
    await notify(game, "trend_up",   `📈 ${game.name} — Rising`,    `+${trend.pct}% · ${fmtNumber(current)} online`);
    return "trend_up";
  }
  if (trend.pct <= tCrash) {
    await notify(game, "crash",      `💀 ${game.name} — Crash`,     `${trend.pct}% collapse · ${fmtNumber(current)} remaining`);
    return "crash";
  }
  if (trend.pct <= tDown) {
    await notify(game, "trend_down", `📉 ${game.name} — Declining`,  `${trend.pct}% drop · ${fmtNumber(current)} online`);
    return "trend_down";
  }

  return null;
}

async function evaluatePriceNotification(
  game: Game,
  cache: CachedData,
  prevCache: CachedData | undefined,
  global: Settings,
  perGame: GameSettings,
): Promise<void> {
  if (!global.priceAlertsEnabled) return;
  if (perGame.priceAlertsEnabled === false) return;
  const disc = cache.discountPct;
  if (!disc || disc < global.priceDropMinPct) return;
  // Only fire when the sale is newly detected (wasn't on sale before, or discount increased)
  const prevDisc = prevCache?.discountPct ?? 0;
  if (disc <= prevDisc) return;
  const price = cache.priceFormatted ?? "";
  const orig  = cache.priceOriginalFormatted ?? "";
  await notify(
    game,
    "price_drop",
    `💸 ${game.name} — ${disc}% OFF`,
    price && orig ? `${price} (was ${orig})` : `${disc}% discount!`,
  );
}

async function evaluateAbsoluteNotification(
  game: Game,
  current: number,
  perGame: GameSettings,
): Promise<"absolute" | null> {
  if (perGame.notificationsEnabled === false) return null;
  const abs = perGame.notifyThresholdPlayers;
  if (abs != null && current >= abs) {
    await notify(game, "absolute", `🎯 ${game.name}`, `Reached ${fmtNumber(current)} concurrent players!`);
    return "absolute";
  }
  return null;
}

async function notify(game: Game, type: string, title: string, message: string): Promise<void> {
  const cooldown = COOLDOWNS[type] ?? 30 * 60_000;
  const key = `${game.appid}__${type}`;
  const now = Date.now();

  // Check cooldown first (cheap, synchronous-equivalent)
  if ((lastNotifiedAt.get(key) ?? 0) + cooldown > now) return;

  // Quiet hours check — suppress silently WITHOUT consuming the cooldown slot,
  // so the notification will fire on the next cycle once quiet hours are over.
  const settings = await getSettings();
  if (isQuietNow(settings)) return;

  lastNotifiedAt.set(key, now);
  chrome.notifications.create(`sw_${key}_${now}`, {
    type:     "basic",
    iconUrl:  "/icons/logo-128.png",
    title,
    message,
    priority: type === "crash" ? 2 : 1,
  });
}

// ── Badge ─────────────────────────────────────────────────────────────────────

/**
 * Update the extension icon badge.
 * If a favorite game is set, show its player count (short format) with trend color.
 * Otherwise: alerting (red) > rising (green) > clear.
 */
function updateBadge(
  rising: number,
  alerting: number,
  favoriteAppid: string | undefined,
  cache: Record<string, CachedData>,
  gameSignals: Map<string, "rising" | "alerting" | "stable">,
): void {
  if (favoriteAppid) {
    const cached = cache[favoriteAppid];
    if (cached) {
      const signal = gameSignals.get(favoriteAppid) ?? "stable";
      const text = fmtBadge(cached.current);
      const [bg, fg] =
        signal === "alerting" ? ["#ff3366", "#ffffff"] :
        signal === "rising"   ? ["#22c55e", "#000000"] :
                                ["#334155", "#94a3b8"];
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: bg });
      chrome.action.setBadgeTextColor?.({ color: fg });
      return;
    }
  }
  // Default: count-based behavior
  if (alerting > 0) {
    chrome.action.setBadgeText({ text: String(alerting) });
    chrome.action.setBadgeBackgroundColor({ color: "#ff3366" });
    chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
    return;
  }
  if (rising > 0) {
    chrome.action.setBadgeText({ text: String(rising) });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    chrome.action.setBadgeTextColor?.({ color: "#000000" });
    return;
  }
  chrome.action.setBadgeText({ text: "" });
}
