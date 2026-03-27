import { beforeEach, describe, expect, it } from "vitest";

import type { PriceRecord, Snapshot } from "../src/types/index.js";
import {
  _resetDbForTesting,
  idbDeleteSnapshots,
  idbGetItadMapping,
  idbGetPriceHistory,
  idbGetSnapshots,
  idbGetSnapshotsInRange,
  idbSaveItadMapping,
  idbSavePriceHistory,
  idbSaveSnapshot,
} from "../src/utils/idb-storage.js";

describe("idb-storage", () => {
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

  it("saves and retrieves snapshots sorted by ts asc", async () => {
    const appId = "100";
    const first: Snapshot = { ts: 2000, current: 11 };
    const second: Snapshot = { ts: 1000, current: 10 };

    await idbSaveSnapshot(appId, first);
    await idbSaveSnapshot(appId, second);

    const snapshots = await idbGetSnapshots(appId);
    expect(snapshots).toEqual([
      { ts: 1000, current: 10 },
      { ts: 2000, current: 11 },
    ]);
  });

  it("returns snapshots in requested ts range", async () => {
    const appId = "100";

    for (let i = 1; i <= 10; i++) {
      await idbSaveSnapshot(appId, { ts: i * 1000, current: i });
    }

    const inRange = await idbGetSnapshotsInRange(appId, 3000, 7000);
    expect(inRange.map((s) => s.ts)).toEqual([3000, 4000, 5000, 6000, 7000]);
  });

  it("keeps snapshots isolated per appId", async () => {
    await idbSaveSnapshot("100", { ts: 1000, current: 10 });
    await idbSaveSnapshot("200", { ts: 1000, current: 20 });

    expect(await idbGetSnapshots("100")).toEqual([{ ts: 1000, current: 10 }]);
    expect(await idbGetSnapshots("200")).toEqual([{ ts: 1000, current: 20 }]);
  });

  it("round-trips ITAD mapping", async () => {
    await idbSaveItadMapping("100", "itad-uuid-100");
    await expect(idbGetItadMapping("100")).resolves.toBe("itad-uuid-100");
  });

  it("returns null for unknown ITAD mapping", async () => {
    await expect(idbGetItadMapping("999")).resolves.toBeNull();
  });

  it("round-trips price history sorted by timestamp asc", async () => {
    const appId = "100";
    const records: PriceRecord[] = [
      {
        appId,
        timestamp: 2000,
        priceAmountInt: 1499,
        regularAmountInt: 1999,
        cut: 25,
        shop: "steam",
      },
      {
        appId,
        timestamp: 1000,
        priceAmountInt: 1999,
        regularAmountInt: 1999,
        cut: 0,
        shop: "steam",
      },
    ];

    await idbSavePriceHistory(appId, records);

    await expect(idbGetPriceHistory(appId)).resolves.toEqual([
      {
        appId,
        timestamp: 1000,
        priceAmountInt: 1999,
        regularAmountInt: 1999,
        cut: 0,
        shop: "steam",
      },
      {
        appId,
        timestamp: 2000,
        priceAmountInt: 1499,
        regularAmountInt: 1999,
        cut: 25,
        shop: "steam",
      },
    ]);
  });

  it("deletes all snapshots for an appId", async () => {
    await idbSaveSnapshot("100", { ts: 1000, current: 10 });
    await idbSaveSnapshot("100", { ts: 2000, current: 20 });
    await idbSaveSnapshot("200", { ts: 1000, current: 30 });

    await idbDeleteSnapshots("100");

    await expect(idbGetSnapshots("100")).resolves.toEqual([]);
    await expect(idbGetSnapshots("200")).resolves.toEqual([{ ts: 1000, current: 30 }]);
  });
});
