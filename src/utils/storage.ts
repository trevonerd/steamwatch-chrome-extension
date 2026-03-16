// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/storage.ts
// All chrome.storage.local access goes through here.
// Every function is typed, handles errors, and never silently fails.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Game,
  Snapshot,
  CachedData,
  Settings,
  GameSettings,
} from "../types/index.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_GAMES = 5;
const MIN_RETENTION_DAYS = 3;
const SNAPSHOT_BUFFER = 12;

export const DEFAULT_SETTINGS: Settings = {
  trendEnabled: true,
  purgeAfterDays: 7,
  notificationsEnabled: true,
  spikeDetection: true,
  globalThresholdUp: 30,
  globalThresholdDown: -25,
  crashThreshold: -50,
  fetchIntervalMinutes: 15,
  // Quiet hours — off by default
  quietHoursEnabled: false,
  quietStart: "23:00",
  quietEnd: "07:00",
  quietDays: 0b1111111, // all 7 days
  // Ranking
  rankByPlayers: true,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const KEYS = {
  games: "sw_games",
  settings: "sw_settings",
  cache: "sw_cache",
  snapPrefix: "sw_snaps_", // per-game: sw_snaps_{appid}
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

  // Clean up all per-game data
  await chrome.storage.local.remove([
    `${KEYS.snapPrefix}${appid}`,
    `${KEYS.gameSettingsPrefix}${appid}`,
  ]);

  // Remove from cache
  const cache = await getCache();
  const { [appid]: _removed, ...rest } = cache;
  await set(KEYS.cache, rest);

  return games;
}

// ── Snapshots — lazy per-game loading ────────────────────────────────────────

export async function getSnapshotsForGame(appid: string): Promise<Snapshot[]> {
  return (await get<Snapshot[]>(`${KEYS.snapPrefix}${appid}`)) ?? [];
}

export async function addSnapshot(appid: string, snap: Snapshot): Promise<Snapshot[]> {
  const settings = await getSettings();
  const existing = await getSnapshotsForGame(appid);
  const updated = [...existing, snap].slice(-getSnapshotCapacity(settings.purgeAfterDays, settings.fetchIntervalMinutes));
  await set(`${KEYS.snapPrefix}${appid}`, updated);
  return updated;
}

export async function purgeSnapshotsForGame(
  appid: string,
  days: number
): Promise<void> {
  const cutoff = Date.now() - days * 86_400_000;
  const snaps = await getSnapshotsForGame(appid);
  const pruned = snaps.filter((s) => s.ts > cutoff);
  await set(`${KEYS.snapPrefix}${appid}`, pruned);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const stored = await get<Partial<Settings>>(KEYS.settings);
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  merged.purgeAfterDays = Math.max(MIN_RETENTION_DAYS, merged.purgeAfterDays);
  merged.fetchIntervalMinutes = Math.max(5, merged.fetchIntervalMinutes);
  return merged;
}

export async function saveSettings(partial: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const next = { ...current, ...partial };
  next.purgeAfterDays = Math.max(MIN_RETENTION_DAYS, next.purgeAfterDays);
  next.fetchIntervalMinutes = Math.max(5, next.fetchIntervalMinutes);
  await set(KEYS.settings, next);
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

export function getSnapshotCapacity(purgeAfterDays: number, fetchIntervalMinutes: number): number {
  const days = Math.max(MIN_RETENTION_DAYS, purgeAfterDays);
  const interval = Math.max(5, fetchIntervalMinutes);
  return Math.ceil((days * 24 * 60) / interval) + SNAPSHOT_BUFFER;
}
