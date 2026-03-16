// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/background/index.ts
// MV3 Service Worker. Handles alarms, data fetching, notifications,
// and dynamic badge updates.
//
// Not affiliated with Valve Corporation or Steam®.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchCurrentPlayers, fetchSteamChartsData, fetchSteamSpyData, fetchTwitchViewers } from "../utils/api.js";
import {
  getGames,
  getSettings,
  getGameSettings,
  addSnapshot,
  purgeSnapshotsForGame,
  setCache,
  getCache,
  setLastFetchTime,
} from "../utils/storage.js";
import { computeTrend, detectSpike, fmtNumber } from "../utils/trend.js";
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

const COOLDOWNS: Record<string, number> = {
  spike:      20 * 60_000,
  trend_up:   30 * 60_000,
  trend_down: 30 * 60_000,
  crash:      15 * 60_000,
  absolute:   60 * 60_000,
};

const lastNotifiedAt = new Map<string, number>();

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => void bootstrap());
chrome.runtime.onStartup.addListener(() => void bootstrap());

async function bootstrap(): Promise<void> {
  await resetAlarm();
  await fetchAll();
}

async function resetAlarm(): Promise<void> {
  const { fetchIntervalMinutes } = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: fetchIntervalMinutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void fetchAll();
});

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
    updateBadge(0, 0);
    return;
  }

  const fetchedAt = Date.now();
  const results = await Promise.allSettled(
    games.map((game) => fetchGame(game, settings, prevCache, fetchedAt))
  );

  let rising = 0;
  let alerting = 0;
  const cacheResults: Array<{ game: Game; cacheData?: CachedData }> = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.signal === "rising")   rising++;
      if (r.value.signal === "alerting") alerting++;
      cacheResults.push({
        game: r.value.game,
        ...(r.value.cacheData ? { cacheData: r.value.cacheData } : {}),
      });
    }
  }

  const nextCache = mergeCycleCache(prevCache, cacheResults);
  await setCache(nextCache);

  // Persist a global timestamp so the popup can show "Updated X min ago"
  // even when it reads from cache rather than triggering a live fetch.
  await setLastFetchTime(fetchedAt);

  updateBadge(rising, alerting);
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
    peak24h: chartsData.peak24h,
    allTimePeak: resolvedAllTimePeak > 0 ? resolvedAllTimePeak : undefined,
    allTimePeakLabel: chartsData.allTimePeakLabel,
    prevCache,
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

  await purgeSnapshotsForGame(game.appid, settings.purgeAfterDays);

  const snap: Snapshot = { ts: Date.now(), current: resolvedCurrent };
  const updatedSnaps = await addSnapshot(game.appid, snap);

  if (!settings.notificationsEnabled) {
    return { game, signal: deriveSignal(updatedSnaps), cacheData };
  }

  const alerted = await evaluateNotifications(game, resolvedCurrent, updatedSnaps, settings, perGame);

  if (alerted === "crash" || alerted === "trend_down") {
    return { game, signal: "alerting", cacheData };
  }
  if (alerted === "spike_down") {
    return { game, signal: "alerting", cacheData };
  }
  if (alerted === "trend_up" || alerted === "spike_up") {
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
    iconUrl:  "icons/icon128.png",
    title,
    message,
    priority: type === "crash" ? 2 : 1,
  });
}

// ── Badge ─────────────────────────────────────────────────────────────────────

/**
 * Update the extension icon badge.
 * Priority: alerting (red) > rising (green) > clear.
 */
function updateBadge(rising: number, alerting: number): void {
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
