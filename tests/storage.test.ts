// tests/storage.test.ts
import { describe, it, expect } from "vitest";
import {
  getGames,
  addGame,
  removeGame,
  getSnapshotsForGame,
  addSnapshot,
  purgeSnapshotsForGame,
  getSettings,
  saveSettings,
  getGameSettings,
  saveGameSettings,
  getCache,
  setCache,
  clearAllData,
  MAX_GAMES,
  DEFAULT_SETTINGS,
  getSnapshotCapacity,
} from "../src/utils/storage.js";
import type { Game, Snapshot } from "../src/types/index.js";

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
    await addSnapshot("1", mockSnap(1000));
    await removeGame("1");
    expect(await getSnapshotsForGame("1")).toEqual([]);
  });

  it("also removes associated game settings", async () => {
    await addGame(mockGame(1));
    await saveGameSettings("1", { thresholdUp: 50 });
    await removeGame("1");
    const gs = await getGameSettings("1");
    expect(gs.thresholdUp).toBeUndefined();
  });

  it("also removes entry from cache", async () => {
    await setCache({ "1": { current: 1000, peak: 5000, fetchedAt: Date.now() } });
    await removeGame("1");
    const cache = await getCache();
    expect(cache["1"]).toBeUndefined();
  });
});

// ── Snapshots ─────────────────────────────────────────────────────────────────

describe("addSnapshot / getSnapshotsForGame", () => {
  it("returns empty array when no snapshots stored", async () => {
    expect(await getSnapshotsForGame("999")).toEqual([]);
  });

  it("adds and retrieves snapshots", async () => {
    const snap = mockSnap(5000);
    await addSnapshot("1", snap);
    const snaps = await getSnapshotsForGame("1");
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.current).toBe(5000);
  });

  it("returns the updated snapshot array", async () => {
    const snaps = await addSnapshot("1", mockSnap(1000));
    await addSnapshot("1", mockSnap(2000));
    expect(snaps).toHaveLength(1); // Only the first add's result
    expect(await getSnapshotsForGame("1")).toHaveLength(2);
  });

  it("keeps snapshots for different games separate", async () => {
    await addSnapshot("1", mockSnap(1000));
    await addSnapshot("2", mockSnap(2000));
    expect((await getSnapshotsForGame("1"))[0]!.current).toBe(1000);
    expect((await getSnapshotsForGame("2"))[0]!.current).toBe(2000);
  });
});

describe("purgeSnapshotsForGame", () => {
  it("removes snapshots older than given days", async () => {
    const OLD = 3 * 86_400_000; // 3 days ago
    await addSnapshot("1", mockSnap(1000, OLD + 1000)); // older than 2 days
    await addSnapshot("1", mockSnap(2000));              // recent

    await purgeSnapshotsForGame("1", 2);

    const snaps = await getSnapshotsForGame("1");
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.current).toBe(2000);
  });

  it("keeps all snapshots when all are within retention window", async () => {
    await addSnapshot("1", mockSnap(1000));
    await addSnapshot("1", mockSnap(2000));
    await purgeSnapshotsForGame("1", 7);
    expect(await getSnapshotsForGame("1")).toHaveLength(2);
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
    await saveSettings({ trendEnabled: false });
    const s = await getSettings();
    expect(s.trendEnabled).toBe(false);
    expect(s.notificationsEnabled).toBe(DEFAULT_SETTINGS.notificationsEnabled);
  });

  it("merges multiple partial saves correctly", async () => {
    await saveSettings({ trendEnabled: false });
    await saveSettings({ purgeAfterDays: 14 });
    const s = await getSettings();
    expect(s.trendEnabled).toBe(false);
    expect(s.purgeAfterDays).toBe(14);
  });

  it("clamps retention to the minimum supported window", async () => {
    await saveSettings({ purgeAfterDays: 1 });
    const s = await getSettings();
    expect(s.purgeAfterDays).toBe(3);
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
    const data = { current: 1234, peak: 5000, fetchedAt: Date.now() };
    await setCache({ "1": data });
    const cache = await getCache();
    expect(cache["1"]).toEqual(data);
  });

  it("writes a full cache map atomically", async () => {
    await setCache({
      "1": { current: 100, peak: 500, fetchedAt: 1 },
      "2": { current: 200, peak: 600, fetchedAt: 2 },
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
    await addSnapshot("1", mockSnap(1000));
    await saveSettings({ trendEnabled: false });
    await clearAllData();
    expect(await getGames()).toEqual([]);
    expect(await getSnapshotsForGame("1")).toEqual([]);
    const s = await getSettings();
    expect(s.trendEnabled).toBe(DEFAULT_SETTINGS.trendEnabled);
  });
});

describe("getSnapshotCapacity", () => {
  it("preserves roughly 7 days at 15-minute intervals", () => {
    expect(getSnapshotCapacity(7, 15)).toBeGreaterThanOrEqual(672);
  });

  it("scales with longer retention windows", () => {
    expect(getSnapshotCapacity(14, 15)).toBeGreaterThan(getSnapshotCapacity(7, 15));
  });

  it("enforces the 3-day minimum", () => {
    expect(getSnapshotCapacity(1, 15)).toBe(getSnapshotCapacity(3, 15));
  });
});

// ── new Settings defaults ─────────────────────────────────────────────────────

describe("DEFAULT_SETTINGS includes new v0.12 fields", () => {
  it("priceAlertsEnabled defaults to true", async () => {
    const s = await getSettings();
    expect(s.priceAlertsEnabled).toBe(true);
  });

  it("priceDropMinPct defaults to 30", async () => {
    const s = await getSettings();
    expect(s.priceDropMinPct).toBe(30);
  });

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
