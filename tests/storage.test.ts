// tests/storage.test.ts
import { beforeEach, describe, it, expect, vi, type MockInstance } from "vitest";
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
  getLastFetchAttemptTime,
  setLastFetchAttemptTime,
  getLastFetchTime,
  setLastFetchTime,
  setCache,
  clearAllData,
  MAX_GAMES,
  DEFAULT_SETTINGS,
  FETCH_INTERVAL_MINUTES,
  TRACKING_RETENTION_DAYS,
} from "../src/utils/storage.js";
import {
  AppDetailsSchema,
  MessageResponseSchema,
  type Game,
  type Snapshot,
} from "../src/types/index.js";
import {
  _resetDbForTesting,
  idbGetSnapshots,
  idbSaveSnapshot,
} from "../src/utils/idb-storage.js";

describe("refresh freshness persistence", () => {
  it("keeps failed-attempt time separate from the last successful update", async () => {
    await setLastFetchTime(100);
    await setLastFetchAttemptTime(200);
    expect(await getLastFetchTime()).toBe(100);
    expect(await getLastFetchAttemptTime()).toBe(200);
  });

  it("preserves valid counts when their freshness metadata is malformed", async () => {
    await chrome.storage.local.set({ sw_cache: {
      "570": { current: 123, fetchedAt: 100, freshness: { current: { status: "invented" } } },
    } });
    expect((await getCache())["570"]).toMatchObject({ current: 123, fetchedAt: 100, freshness: {} });
  });

  it("preserves the acquisition time of failed cached fields", async () => {
    const freshness = { current: { status: "error" as const, source: "steam" as const, acquiredAt: 100, attemptedAt: 200 } };
    await setCache({ "570": { current: 123, fetchedAt: 100, freshness } });
    expect((await getCache())["570"]?.freshness).toEqual(freshness);
  });

  it("handles missing and malformed last-attempt values", async () => {
    expect(await getLastFetchAttemptTime()).toBe(0);
    await chrome.storage.local.set({ sw_last_fetch_attempt: "invalid" });
    expect(await getLastFetchAttemptTime()).toBe(0);
  });
});

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

  it("recovers valid games when persisted siblings are malformed", async () => {
    // Given
    const valid = mockGame(1);
    await chrome.storage.local.set({
      sw_games: [valid, { appid: 2, name: "Invalid appid" }, null],
    });

    // When
    const games = await getGames();

    // Then
    expect(games).toEqual([valid]);
    expect((await chrome.storage.local.get("sw_games"))["sw_games"]).toEqual([valid]);
  });

  it.each([null, "not an array", { appid: "1" }])("recovers from an invalid top-level games container: %p", async (raw) => {
    // Given
    await chrome.storage.local.set({ sw_games: raw });

    // When
    const games = await getGames();

    // Then
    expect(games).toEqual([]);
    expect((await chrome.storage.local.get("sw_games"))["sw_games"]).toEqual([]);
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

  it("removes legacy data and clears a removed game's favorite", async () => {
    await addGame(mockGame(1));
    await chrome.storage.local.set({
      sw_snaps_1: [{ ts: 1, current: 100 }],
      sw_settings: { ...DEFAULT_SETTINGS, badgeFavoriteAppid: "1" },
    });

    await removeGame("1");

    const stored = await chrome.storage.local.get(["sw_snaps_1", "sw_settings"]);
    expect(stored.sw_snaps_1).toBeUndefined();
    expect((stored.sw_settings as Record<string, unknown>)["badgeFavoriteAppid"]).toBeUndefined();
  });

  it("keeps cleanup durable after a failed deletion and reconciles it on the next read", async () => {
    await addGame(mockGame(1));
    await idbSaveSnapshot("1", mockSnap(100));
    const deleteSpy = vi.spyOn(await import("../src/utils/idb-storage.js"), "idbDeleteGameData")
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expect(removeGame("1")).rejects.toThrow("database unavailable");
    expect((await chrome.storage.local.get("sw_pending_game_cleanups")).sw_pending_game_cleanups).toEqual(["1"]);

    deleteSpy.mockRestore();
    await expect(getGames()).resolves.toEqual([]);
    expect((await chrome.storage.local.get("sw_pending_game_cleanups")).sw_pending_game_cleanups).toBeUndefined();
    await expect(idbGetSnapshots("1")).resolves.toEqual([]);
  });

  it("removes a zombie game during reconciliation when the initial games write failed", async () => {
    await addGame(mockGame(1));
    const storageSet = chrome.storage.local.set as unknown as MockInstance<
      [items: Record<string, unknown>],
      Promise<void>
    >;
    const originalSet = storageSet.getMockImplementation();
    if (!originalSet) throw new Error("storage mock must expose its implementation");
    storageSet.mockImplementation(async (items) => {
      if ("sw_games" in items) throw new Error("storage unavailable");
      await originalSet(items);
    });

    await expect(removeGame("1")).rejects.toThrow("storage unavailable");
    expect((await chrome.storage.local.get("sw_pending_game_cleanups")).sw_pending_game_cleanups).toEqual(["1"]);

    storageSet.mockRestore();
    await expect(getGames()).resolves.toEqual([]);
    expect((await chrome.storage.local.get("sw_pending_game_cleanups")).sw_pending_game_cleanups).toBeUndefined();
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

  it("keeps valid settings while restoring malformed quiet-hour values", async () => {
    // Given
    await chrome.storage.local.set({
      sw_settings: {
        notificationsEnabled: false,
        globalThresholdUp: 40,
        quietHoursEnabled: true,
        quietStart: "7:30",
        quietEnd: "24:00",
        quietDays: 0b0001010,
      },
    });

    // When
    const settings = await getSettings();

    // Then
    expect(settings.notificationsEnabled).toBe(false);
    expect(settings.globalThresholdUp).toBe(40);
    expect(settings.quietHoursEnabled).toBe(true);
    expect(settings.quietStart).toBe(DEFAULT_SETTINGS.quietStart);
    expect(settings.quietEnd).toBe(DEFAULT_SETTINGS.quietEnd);
    expect(settings.quietDays).toBe(0b0001010);
  });

  it("retains strictly valid 24-hour quiet-hour values", async () => {
    // Given
    await chrome.storage.local.set({
      sw_settings: { quietStart: "00:00", quietEnd: "23:59" },
    });

    // When
    const settings = await getSettings();

    // Then
    expect(settings.quietStart).toBe("00:00");
    expect(settings.quietEnd).toBe("23:59");
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

  it("recovers valid per-game settings while dropping malformed fields", async () => {
    // Given
    await chrome.storage.local.set({
      sw_gs_1: {
        thresholdUp: 25,
        thresholdDown: 15,
        notifyThresholdPlayers: 1000,
        notificationsEnabled: false,
      },
    });

    // When
    const settings = await getGameSettings("1");

    // Then
    expect(settings).toEqual({
      thresholdUp: 25,
      notifyThresholdPlayers: 1000,
      notificationsEnabled: false,
    });
  });

  it("does not persist non-finite or wrong-sign per-game thresholds", async () => {
    // Given
    await chrome.storage.local.set({
      sw_gs_1: {
        thresholdUp: Number.POSITIVE_INFINITY,
        thresholdDown: 10,
        notifyThresholdPlayers: -1,
      },
    });

    // When
    const settings = await getGameSettings("1");

    // Then
    expect(settings).toEqual({});
  });

  it.each([null, "not an object", []])("recovers from an invalid top-level per-game settings container: %p", async (raw) => {
    // Given
    await chrome.storage.local.set({ sw_gs_1: raw });

    // When
    const settings = await getGameSettings("1");

    // Then
    expect(settings).toEqual({});
    expect((await chrome.storage.local.get("sw_gs_1"))["sw_gs_1"]).toEqual({});
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

  it("recovers valid cache entries when persisted siblings are malformed", async () => {
    // Given
    const valid = { current: 100, fetchedAt: 1, peak: 200 };
    await chrome.storage.local.set({
      sw_cache: {
        "1": valid,
        "2": { current: "100", fetchedAt: 2 },
      },
    });

    // When
    const cache = await getCache();

    // Then
    expect(cache["1"]).toMatchObject(valid);
    expect(cache["2"]).toBeUndefined();
    expect((await chrome.storage.local.get("sw_cache"))["sw_cache"]).toEqual({ "1": valid });
  });

  it("drops a cache entry whose legacy peak is malformed", async () => {
    // Given
    await chrome.storage.local.set({
      sw_cache: { "1": { current: 100, fetchedAt: 1, peak: "not a number" } },
    });

    // When
    const cache = await getCache();

    // Then
    expect(cache["1"]).toBeUndefined();
    expect((await chrome.storage.local.get("sw_cache"))["sw_cache"]).toEqual({});
  });

  it.each([null, "not an object", []])("recovers from an invalid top-level cache container: %p", async (raw) => {
    // Given
    await chrome.storage.local.set({ sw_cache: raw });

    // When
    const cache = await getCache();

    // Then
    expect(cache).toEqual({});
    expect((await chrome.storage.local.get("sw_cache"))["sw_cache"]).toEqual({});
  });

  it("does not rewrite already normalized storage values", async () => {
    // Given
    const game = mockGame(1);
    await chrome.storage.local.set({
      sw_games: [game],
      sw_settings: DEFAULT_SETTINGS,
      sw_gs_1: { thresholdUp: 25 },
      sw_cache: { "1": { current: 100, fetchedAt: 1, peak: 200 } },
    });
    vi.clearAllMocks();

    // When
    await Promise.all([getGames(), getSettings(), getGameSettings("1"), getCache()]);
    await Promise.all([getGames(), getSettings(), getGameSettings("1"), getCache()]);

    // Then
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("shared response schemas", () => {
  it("accepts the Steam app-details and runtime response contracts", () => {
    // Given
    const appDetails = {
      "570": { success: true, data: { name: "Dota 2", capsule_image: "https://example.com/dota.jpg" } },
    };

    // When
    const parsedAppDetails = AppDetailsSchema.safeParse(appDetails);
    const parsedResponse = MessageResponseSchema.safeParse({ ok: false, error: "Fetch failed" });

    // Then
    expect(parsedAppDetails.success).toBe(true);
    expect(parsedResponse.success).toBe(true);
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
