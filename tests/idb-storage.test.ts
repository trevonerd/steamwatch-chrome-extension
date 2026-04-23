import { beforeEach, describe, expect, it } from "vitest";

import type { PriceRecord, Snapshot } from "../src/types/index.js";
import {
  _resetDbForTesting,
  idbBulkSaveSnapshots,
  idbDeleteSnapshots,
  idbGetCooldown,
  idbGetItadMapping,
  idbGetPriceHistory,
  idbGetSnapshots,
  idbGetSnapshotsInRange,
  idbPurgeCooldowns,
  idbSaveItadMapping,
  idbSavePriceHistory,
  idbSaveSnapshot,
  idbSetCooldown,
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

  describe("cooldowns", () => {
    it("sets and retrieves a cooldown", async () => {
      const key = "730__spike";
      const expiresAt = Date.now() + 60000;

      await idbSetCooldown(key, expiresAt);
      const result = await idbGetCooldown(key);

      expect(result).toBe(expiresAt);
    });

    it("returns null for missing cooldown", async () => {
      const result = await idbGetCooldown("nonexistent__key");
      expect(result).toBeNull();
    });

    it("returns null for expired cooldown", async () => {
      const key = "730__spike";
      const expiresAt = Date.now() - 1000; // expired 1s ago

      await idbSetCooldown(key, expiresAt);
      const result = await idbGetCooldown(key);

      expect(result).toBeNull();
    });

    it("returns expiresAt for non-expired cooldown", async () => {
      const key = "730__spike";
      const expiresAt = Date.now() + 60000;

      await idbSetCooldown(key, expiresAt);
      const result = await idbGetCooldown(key);

      expect(result).toBe(expiresAt);
    });

    it("updates existing cooldown", async () => {
      const key = "730__spike";
      const firstExpiry = Date.now() + 30000;
      const secondExpiry = Date.now() + 90000;

      await idbSetCooldown(key, firstExpiry);
      await idbSetCooldown(key, secondExpiry);

      const result = await idbGetCooldown(key);
      expect(result).toBe(secondExpiry);
    });

    it("purges all expired cooldowns", async () => {
      const now = Date.now();
      const expiredKey = "730__spike";
      const validKey = "570__trend";

      await idbSetCooldown(expiredKey, now - 1000); // expired
      await idbSetCooldown(validKey, now + 60000); // valid

      await idbPurgeCooldowns();

      const expiredResult = await idbGetCooldown(expiredKey);
      const validResult = await idbGetCooldown(validKey);

      expect(expiredResult).toBeNull();
      expect(validResult).toBe(now + 60000);
    });

    it("purges cooldowns with expiresAt exactly at current time", async () => {
      const now = Date.now();
      const key = "730__spike";

      await idbSetCooldown(key, now);
      await idbPurgeCooldowns();

      const result = await idbGetCooldown(key);
      expect(result).toBeNull();
    });

     it("keeps non-expired cooldowns after purge", async () => {
       const now = Date.now();
       const key1 = "730__spike";
       const key2 = "570__trend";
       const key3 = "440__price";

       await idbSetCooldown(key1, now + 10000);
       await idbSetCooldown(key2, now + 20000);
       await idbSetCooldown(key3, now + 30000);

       await idbPurgeCooldowns();

       expect(await idbGetCooldown(key1)).toBe(now + 10000);
       expect(await idbGetCooldown(key2)).toBe(now + 20000);
       expect(await idbGetCooldown(key3)).toBe(now + 30000);
     });
   });

   describe("idbBulkSaveSnapshots", () => {
     it("bulk saves multiple snapshots and retrieves them sorted by ts", async () => {
       const appId = "100";
       const snapshots: Snapshot[] = [
         { ts: 3000, current: 30 },
         { ts: 1000, current: 10 },
         { ts: 2000, current: 20 },
       ];

       await idbBulkSaveSnapshots(appId, snapshots);

       const retrieved = await idbGetSnapshots(appId);
       expect(retrieved).toEqual([
         { ts: 1000, current: 10 },
         { ts: 2000, current: 20 },
         { ts: 3000, current: 30 },
       ]);
     });

     it("empty array is a no-op", async () => {
       const appId = "100";

       await idbBulkSaveSnapshots(appId, []);

       const retrieved = await idbGetSnapshots(appId);
       expect(retrieved).toEqual([]);
     });

     it("bulk save doesn't affect other appId's data", async () => {
       const appId1 = "100";
       const appId2 = "200";
       const snapshots1: Snapshot[] = [
         { ts: 1000, current: 10 },
         { ts: 2000, current: 20 },
       ];
       const snapshots2: Snapshot[] = [
         { ts: 1000, current: 100 },
         { ts: 2000, current: 200 },
       ];

       await idbBulkSaveSnapshots(appId1, snapshots1);
       await idbBulkSaveSnapshots(appId2, snapshots2);

       const retrieved1 = await idbGetSnapshots(appId1);
       const retrieved2 = await idbGetSnapshots(appId2);

       expect(retrieved1).toEqual(snapshots1);
       expect(retrieved2).toEqual(snapshots2);
     });

     it("bulk saves 150 snapshots and retrieves all", async () => {
       const appId = "100";
       const snapshots: Snapshot[] = Array.from({ length: 150 }, (_, i) => ({
         ts: (i + 1) * 1000,
         current: i + 1,
       }));

       await idbBulkSaveSnapshots(appId, snapshots);

       const retrieved = await idbGetSnapshots(appId);
       expect(retrieved).toHaveLength(150);
       expect(retrieved[0]).toEqual({ ts: 1000, current: 1 });
       expect(retrieved[149]).toEqual({ ts: 150000, current: 150 });
     });
   });
 });
