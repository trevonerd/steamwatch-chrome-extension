// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/background/index.ts
// MV3 Service Worker. Handles alarms, data fetching, notifications,
// and dynamic badge updates.
//
// Not affiliated with Valve Corporation or Steam®.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchCurrentPlayers, fetchSteamChartsBootstrap, fetchSteamChartsData, fetchSteamSpyData, fetchTwitchViewers } from "../utils/api.js";
import { compactSnapshots } from "../utils/compaction.js";
import {
  getGames,
  getSettings,
  getGameSettings,
  setCache,
  getCache,
  setLastFetchTime,
} from "../utils/storage.js";
import { idbBulkSaveSnapshots, idbSaveSnapshot, idbGetSnapshots, idbGetCooldown, idbSetCooldown } from "../utils/idb-storage.js";
import { migrateToIndexedDB, migrateImageUrls } from "../utils/migrate.js";
import { computeTrend, fmtNumber, fmtBadge } from "../utils/trend.js";
import { isQuietNow } from "../utils/quietHours.js";
import { buildCachedData, mergeCycleCache } from "./fetchCycle.js";

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
  trend_up:   30 * 60_000,
  trend_down: 30 * 60_000,
  absolute:   60 * 60_000,
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => void bootstrap());
chrome.runtime.onStartup.addListener(() => void bootstrap());

async function bootstrap(): Promise<void> {
  void migrateToIndexedDB(); // fire-and-forget — don't block extension startup
  void migrateImageUrls();   // fire-and-forget — fix stale image URLs in storage
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

  const nextCache = mergeCycleCache(prevCache, cacheResults);
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
  try {
    const bootstrapKey = `bootstrap__${game.appid}`;
    const alreadyBootstrapped = await idbGetCooldown(bootstrapKey);
    if (!alreadyBootstrapped) {
      await idbSetCooldown(bootstrapKey, Date.now() + 10 * 365 * 86_400_000);
      const bootstrapSnaps = await fetchSteamChartsBootstrap(game.appid);
      if (bootstrapSnaps.length > 0) {
        await idbBulkSaveSnapshots(game.appid, bootstrapSnaps);
      }
    }
  } catch (err) {
    console.warn("[SteamWatch] Bootstrap failed for", game.appid, err);
  }

  const [currentPlayers, spyData] = await Promise.all([
    fetchCurrentPlayers(game.appid),
    fetchSteamSpyData(game.appid),
  ]);
  const [chartsData, twitchViewers] = await Promise.all([
    fetchSteamChartsData(game.appid),
    fetchTwitchViewers(game.name).catch(() => null),
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
    ...(chartsData.peak24h !== undefined ? { peak24h: chartsData.peak24h } : {}),
    ...(resolvedAllTimePeak > 0 ? { allTimePeak: resolvedAllTimePeak } : {}),
    ...(chartsData.allTimePeakLabel !== undefined ? { allTimePeakLabel: chartsData.allTimePeakLabel } : {}),
    ...(prevCache !== undefined ? { prevCache } : {}),
    fetchedAt,
    twitchViewers,
  });

  const perGame = await getGameSettings(game.appid);

  if (!settings.trendEnabled) {
    if (settings.notificationsEnabled) {
      await evaluateAbsoluteNotification(game, resolvedCurrent, perGame);
    }
    return { game, signal: "stable", cacheData };
  }

  const snap: Snapshot = { ts: Date.now(), current: resolvedCurrent };
  await idbSaveSnapshot(game.appid, snap);
  const updatedSnaps = await idbGetSnapshots(game.appid);

  if (!settings.notificationsEnabled) {
    return { game, signal: deriveSignal(updatedSnaps), cacheData };
  }

  const alerted = await evaluateNotifications(game, resolvedCurrent, updatedSnaps, settings, perGame);

  if (alerted === "trend_down") {
    return { game, signal: "alerting", cacheData };
  }
  if (alerted === "trend_up") {
    return { game, signal: "rising", cacheData };
  }
  return { game, signal: deriveSignal(updatedSnaps), cacheData };
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

  const trend = computeTrend(snapshots);
  if (!trend) return null;

  const tUp    = perGame.thresholdUp    ?? global.globalThresholdUp;
  const tDown  = perGame.thresholdDown  ?? global.globalThresholdDown;

  if (trend.pct >= tUp) {
    await notify(game, "trend_up",   `📈 ${game.name} — Rising`,    `+${trend.pct}% · ${fmtNumber(current)} online`);
    return "trend_up";
  }
  if (trend.pct <= tDown && trend.pct !== 0) {
    await notify(game, "trend_down", `📉 ${game.name} — Declining`,  `${trend.pct}% drop · ${fmtNumber(current)} online`);
    return "trend_down";
  }

  return null;
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

  const expiresAt = await idbGetCooldown(key).catch(() => null);
  if (expiresAt !== null && expiresAt > now) return;

  const settings = await getSettings();
  if (isQuietNow(settings)) return;

  await idbSetCooldown(key, now + cooldown).catch(() => undefined);
  chrome.notifications.create(`sw_${key}_${now}`, {
    type:     "basic",
    iconUrl:  "/icons/logo-128.png",
    title,
    message,
    priority: type === "absolute" ? 2 : 1,
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
