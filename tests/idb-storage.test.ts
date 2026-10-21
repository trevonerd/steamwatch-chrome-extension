import { beforeEach, describe, expect, it } from "vitest";

import type { Snapshot } from "../src/types/index.js";
import {
  _resetDbForTesting,
  idbAcquireBootstrapLease,
  idbBulkSaveSnapshots,
  idbClearAllData,
  idbClearGameTombstone,
  idbCompleteBootstrapImport,
  idbDeleteGameData,
  idbDeleteSnapshots,
  idbFailBootstrapLease,
  idbGetBootstrapStatus,
  idbGetSnapshots,
  idbGetSnapshotsInRange,
  idbSaveSnapshot,
  idbTransformSnapshotsAtomically,
} from "../src/utils/idb-storage.js";

function values(snapshots: readonly Snapshot[]): Array<{ ts: number; current: number }> {
  return snapshots.map(({ ts, current }) => ({ ts, current }));
}

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
    expect(values(snapshots)).toEqual([
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

  it("rejects an invalid or future sample at the persistence boundary", async () => {
    const future = Date.now() + 60_000;
    const invalid: Snapshot = { ts: 1_000, current: -1 };

    await idbBulkSaveSnapshots("100", [{ ts: future, current: 20 }, invalid, { ts: 1_000, current: 10 }]);

    await expect(idbGetSnapshots("100")).resolves.toEqual([
      { ts: 1_000, current: 10, source: "legacy", granularity: "unknown" },
    ]);
  });

  it("keeps snapshots isolated per appId", async () => {
    await idbSaveSnapshot("100", { ts: 1000, current: 10 });
    await idbSaveSnapshot("200", { ts: 1000, current: 20 });

    expect(values(await idbGetSnapshots("100"))).toEqual([{ ts: 1000, current: 10 }]);
    expect(values(await idbGetSnapshots("200"))).toEqual([{ ts: 1000, current: 20 }]);
  });

  it("deletes all snapshots for an appId", async () => {
    await idbSaveSnapshot("100", { ts: 1000, current: 10 });
    await idbSaveSnapshot("100", { ts: 2000, current: 20 });
    await idbSaveSnapshot("200", { ts: 1000, current: 30 });

    await idbDeleteSnapshots("100");

    await expect(idbGetSnapshots("100")).resolves.toEqual([]);
    expect(values(await idbGetSnapshots("200"))).toEqual([{ ts: 1000, current: 30 }]);
  });

  it("rolls back a failing atomic transformation", async () => {
    await idbSaveSnapshot("100", { ts: 1_000, current: 10 });

    await expect(
      idbTransformSnapshotsAtomically("100", () => {
        throw new Error("calculation failed");
      }),
    ).rejects.toThrow("calculation failed");

    await expect(idbGetSnapshots("100")).resolves.toEqual([
      { ts: 1_000, current: 10, source: "legacy", granularity: "unknown" },
    ]);
  });

  it("deduplicates separate writes at one timestamp and prefers an instant sample", async () => {
    await idbSaveSnapshot("100", {
      ts: 1_000,
      current: 10,
      source: "steamcharts",
      granularity: "hourly",
    });
    await idbSaveSnapshot("100", {
      ts: 1_000,
      current: 11,
      source: "steamcharts",
      granularity: "instant",
    });

    await expect(idbGetSnapshots("100")).resolves.toEqual([
      { ts: 1_000, current: 11, source: "steamcharts", granularity: "instant" },
    ]);
  });

  describe("idbClearAllData", () => {
    it("clears snapshots", async () => {
      await idbSaveSnapshot("100", { ts: 1000, current: 10 });

      await idbClearAllData();

      expect(await idbGetSnapshots("100")).toEqual([]);
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
      expect(values(retrieved)).toEqual([
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

      expect(values(retrieved1)).toEqual(snapshots1);
      expect(values(retrieved2)).toEqual(snapshots2);
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
      expect(values(retrieved)[0]).toEqual({ ts: 1000, current: 1 });
      expect(values(retrieved)[149]).toEqual({ ts: 150000, current: 150 });
    });

    describe("bootstrap import", () => {
      it("deduplicates import timestamps while preserving a live Steam sample", async () => {
        await idbSaveSnapshot("100", {
          ts: 1_000,
          current: 99,
          source: "steam",
          granularity: "instant",
        });
        const lease = await idbAcquireBootstrapLease("100", 10_000, 1_000);

        expect(lease).not.toBeNull();
        if (!lease) throw new Error("expected bootstrap lease");

        await expect(
          idbCompleteBootstrapImport(lease, [
            { ts: 1_000, current: 1, source: "steamcharts", granularity: "hourly" },
            { ts: 2_000, current: 2, source: "steamcharts", granularity: "hourly" },
            { ts: 2_000, current: 3, source: "steamcharts", granularity: "hourly" },
          ]),
        ).resolves.toBe(true);

        await expect(idbGetSnapshots("100")).resolves.toEqual([
          { ts: 1_000, current: 99, source: "steam", granularity: "instant" },
          { ts: 2_000, current: 2, source: "steamcharts", granularity: "hourly" },
        ]);
        await expect(idbGetBootstrapStatus("100")).resolves.toMatchObject({
          state: "completed",
          importedCount: 2,
          startTs: 1_000,
          endTs: 2_000,
        });
      });

      it("retains a monthly peak and weekly aggregate when live and imported rows share their timestamp", async () => {
        const timestamp = 1_000;
        await idbBulkSaveSnapshots("100", [
          { ts: timestamp, current: 999, source: "steamcharts", granularity: "monthly-peak" },
          {
            ts: timestamp,
            current: 50,
            source: "steamcharts",
            granularity: "weekly",
            aggregate: {
              startTs: timestamp,
              endTs: timestamp,
              sampleCount: 1,
              sum: 50,
              min: 50,
              max: 50,
              minTs: timestamp,
              maxTs: timestamp,
              observedDurationMs: 0,
            },
          },
        ]);
        await idbSaveSnapshot("100", {
          ts: timestamp,
          current: 55,
          source: "steam",
          granularity: "instant",
        });
        const lease = await idbAcquireBootstrapLease("100", 10_000, 1_000);
        expect(lease).not.toBeNull();
        if (!lease) throw new Error("expected bootstrap lease");

        await expect(
          idbCompleteBootstrapImport(lease, [
            { ts: timestamp, current: 20, source: "steamcharts", granularity: "hourly" },
          ]),
        ).resolves.toBe(true);

        await expect(idbGetSnapshots("100")).resolves.toEqual([
          { ts: timestamp, current: 999, source: "steamcharts", granularity: "monthly-peak" },
          expect.objectContaining({ ts: timestamp, current: 50, source: "steamcharts", granularity: "weekly" }),
          { ts: timestamp, current: 55, source: "steam", granularity: "instant" },
        ]);
      });

      it("releases a failed lease only after its retry time", async () => {
        const first = await idbAcquireBootstrapLease("100", 10_000, 1_000);
        expect(first).not.toBeNull();
        if (!first) throw new Error("expected bootstrap lease");

        await expect(idbFailBootstrapLease(first, 20_000)).resolves.toBe(true);
        await expect(idbAcquireBootstrapLease("100", 19_999, 1_000)).resolves.toBeNull();
        await expect(idbAcquireBootstrapLease("100", 20_000, 1_000)).resolves.toMatchObject({ attempt: 2 });
      });

      it("allows an explicit retry of failed history without bypassing active leases or completed imports", async () => {
        const first = await idbAcquireBootstrapLease("242050", 10_000, 1_000);
        if (!first) throw new Error("expected bootstrap lease");
        await expect(idbAcquireBootstrapLease("242050", 10_001, 1_000, true)).resolves.toBeNull();
        await idbFailBootstrapLease(first, 900_000);
        await expect(idbAcquireBootstrapLease("242050", 11_000, 1_000)).resolves.toBeNull();
        const retry = await idbAcquireBootstrapLease("242050", 11_000, 1_000, true);
        expect(retry).not.toBeNull();
        if (!retry) throw new Error("expected manual retry lease");
        await idbCompleteBootstrapImport(retry, [
          { ts: 1_000, current: 200, source: "steamcharts", granularity: "hourly" },
        ]);
        await expect(idbAcquireBootstrapLease("242050", Date.now(), 1_000, true)).resolves.toBeNull();
        await idbDeleteGameData("242050");
        await expect(idbAcquireBootstrapLease("242050", Date.now(), 1_000, true)).resolves.toBeNull();
      });

      it("allows manual recovery of stale completed history after a fifteen-minute cooldown", async () => {
        const now = Date.now();
        const lease = await idbAcquireBootstrapLease("3751950", now, 120_000);
        if (!lease) throw new Error("expected bootstrap lease");
        await idbCompleteBootstrapImport(lease, [
          { ts: now - 16 * 3_600_000, current: 2139, source: "games-popularity", granularity: "hourly" },
        ]);
        const completedAt = (await idbGetBootstrapStatus("3751950"))?.completedAt;
        if (completedAt === undefined) throw new Error("expected completed import");

        await expect(
          idbAcquireBootstrapLease("3751950", completedAt + 15 * 60_000 - 1, 120_000, true),
        ).resolves.toBeNull();
        await expect(idbAcquireBootstrapLease("3751950", completedAt + 15 * 60_000, 120_000)).resolves.toBeNull();
        await expect(
          idbAcquireBootstrapLease("3751950", completedAt + 15 * 60_000, 120_000, true),
        ).resolves.toMatchObject({ attempt: 1 });
        await expect(
          idbAcquireBootstrapLease("3751950", completedAt + 15 * 60_000 + 1, 120_000, true),
        ).resolves.toBeNull();
      });

      it("keeps fresh completed history on the normal schedule even during manual refresh", async () => {
        const now = Date.now();
        const lease = await idbAcquireBootstrapLease("570", now, 120_000);
        if (!lease) throw new Error("expected bootstrap lease");
        await idbCompleteBootstrapImport(lease, [
          { ts: now - 30 * 60_000, current: 200, source: "steamcharts", granularity: "hourly" },
        ]);
        const completedAt = (await idbGetBootstrapStatus("570"))?.completedAt;
        if (completedAt === undefined) throw new Error("expected completed import");

        await expect(idbAcquireBootstrapLease("570", completedAt + 15 * 60_000, 120_000, true)).resolves.toBeNull();
        await expect(idbAcquireBootstrapLease("570", completedAt + 6 * 3_600_000, 120_000)).resolves.toMatchObject({
          attempt: 1,
        });
      });

      it("promotes a matching unknown row to known metadata regardless of import order", async () => {
        const lease = await idbAcquireBootstrapLease("100", 10_000, 1_000);
        expect(lease).not.toBeNull();
        if (!lease) throw new Error("expected bootstrap lease");

        await expect(
          idbCompleteBootstrapImport(lease, [
            { ts: 1_000, current: 20, source: "steamcharts", granularity: "hourly" },
            { ts: 1_000, current: 20, source: "legacy", granularity: "unknown" },
          ]),
        ).resolves.toBe(true);

        await expect(idbGetSnapshots("100")).resolves.toEqual([
          { ts: 1_000, current: 20, source: "steamcharts", granularity: "hourly" },
        ]);
      });

      it("tombstones removed games so an old lease cannot restore history", async () => {
        const lease = await idbAcquireBootstrapLease("100", 10_000, 1_000);
        expect(lease).not.toBeNull();
        if (!lease) throw new Error("expected bootstrap lease");

        await idbDeleteGameData("100");

        await expect(
          idbCompleteBootstrapImport(lease, [{ ts: 1_000, current: 2, source: "steamcharts", granularity: "hourly" }]),
        ).resolves.toBe(false);
        await expect(idbGetSnapshots("100")).resolves.toEqual([]);

        await idbClearGameTombstone("100");
        await expect(idbAcquireBootstrapLease("100", 30_000, 1_000)).resolves.toMatchObject({ attempt: 1 });
      });
    });
  });
});
