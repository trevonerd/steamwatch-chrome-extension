import { compactSnapshots } from "../utils/compaction.js";
import { migrateToIndexedDB } from "../utils/migrate.js";
import { FETCH_INTERVAL_MINUTES, getCache, getGames, getSettings, TRACKING_RETENTION_DAYS } from "../utils/storage.js";
import { createRefreshCoordinator } from "./refreshCoordinator.js";
import { refreshBadgeFromCache } from "./signals.js";
import { formatError } from "../utils/log.js";
import { CachedDataSchema } from "../types/index.js";

import type { MessageRequest, MessageResponse } from "../types/index.js";

const ALARM_NAME = "sw_fetch";
const COMPACTION_ALARM_NAME = "steamwatch-compaction";
const refreshCoordinator = createRefreshCoordinator();

chrome.runtime.onInstalled.addListener(() => void bootstrap().catch((error: unknown) => console.warn(`[SteamWatch] Install bootstrap failed: ${formatError(error)}`)));
chrome.runtime.onStartup.addListener(() => void bootstrap().catch((error: unknown) => console.warn(`[SteamWatch] Startup bootstrap failed: ${formatError(error)}`)));

async function bootstrap(): Promise<void> {
  await migrateToIndexedDB();
  await resetAlarm();
  await resetCompactionAlarm();
  await refreshCoordinator.refresh();
}

async function resetAlarm(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: FETCH_INTERVAL_MINUTES });
}

async function resetCompactionAlarm(): Promise<void> {
  await chrome.alarms.clear(COMPACTION_ALARM_NAME);
  chrome.alarms.create(COMPACTION_ALARM_NAME, { periodInMinutes: 24 * 60 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshCoordinator.refresh().catch((error: unknown) => console.warn(`[SteamWatch] Fetch alarm failed: ${formatError(error)}`));
  if (alarm.name === COMPACTION_ALARM_NAME) void runCompaction().catch((error: unknown) => console.warn(`[SteamWatch] Compaction alarm failed: ${formatError(error)}`));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes["sw_settings"] || changes["sw_games"]) {
    void refreshFavoriteBadge().catch((error: unknown) => console.warn(`[SteamWatch] Badge refresh failed: ${formatError(error)}`));
    return;
  }
  const cacheChange = changes["sw_cache"];
  if (cacheChange) {
    void refreshBadgeForCurrentChange(cacheChange.oldValue, cacheChange.newValue)
      .catch((error: unknown) => console.warn(`[SteamWatch] Badge refresh failed: ${formatError(error)}`));
  }
});

async function refreshFavoriteBadge(): Promise<void> {
  const [cache, settings] = await Promise.all([getCache(), getSettings()]);
  refreshBadgeFromCache(settings.badgeFavoriteAppid, cache);
}

async function refreshBadgeForCurrentChange(before: unknown, after: unknown): Promise<void> {
  const settings = await getSettings();
  const favorite = settings.badgeFavoriteAppid;
  if (!favorite || cacheMarker(before, favorite) === cacheMarker(after, favorite)) return;
  refreshBadgeFromCache(favorite, await getCache());
}

function cacheMarker(raw: unknown, appid: string): string {
  if (!raw || typeof raw !== "object") return "missing";
  const entry = Object.entries(raw).find(([key]) => key === appid)?.[1];
  const parsed = CachedDataSchema.safeParse(entry);
  if (!parsed.success) return "missing";
  const freshness = parsed.data.freshness?.current;
  return `${parsed.data.current}:${parsed.data.fetchedAt}:${freshness?.status ?? "legacy"}:${freshness?.attemptedAt ?? 0}`;
}

async function runCompaction(): Promise<void> {
  const games = await getGames();
  await Promise.allSettled(games.map((game) => compactSnapshots(game.appid, TRACKING_RETENTION_DAYS)));
}

chrome.runtime.onMessage.addListener(
  (
    message: MessageRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ): boolean => {
    if (message.type === "FETCH_NOW") {
      refreshCoordinator.refresh(message.retryHistory === true)
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
    if (message.type === "RESET_ALARM") {
      resetAlarm()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
    return false;
  },
);
