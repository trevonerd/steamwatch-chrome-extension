import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Game, Snapshot } from "../src/types/index.js";
import {
  _resetDbForTesting,
  idbGetSnapshots,
} from "../src/utils/idb-storage.js";
import { migrateToIndexedDB, migrateImageUrls } from "../src/utils/migrate.js";

const mockFetchAppDetails = vi.fn();
const mockUpdateGameImage = vi.fn();

vi.mock("../src/utils/api.js", () => ({
  fetchAppDetails: (...args: unknown[]) => mockFetchAppDetails(...args),
}));

vi.mock("../src/utils/storage.js", () => ({
  getGames: async () => {
    const result = await chrome.storage.local.get("sw_games");
    return (result.sw_games as Game[]) ?? [];
  },
  updateGameImage: (...args: unknown[]) => mockUpdateGameImage(...args),
}));

describe("migrateToIndexedDB", () => {
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

  it("returns early if migration already complete", async () => {
    await chrome.storage.local.set({ sw_migration_complete: true });

    const result = await migrateToIndexedDB();

    expect(result).toEqual({ migrated: 0, skipped: 0, errors: 0 });
    await expect(idbGetSnapshots("100")).resolves.toEqual([]);
  });

  it("migrates all snapshots from chrome.storage to IndexedDB", async () => {
    const games: Game[] = [
      { appid: "100", name: "Game A", image: "a.jpg" },
      { appid: "200", name: "Game B", image: "b.jpg" },
    ];
    const snaps100: Snapshot[] = [
      { ts: 1_000, current: 10 },
      { ts: 2_000, current: 20 },
    ];
    const snaps200: Snapshot[] = [{ ts: 3_000, current: 30 }];

    await chrome.storage.local.set({
      sw_games: games,
      sw_snaps_100: snaps100,
      sw_snaps_200: snaps200,
    });

    await migrateToIndexedDB();

    await expect(idbGetSnapshots("100")).resolves.toEqual(snaps100);
    await expect(idbGetSnapshots("200")).resolves.toEqual(snaps200);
  });

  it("sets sw_migration_complete sentinel after migration", async () => {
    const games: Game[] = [{ appid: "100", name: "Game A", image: "a.jpg" }];
    await chrome.storage.local.set({
      sw_games: games,
      sw_snaps_100: [{ ts: 1_000, current: 10 } satisfies Snapshot],
    });

    await migrateToIndexedDB();

    const result = await chrome.storage.local.get("sw_migration_complete");
    expect(result.sw_migration_complete).toBe(true);
  });

  it("is idempotent — second call returns zeros without duplicates", async () => {
    const games: Game[] = [{ appid: "100", name: "Game A", image: "a.jpg" }];
    const snaps: Snapshot[] = [
      { ts: 1_000, current: 10 },
      { ts: 2_000, current: 20 },
    ];
    await chrome.storage.local.set({ sw_games: games, sw_snaps_100: snaps });

    const first = await migrateToIndexedDB();
    const second = await migrateToIndexedDB();

    expect(first).toEqual({ migrated: 2, skipped: 0, errors: 0 });
    expect(second).toEqual({ migrated: 0, skipped: 0, errors: 0 });
    await expect(idbGetSnapshots("100")).resolves.toEqual(snaps);
  });

  it("handles empty sw_games gracefully", async () => {
    await chrome.storage.local.set({ sw_games: [] });

    const result = await migrateToIndexedDB();

    expect(result).toEqual({ migrated: 0, skipped: 0, errors: 0 });
  });

  it("handles missing sw_games gracefully", async () => {
    const result = await migrateToIndexedDB();

    expect(result).toEqual({ migrated: 0, skipped: 0, errors: 0 });
  });

  it("skips invalid snapshots and counts them as errors", async () => {
    const games: Game[] = [{ appid: "100", name: "Game A", image: "a.jpg" }];
    await chrome.storage.local.set({
      sw_games: games,
      sw_snaps_100: [
        { ts: 1_000, current: 10 },
        { ts: "bad", current: 20 },
        { ts: 2_000 },
        { current: 30 },
      ],
    });

    const result = await migrateToIndexedDB();

    expect(result).toEqual({ migrated: 1, skipped: 0, errors: 3 });
    await expect(idbGetSnapshots("100")).resolves.toEqual([{ ts: 1_000, current: 10 }]);
  });

  it("preserves original chrome.storage.local data after migration", async () => {
    const games: Game[] = [{ appid: "100", name: "Game A", image: "a.jpg" }];
    const snaps: Snapshot[] = [{ ts: 1_000, current: 10 }];
    await chrome.storage.local.set({ sw_games: games, sw_snaps_100: snaps });

    await migrateToIndexedDB();

    const storedGames = await chrome.storage.local.get("sw_games");
    const storedSnaps = await chrome.storage.local.get("sw_snaps_100");
    expect(storedGames.sw_games).toEqual(games);
    expect(storedSnaps.sw_snaps_100).toEqual(snaps);
  });

  it("returns correct migrated/skipped/errors stats", async () => {
    const games: Game[] = [
      { appid: "100", name: "Game A", image: "a.jpg" },
      { appid: "200", name: "Game B", image: "b.jpg" },
      { appid: "300", name: "Game C", image: "c.jpg" },
    ];
    await chrome.storage.local.set({
      sw_games: games,
      sw_snaps_100: [
        { ts: 1_000, current: 10 },
        { ts: 2_000, current: 20 },
      ],
      sw_snaps_200: null,
      sw_snaps_300: [{ ts: 3_000, current: "bad" }],
    });

    const result = await migrateToIndexedDB();

    expect(result).toEqual({ migrated: 2, skipped: 1, errors: 1 });
  });
});

describe("migrateImageUrls", () => {
  beforeEach(async () => {
    mockFetchAppDetails.mockReset();
    mockUpdateGameImage.mockReset();
    await chrome.storage.local.clear();
  });

  it("returns early if sentinel already set", async () => {
    await chrome.storage.local.set({ sw_image_fixup_complete: true });

    await migrateImageUrls();

    expect(mockFetchAppDetails).not.toHaveBeenCalled();
  });

  it("skips games whose image URL already has a 40-char hex hash", async () => {
    const games: Game[] = [
      {
        appid: "440",
        name: "TF2",
        image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/440/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2/capsule_231x87.jpg",
      },
    ];
    await chrome.storage.local.set({ sw_games: games });

    await migrateImageUrls();

    expect(mockFetchAppDetails).not.toHaveBeenCalled();
  });

  it("updates stale legacy CDN image", async () => {
    const games: Game[] = [
      { appid: "730", name: "CS2", image: "https://cdn.akamai.steamstatic.com/steam/apps/730/capsule_sm_120.jpg" },
    ];
    await chrome.storage.local.set({ sw_games: games });
    mockFetchAppDetails.mockResolvedValue({ name: "CS2", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/abc123def456abc123def456abc123def456abc1/capsule_231x87.jpg" });

    await migrateImageUrls();

    expect(mockFetchAppDetails).toHaveBeenCalledWith("730");
    expect(mockUpdateGameImage).toHaveBeenCalledWith("730", expect.stringContaining("/abc123def456abc123def456abc123def456abc1/"));
  });

  it("updates hashless header.jpg URL", async () => {
    const games: Game[] = [
      { appid: "3065800", name: "Marathon", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3065800/header.jpg" },
    ];
    await chrome.storage.local.set({ sw_games: games });
    mockFetchAppDetails.mockResolvedValue({ name: "Marathon", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3065800/9d48fde3699ddad29c58612dc53eb7e85731cff9/capsule_231x87.jpg" });

    await migrateImageUrls();

    expect(mockUpdateGameImage).toHaveBeenCalledWith("3065800", expect.stringContaining("/9d48fde3699ddad29c58612dc53eb7e85731cff9/"));
  });

  it("does not update if fetchAppDetails returns null", async () => {
    const games: Game[] = [
      { appid: "999", name: "Unknown", image: "https://cdn.akamai.steamstatic.com/steam/apps/999/capsule_sm_120.jpg" },
    ];
    await chrome.storage.local.set({ sw_games: games });
    mockFetchAppDetails.mockResolvedValue(null);

    await migrateImageUrls();

    expect(mockUpdateGameImage).not.toHaveBeenCalled();
  });

  it("sets sentinel after completion", async () => {
    await chrome.storage.local.set({ sw_games: [] });

    await migrateImageUrls();

    const result = await chrome.storage.local.get("sw_image_fixup_complete");
    expect(result.sw_image_fixup_complete).toBe(true);
  });
});
