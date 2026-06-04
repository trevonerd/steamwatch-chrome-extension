// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/storage.ts
// All chrome.storage.local access goes through here.
// Every function is typed, handles errors, and never silently fails.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Game,
  CachedData,
  Settings,
  GameSettings,
} from "../types/index.js";
import { idbClearAllData, idbDeleteSnapshots } from "./idb-storage.js";

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
  /** Unix ms timestamp of the last successful global fetch cycle. */
  lastFetchTime: "sw_last_fetch",
} as const;

// ── Generic helpers ───────────────────────────────────────────────────────────

async function get<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// ── Games ─────────────────────────────────────────────────────────────────────

export async function getGames(): Promise<Game[]> {
  return (await get<Game[]>(KEYS.games)) ?? [];
}

export async function addGame(game: Game): Promise<Game[]> {
  const games = await getGames();

  if (games.length >= MAX_GAMES) {
    throw new Error(`Maximum ${MAX_GAMES} games reached.`);
  }
  if (games.some((g) => g.appid === game.appid)) {
    throw new Error(`"${game.name}" is already in your list.`);
  }

  const updated = [...games, game];
  await set(KEYS.games, updated);
  return updated;
}

export async function removeGame(appid: string): Promise<Game[]> {
  const games = (await getGames()).filter((g) => g.appid !== appid);
  await set(KEYS.games, games);

  // Clean up per-game settings left in chrome.storage.local.
  await chrome.storage.local.remove([
    `${KEYS.gameSettingsPrefix}${appid}`,
  ]);
  await idbDeleteSnapshots(appid);

  // Remove from cache
  const cache = await getCache();
  const { [appid]: _removed, ...rest } = cache;
  await set(KEYS.cache, rest);

  return games;
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
  const stored = await get<Record<string, unknown>>(KEYS.settings);
  const normalized = normalizeSettings(stored);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(normalized)) {
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

  if (typeof raw["notificationsEnabled"] === "boolean") {
    settings.notificationsEnabled = raw["notificationsEnabled"];
  }
  if (typeof raw["globalThresholdUp"] === "number" && Number.isFinite(raw["globalThresholdUp"])) {
    settings.globalThresholdUp = Math.max(5, Math.min(100, raw["globalThresholdUp"]));
  }
  if (typeof raw["globalThresholdDown"] === "number" && Number.isFinite(raw["globalThresholdDown"])) {
    settings.globalThresholdDown = -Math.max(5, Math.min(90, Math.abs(raw["globalThresholdDown"])));
  }
  if (typeof raw["quietHoursEnabled"] === "boolean") {
    settings.quietHoursEnabled = raw["quietHoursEnabled"];
  }
  if (typeof raw["quietStart"] === "string" && raw["quietStart"]) {
    settings.quietStart = raw["quietStart"];
  }
  if (typeof raw["quietEnd"] === "string" && raw["quietEnd"]) {
    settings.quietEnd = raw["quietEnd"];
  }
  if (typeof raw["quietDays"] === "number" && Number.isInteger(raw["quietDays"])) {
    settings.quietDays = raw["quietDays"] & 0b1111111;
  }
  if (typeof raw["badgeFavoriteAppid"] === "string" && raw["badgeFavoriteAppid"]) {
    settings.badgeFavoriteAppid = raw["badgeFavoriteAppid"];
  }

  return settings;
}

// ── Per-game settings ─────────────────────────────────────────────────────────

export async function getGameSettings(appid: string): Promise<GameSettings> {
  return (await get<GameSettings>(`${KEYS.gameSettingsPrefix}${appid}`)) ?? {};
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
  return (await get<CacheMap>(KEYS.cache)) ?? {};
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
