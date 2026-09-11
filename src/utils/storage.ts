// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/storage.ts
// All chrome.storage.local access goes through here.
// Every function is typed, handles errors, and never silently fails.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { deleteNotificationState } from "../background/notificationState.js";
import {
  CachedDataSchema,
  GameSchema,
  GameSettingsSchema,
  SettingsSchema,
} from "../types/index.js";
import type {
  Game,
  CachedData,
  Settings,
  GameSettings,
} from "../types/index.js";
import {
  idbClearAllData,
  idbClearGameTombstone,
  idbDeleteGameData,
} from "./idb-storage.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_GAMES = 10;
export const TRACKING_RETENTION_DAYS = 60;
export const FETCH_INTERVAL_MINUTES = 5;

export const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: true,
  globalThresholdUp: 30,
  globalThresholdDown: -25,
  // Quiet hours — off by default
  quietHoursEnabled: false,
  quietStart: "23:00",
  quietEnd: "07:00",
  quietDays: 0b1111111, // all 7 days
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const KEYS = {
  games: "sw_games",
  settings: "sw_settings",
  cache: "sw_cache",
  gameSettingsPrefix: "sw_gs_", // per-game: sw_gs_{appid}
  legacySnapshotsPrefix: "sw_snaps_",
  pendingGameCleanups: "sw_pending_game_cleanups",
  /** Unix ms timestamp of the last successful global fetch cycle. */
  lastFetchTime: "sw_last_fetch",
  lastFetchAttempt: "sw_last_fetch_attempt",
} as const;

let pendingGameCleanupPromise: Promise<void> | null = null;

// ── Generic helpers ───────────────────────────────────────────────────────────

async function get<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

function toRecord(raw: unknown): Record<string, unknown> | undefined {
  const parsed = z.record(z.unknown()).safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function hasChanged(raw: unknown, normalized: unknown): boolean {
  return !isEquivalent(raw, normalized);
}

function isEquivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => isEquivalent(item, right[index]));
  }

  const leftRecord = toRecord(left);
  const rightRecord = toRecord(right);
  if (!leftRecord || !rightRecord) return false;

  const leftEntries = Object.entries(leftRecord);
  const rightEntries = Object.entries(rightRecord);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value]) => key in rightRecord && isEquivalent(value, rightRecord[key]));
}

function parseCachedData(raw: unknown): CachedData | undefined {
  const parsed = CachedDataSchema.safeParse(raw);
  if (!parsed.success) return undefined;

  const {
    current,
    peak,
    peak24h,
    allTimePeak,
    allTimePeakLabel,
    localAllTimePeak,
    fetchedAt,
    twitchViewers,
    freshness,
    ...legacyFields
  } = parsed.data;
  return {
    ...legacyFields,
    current,
    ...(peak !== undefined ? { peak } : {}),
    ...(peak24h !== undefined ? { peak24h } : {}),
    ...(allTimePeak !== undefined ? { allTimePeak } : {}),
    ...(allTimePeakLabel !== undefined ? { allTimePeakLabel } : {}),
    ...(localAllTimePeak !== undefined ? { localAllTimePeak } : {}),
    fetchedAt,
    ...(twitchViewers !== undefined ? { twitchViewers } : {}),
    ...(freshness !== undefined ? { freshness } : {}),
  };
}

// ── Games ─────────────────────────────────────────────────────────────────────

export async function getGames(): Promise<Game[]> {
  await resumePendingGameCleanups();
  const raw = await get<unknown>(KEYS.games);
  if (raw === undefined) return [];

  const games = parseGames(raw);
  if (hasChanged(raw, games)) await set(KEYS.games, games);
  return games;
}

function parseGames(raw: unknown): Game[] {
  const parsed = z.array(z.unknown()).safeParse(raw);
  return parsed.success
    ? parsed.data.flatMap((item) => {
      const game = GameSchema.safeParse(item);
      return game.success ? [game.data] : [];
    })
    : [];
}

export async function addGame(game: Game): Promise<Game[]> {
  const games = await getGames();

  if (games.length >= MAX_GAMES) {
    throw new Error(`Maximum ${MAX_GAMES} games reached.`);
  }
  if (games.some((g) => g.appid === game.appid)) {
    throw new Error(`"${game.name}" is already in your list.`);
  }

  await idbClearGameTombstone(game.appid);
  const updated = [...games, game];
  await set(KEYS.games, updated);
  return updated;
}

export async function removeGame(appid: string): Promise<Game[]> {
  const currentGames = await getGames();
  await addPendingGameCleanup(appid);
  const games = currentGames.filter((g) => g.appid !== appid);
  await set(KEYS.games, games);

  await cleanupGameData(appid);
  await removePendingGameCleanup(appid);

  return games;
}

function pendingGameCleanupIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  return [...new Set(raw.filter((appid): appid is string => typeof appid === "string" && appid.length > 0))];
}

async function addPendingGameCleanup(appid: string): Promise<void> {
  const pending = pendingGameCleanupIds(await get<unknown>(KEYS.pendingGameCleanups));
  if (!pending.includes(appid)) {
    await set(KEYS.pendingGameCleanups, [...pending, appid]);
  }
}

async function removePendingGameCleanup(appid: string): Promise<void> {
  const pending = pendingGameCleanupIds(await get<unknown>(KEYS.pendingGameCleanups));
  const remaining = pending.filter((pendingAppid) => pendingAppid !== appid);
  if (remaining.length === 0) {
    await chrome.storage.local.remove(KEYS.pendingGameCleanups);
    return;
  }
  await set(KEYS.pendingGameCleanups, remaining);
}

async function cleanupGameData(appid: string): Promise<void> {
  await idbDeleteGameData(appid);
  await deleteNotificationState(appid);
  await chrome.storage.local.remove([
    `${KEYS.gameSettingsPrefix}${appid}`,
    `${KEYS.legacySnapshotsPrefix}${appid}`,
  ]);

  const rawCache = toRecord(await get<unknown>(KEYS.cache));
  if (rawCache && appid in rawCache) {
    const { [appid]: _removed, ...cache } = rawCache;
    await set(KEYS.cache, cache);
  }

  const rawSettings = toRecord(await get<unknown>(KEYS.settings));
  if (rawSettings?.["badgeFavoriteAppid"] === appid) {
    const { badgeFavoriteAppid: _removed, ...settings } = rawSettings;
    await set(KEYS.settings, settings);
  }
}

async function resumePendingGameCleanups(): Promise<void> {
  if (pendingGameCleanupPromise) {
    return pendingGameCleanupPromise;
  }

  pendingGameCleanupPromise = resumePendingGameCleanupsOnce();
  try {
    await pendingGameCleanupPromise;
  } finally {
    pendingGameCleanupPromise = null;
  }
}

async function resumePendingGameCleanupsOnce(): Promise<void> {
  const raw = await get<unknown>(KEYS.pendingGameCleanups);
  const pending = pendingGameCleanupIds(raw);
  if (raw !== undefined && !isEquivalent(raw, pending)) {
    await set(KEYS.pendingGameCleanups, pending);
  }

  if (pending.length === 0) return;

  const rawGames = await get<unknown>(KEYS.games);
  if (rawGames !== undefined) {
    const games = parseGames(rawGames);
    const reconciledGames = games.filter((game) => !pending.includes(game.appid));
    if (hasChanged(rawGames, reconciledGames)) {
      await set(KEYS.games, reconciledGames);
    }
  }

  for (const appid of pending) {
    await cleanupGameData(appid);
    await removePendingGameCleanup(appid);
  }
}

export async function updateGameImage(appid: string, imageUrl: string): Promise<void> {
  const games = await getGames();
  const updated = games.map((g) =>
    g.appid === appid ? { ...g, image: imageUrl } : g,
  );
  const changed = updated.some((g, i) => g.image !== games[i]?.image);
  if (!changed) return;
  await set(KEYS.games, updated);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const stored = toRecord(await get<unknown>(KEYS.settings));
  const normalized = normalizeSettings(stored);
  if (!stored || hasChanged(stored, normalized)) {
    await set(KEYS.settings, normalized);
  }
  return normalized;
}

type SettingsPatch = { [K in keyof Settings]?: Settings[K] | undefined };

export async function saveSettings(partial: SettingsPatch): Promise<void> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...partial });
  await set(KEYS.settings, next);
}

function normalizeSettings(raw: Record<string, unknown> | undefined): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return settings;

  const notificationsEnabled = SettingsSchema.shape.notificationsEnabled.safeParse(raw["notificationsEnabled"]);
  if (notificationsEnabled.success && notificationsEnabled.data !== undefined) {
    settings.notificationsEnabled = notificationsEnabled.data;
  }
  const globalThresholdUp = SettingsSchema.shape.globalThresholdUp.safeParse(raw["globalThresholdUp"]);
  if (globalThresholdUp.success && globalThresholdUp.data !== undefined) {
    settings.globalThresholdUp = Math.max(5, Math.min(100, globalThresholdUp.data));
  }
  const globalThresholdDown = SettingsSchema.shape.globalThresholdDown.safeParse(raw["globalThresholdDown"]);
  if (globalThresholdDown.success && globalThresholdDown.data !== undefined) {
    settings.globalThresholdDown = -Math.max(5, Math.min(90, Math.abs(globalThresholdDown.data)));
  }
  const quietHoursEnabled = SettingsSchema.shape.quietHoursEnabled.safeParse(raw["quietHoursEnabled"]);
  if (quietHoursEnabled.success && quietHoursEnabled.data !== undefined) {
    settings.quietHoursEnabled = quietHoursEnabled.data;
  }
  const quietStart = SettingsSchema.shape.quietStart.safeParse(raw["quietStart"]);
  if (quietStart.success && quietStart.data !== undefined) {
    settings.quietStart = quietStart.data;
  }
  const quietEnd = SettingsSchema.shape.quietEnd.safeParse(raw["quietEnd"]);
  if (quietEnd.success && quietEnd.data !== undefined) {
    settings.quietEnd = quietEnd.data;
  }
  const quietDays = SettingsSchema.shape.quietDays.safeParse(raw["quietDays"]);
  if (quietDays.success && quietDays.data !== undefined) {
    settings.quietDays = quietDays.data & 0b1111111;
  }
  const badgeFavoriteAppid = SettingsSchema.shape.badgeFavoriteAppid.safeParse(raw["badgeFavoriteAppid"]);
  if (badgeFavoriteAppid.success && badgeFavoriteAppid.data !== undefined) {
    settings.badgeFavoriteAppid = badgeFavoriteAppid.data;
  }

  return settings;
}

// ── Per-game settings ─────────────────────────────────────────────────────────

export async function getGameSettings(appid: string): Promise<GameSettings> {
  const raw = await get<unknown>(`${KEYS.gameSettingsPrefix}${appid}`);
  if (raw === undefined) return {};

  const stored = toRecord(raw);
  if (!stored) {
    await set(`${KEYS.gameSettingsPrefix}${appid}`, {});
    return {};
  }

  const normalized: GameSettings = {};
  const thresholdUp = GameSettingsSchema.shape.thresholdUp.safeParse(stored["thresholdUp"]);
  if (thresholdUp.success && thresholdUp.data !== undefined) normalized.thresholdUp = thresholdUp.data;
  const thresholdDown = GameSettingsSchema.shape.thresholdDown.safeParse(stored["thresholdDown"]);
  if (thresholdDown.success && thresholdDown.data !== undefined) normalized.thresholdDown = thresholdDown.data;
  const notifyThresholdPlayers = GameSettingsSchema.shape.notifyThresholdPlayers.safeParse(stored["notifyThresholdPlayers"]);
  if (notifyThresholdPlayers.success && notifyThresholdPlayers.data !== undefined) {
    normalized.notifyThresholdPlayers = notifyThresholdPlayers.data;
  }
  const notifyBelowPlayers = GameSettingsSchema.shape.notifyBelowPlayers.safeParse(stored["notifyBelowPlayers"]);
  if (notifyBelowPlayers.success && notifyBelowPlayers.data !== undefined) {
    normalized.notifyBelowPlayers = notifyBelowPlayers.data;
  }
  const notificationsEnabled = GameSettingsSchema.shape.notificationsEnabled.safeParse(stored["notificationsEnabled"]);
  if (notificationsEnabled.success && notificationsEnabled.data !== undefined) {
    normalized.notificationsEnabled = notificationsEnabled.data;
  }

  if (hasChanged(stored, normalized)) await set(`${KEYS.gameSettingsPrefix}${appid}`, normalized);
  return normalized;
}

export async function saveGameSettings(
  appid: string,
  partial: GameSettings
): Promise<void> {
  const current = await getGameSettings(appid);
  await set(`${KEYS.gameSettingsPrefix}${appid}`, { ...current, ...partial });
}

// ── Cache ─────────────────────────────────────────────────────────────────────

type CacheMap = Record<string, CachedData>;

export async function getCache(): Promise<CacheMap> {
  const raw = await get<unknown>(KEYS.cache);
  if (raw === undefined) return {};

  const stored = toRecord(raw);
  const cache: CacheMap = {};
  if (stored) {
    for (const [appid, value] of Object.entries(stored)) {
      const parsed = parseCachedData(value);
      if (parsed) cache[appid] = parsed;
    }
  }

  if (!stored || hasChanged(stored, cache)) await set(KEYS.cache, cache);
  return cache;
}

export async function setCache(cache: CacheMap): Promise<void> {
  await set(KEYS.cache, cache);
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
  await idbClearAllData();
}

// ── Global last-fetch timestamp ───────────────────────────────────────────────

/**
 * Persist the Unix ms timestamp of the most recent successful fetch cycle.
 * Called by the service worker after every `fetchAll()` run completes.
 * Returns 0 if the key has never been written.
 */
export async function setLastFetchTime(ts: number): Promise<void> {
  await set(KEYS.lastFetchTime, ts);
}

/** Read the last-fetch timestamp. Returns 0 if never set. */
export async function getLastFetchTime(): Promise<number> {
  return (await get<number>(KEYS.lastFetchTime)) ?? 0;
}

export async function setLastFetchAttemptTime(ts: number): Promise<void> {
  await set(KEYS.lastFetchAttempt, ts);
}

export async function getLastFetchAttemptTime(): Promise<number> {
  const parsed = z.number().finite().nonnegative().safeParse(await get<unknown>(KEYS.lastFetchAttempt));
  return parsed.success ? parsed.data : 0;
}
