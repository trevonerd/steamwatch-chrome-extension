// tests/storage.test.ts
import { beforeEach, describe, it, expect } from "vitest";
import {
  getGames,
  addGame,
  updateGameImage,
  removeGame,
  getSettings,
  saveSettings,
  getGameSettings,
  saveGameSettings,
  getCache,
  setCache,
  clearAllData,
  MAX_GAMES,
  DEFAULT_SETTINGS,
  FETCH_INTERVAL_MINUTES,
  TRACKING_RETENTION_DAYS,
} from "../src/utils/storage.js";
import type { Game, Snapshot } from "../src/types/index.js";
import { _resetDbForTesting, idbGetSnapshots, idbSaveSnapshot } from "../src/utils/idb-storage.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockGame = (n: number): Game => ({
  appid: String(n),
  name: `Game ${n}`,
  image: `https://example.com/${n}.jpg`,
});

const mockSnap = (current: number, offsetMs = 0): Snapshot => ({
  ts: Date.now() - offsetMs,
  current,
});

beforeEach(async () => {
  await _resetDbForTesting();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("steamwatch");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  await _resetDbForTesting();
});

// ── Games ─────────────────────────────────────────────────────────────────────

describe("getGames", () => {
  it("returns empty array when no games stored", async () => {
    expect(await getGames()).toEqual([]);
  });
});

describe("addGame", () => {
  it("adds a single game", async () => {
    await addGame(mockGame(1));
    expect(await getGames()).toHaveLength(1);
  });

  it("persists game data correctly", async () => {
    const g = mockGame(42);
    await addGame(g);
    const games = await getGames();
    expect(games[0]).toEqual(g);
  });

  it("throws when adding the same appid twice", async () => {
    await addGame(mockGame(1));
    await expect(addGame(mockGame(1))).rejects.toThrow("already in your list");
  });

  it(`throws when exceeding ${MAX_GAMES} games`, async () => {
    for (let i = 1; i <= MAX_GAMES; i++) {
      await addGame(mockGame(i));
    }
    await expect(addGame(mockGame(99))).rejects.toThrow(`Maximum ${MAX_GAMES}`);
  });

  it("allows adding up to MAX_GAMES games", async () => {
    for (let i = 1; i <= MAX_GAMES; i++) {
      await addGame(mockGame(i));
    }
    expect(await getGames()).toHaveLength(MAX_GAMES);
  });
});

describe("removeGame", () => {
  it("removes the correct game", async () => {
    await addGame(mockGame(1));
    await addGame(mockGame(2));
    await removeGame("1");
    const games = await getGames();
    expect(games).toHaveLength(1);
    expect(games[0]!.appid).toBe("2");
  });

  it("removing a non-existent appid leaves list unchanged", async () => {
    await addGame(mockGame(1));
    await removeGame("999");
    expect(await getGames()).toHaveLength(1);
  });

  it("also removes associated snapshots", async () => {
    await addGame(mockGame(1));
    await idbSaveSnapshot("1", mockSnap(1000));
    await removeGame("1");
    expect(await idbGetSnapshots("1")).toEqual([]);
  });

  it("also removes associated game settings", async () => {
    await addGame(mockGame(1));
    await saveGameSettings("1", { thresholdUp: 50 });
    await removeGame("1");
    const gs = await getGameSettings("1");
    expect(gs.thresholdUp).toBeUndefined();
  });

  it("also removes entry from cache", async () => {
    await setCache({ "1": { current: 1000, fetchedAt: Date.now() } });
    await removeGame("1");
    const cache = await getCache();
    expect(cache["1"]).toBeUndefined();
  });
});

describe("updateGameImage", () => {
  it("updates the image for a matching appid", async () => {
    await addGame(mockGame(1));
    await updateGameImage("1", "https://new-image.com/1.jpg");
    const games = await getGames();
    expect(games[0]!.image).toBe("https://new-image.com/1.jpg");
  });

  it("leaves other games unchanged", async () => {
    await addGame(mockGame(1));
    await addGame(mockGame(2));
    await updateGameImage("1", "https://new-image.com/1.jpg");
    const games = await getGames();
    expect(games[0]!.image).toBe("https://new-image.com/1.jpg");
    expect(games[1]!.image).toBe("https://example.com/2.jpg");
  });

  it("silently returns when appid not found", async () => {
    await addGame(mockGame(1));
    await expect(updateGameImage("999", "https://new.com/img.jpg")).resolves.toBeUndefined();
    const games = await getGames();
    expect(games).toHaveLength(1);
    expect(games[0]!.image).toBe("https://example.com/1.jpg");
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

describe("getSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettings", () => {
  it("partially updates settings", async () => {
    await saveSettings({ notificationsEnabled: false });
    const s = await getSettings();
    expect(s.notificationsEnabled).toBe(false);
    expect(s.globalThresholdUp).toBe(DEFAULT_SETTINGS.globalThresholdUp);
  });

  it("merges multiple partial saves correctly", async () => {
    await saveSettings({ notificationsEnabled: false });
    await saveSettings({ globalThresholdUp: 45 });
    const s = await getSettings();
    expect(s.notificationsEnabled).toBe(false);
    expect(s.globalThresholdUp).toBe(45);
  });

  it("normalizes legacy settings keys out of storage", async () => {
    const legacyTrendKey = ["trend", "Enabled"].join("");
    const legacyRetentionKey = ["purge", "After", "Days"].join("");
    const legacyIntervalKey = ["fetch", "Interval", "Minutes"].join("");
    const legacyRankKey = ["rank", "By", "Players"].join("");
    await chrome.storage.local.set({
      sw_settings: {
        notificationsEnabled: false,
        [legacyTrendKey]: false,
        [legacyRetentionKey]: 7,
        [legacyIntervalKey]: 30,
        [legacyRankKey]: false,
      },
    });

    const s = await getSettings();
    expect(s.notificationsEnabled).toBe(false);

    const stored = await chrome.storage.local.get("sw_settings");
    expect(stored["sw_settings"]).not.toHaveProperty(legacyTrendKey);
    expect(stored["sw_settings"]).not.toHaveProperty(legacyRetentionKey);
    expect(stored["sw_settings"]).not.toHaveProperty(legacyIntervalKey);
    expect(stored["sw_settings"]).not.toHaveProperty(legacyRankKey);
  });

  it("clamps global notification thresholds", async () => {
    await saveSettings({ globalThresholdUp: 500, globalThresholdDown: -500 });
    const s = await getSettings();
    expect(s.globalThresholdUp).toBe(100);
    expect(s.globalThresholdDown).toBe(-90);
  });
});

// ── Per-game settings ─────────────────────────────────────────────────────────

describe("getGameSettings / saveGameSettings", () => {
  it("returns empty object when no settings stored", async () => {
    expect(await getGameSettings("999")).toEqual({});
  });

  it("saves and retrieves per-game settings", async () => {
    await saveGameSettings("1", { thresholdUp: 25, notificationsEnabled: false });
    const gs = await getGameSettings("1");
    expect(gs.thresholdUp).toBe(25);
    expect(gs.notificationsEnabled).toBe(false);
  });

  it("merges partial updates without overwriting existing fields", async () => {
    await saveGameSettings("1", { thresholdUp: 25 });
    await saveGameSettings("1", { thresholdDown: -15 });
    const gs = await getGameSettings("1");
    expect(gs.thresholdUp).toBe(25);
    expect(gs.thresholdDown).toBe(-15);
  });
});

// ── Cache ─────────────────────────────────────────────────────────────────────

describe("getCache / setCache", () => {
  it("returns empty object initially", async () => {
    expect(await getCache()).toEqual({});
  });

  it("stores and retrieves cached data", async () => {
    const data = { current: 1234, fetchedAt: Date.now() };
    await setCache({ "1": data });
    const cache = await getCache();
    expect(cache["1"]).toEqual(data);
  });

  it("writes a full cache map atomically", async () => {
    await setCache({
      "1": { current: 100, fetchedAt: 1 },
      "2": { current: 200, fetchedAt: 2 },
    });
    const cache = await getCache();
    expect(cache["1"]!.current).toBe(100);
    expect(cache["2"]!.current).toBe(200);
  });
});

// ── clearAllData ──────────────────────────────────────────────────────────────

describe("clearAllData", () => {
  it("removes all stored data", async () => {
    await addGame(mockGame(1));
    await idbSaveSnapshot("1", mockSnap(1000));
    await saveSettings({ notificationsEnabled: false });
    await clearAllData();
    expect(await getGames()).toEqual([]);
    expect(await idbGetSnapshots("1")).toEqual([]);
    const s = await getSettings();
    expect(s.notificationsEnabled).toBe(DEFAULT_SETTINGS.notificationsEnabled);
  });
});

describe("fixed tracking defaults", () => {
  it("uses maximum quality tracking constants", () => {
    expect(FETCH_INTERVAL_MINUTES).toBe(5);
    expect(TRACKING_RETENTION_DAYS).toBe(60);
  });
});

// ── Settings defaults ─────────────────────────────────────────────────────────

describe("DEFAULT_SETTINGS", () => {
  it("badgeFavoriteAppid defaults to undefined", async () => {
    const s = await getSettings();
    expect(s.badgeFavoriteAppid).toBeUndefined();
  });

  it("badgeFavoriteAppid can be saved and retrieved", async () => {
    await saveSettings({ badgeFavoriteAppid: "570" });
    const s = await getSettings();
    expect(s.badgeFavoriteAppid).toBe("570");
  });

  it("badgeFavoriteAppid can be cleared", async () => {
    await saveSettings({ badgeFavoriteAppid: "570" });
    await saveSettings({ badgeFavoriteAppid: undefined });
    const s = await getSettings();
    expect(s.badgeFavoriteAppid).toBeUndefined();
  });
});
