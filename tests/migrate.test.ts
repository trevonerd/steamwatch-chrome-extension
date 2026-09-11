import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Game, Snapshot } from "../src/types/index.js";
import {
  _resetDbForTesting,
  idbGetSnapshots,
  idbSaveSnapshot,
} from "../src/utils/idb-storage.js";
import { migrateToIndexedDB } from "../src/utils/migrate.js";

function legacySnapshots(snapshots: readonly Snapshot[]): Snapshot[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    source: "legacy",
    granularity: "unknown",
  }));
}

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

    await expect(idbGetSnapshots("100")).resolves.toEqual(legacySnapshots(snaps100));
    await expect(idbGetSnapshots("200")).resolves.toEqual(legacySnapshots(snaps200));
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
    await expect(idbGetSnapshots("100")).resolves.toEqual(legacySnapshots(snaps));
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
    await expect(idbGetSnapshots("100")).resolves.toEqual(legacySnapshots([{ ts: 1_000, current: 10 }]));
    expect((await chrome.storage.local.get("sw_migration_complete")).sw_migration_complete).toBeUndefined();
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

  it("does not duplicate snapshots that are already present when a prior run was interrupted", async () => {
    const games: Game[] = [{ appid: "100", name: "Game A", image: "a.jpg" }];
    const snapshots: Snapshot[] = [
      { ts: 1_000, current: 10 },
      { ts: 2_000, current: 20 },
    ];
    await idbSaveSnapshot("100", snapshots[0]!);
    await chrome.storage.local.set({ sw_games: games, sw_snaps_100: snapshots });

    const result = await migrateToIndexedDB();

    expect(result).toEqual({ migrated: 1, skipped: 0, errors: 0 });
    await expect(idbGetSnapshots("100")).resolves.toEqual(legacySnapshots(snapshots));
  });

  it("rejects negative and future legacy snapshot values", async () => {
    const games: Game[] = [{ appid: "100", name: "Game A", image: "a.jpg" }];
    await chrome.storage.local.set({
      sw_games: games,
      sw_snaps_100: [
        { ts: 1_000, current: 10 },
        { ts: -1, current: 20 },
        { ts: 2_000, current: -1 },
        { ts: Date.now() + 60_000, current: 30 },
      ],
    });

    const result = await migrateToIndexedDB();

    expect(result).toEqual({ migrated: 1, skipped: 0, errors: 3 });
    await expect(idbGetSnapshots("100")).resolves.toEqual(legacySnapshots([{ ts: 1_000, current: 10 }]));
  });

  it("leaves migration incomplete when an IndexedDB write fails", async () => {
    const games: Game[] = [{ appid: "100", name: "Game A", image: "a.jpg" }];
    await chrome.storage.local.set({
      sw_games: games,
      sw_snaps_100: [{ ts: 1_000, current: 10 }],
    });
    const saveSpy = vi.spyOn(await import("../src/utils/idb-storage.js"), "idbSaveSnapshot")
      .mockRejectedValueOnce(new Error("write failed"));

    const result = await migrateToIndexedDB();

    expect(result).toEqual({ migrated: 0, skipped: 0, errors: 1 });
    expect((await chrome.storage.local.get("sw_migration_complete")).sw_migration_complete).toBeUndefined();
    saveSpy.mockRestore();
  });
});
