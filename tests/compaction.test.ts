import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compactSnapshots } from "../src/utils/compaction.js";
import {
  _resetDbForTesting,
  idbGetSnapshots,
  idbSaveSnapshot,
} from "../src/utils/idb-storage.js";
import type { Snapshot } from "../src/types/index.js";

const DAY_MS = 86_400_000;
const FIXED_NOW = Date.UTC(2026, 2, 27, 12, 0, 0, 0);

function ts(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m - 1, d, h, min, 0, 0);
}

function startOfDayUtc(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfIsoWeekUtc(timestamp: number): number {
  const d = new Date(timestamp);
  const day = d.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function seed(appId: string, snaps: readonly Snapshot[]): Promise<void> {
  for (const snap of snaps) {
    await idbSaveSnapshot(appId, snap);
  }
}

describe("compactSnapshots", () => {
  beforeEach(async () => {
    await _resetDbForTesting();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("steamwatch");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
    await _resetDbForTesting();
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compactSnapshots on empty IDB is a no-op", async () => {
    await compactSnapshots("app", 7);
    await expect(idbGetSnapshots("app")).resolves.toEqual([]);
  });

  it("does not touch snapshots within fullResolutionDays", async () => {
    const appId = "recent-only";
    const snaps: Snapshot[] = [
      { ts: FIXED_NOW - DAY_MS, current: 100 },
      { ts: FIXED_NOW - 2 * DAY_MS, current: 120 },
      { ts: FIXED_NOW - 6 * DAY_MS, current: 80 },
    ];
    await seed(appId, snaps);

    await compactSnapshots(appId, 7);

    await expect(idbGetSnapshots(appId)).resolves.toEqual(snaps.slice().sort((a, b) => a.ts - b.ts));
  });

  it("compacts medium-age snapshots to one daily aggregate", async () => {
    const appId = "medium";
    const medium: Snapshot[] = [
      { ts: ts(2026, 3, 10, 2), current: 100 },
      { ts: ts(2026, 3, 10, 10), current: 200 },
      { ts: ts(2026, 3, 10, 20), current: 300 },
      { ts: ts(2026, 2, 1, 5), current: 50 },
      { ts: ts(2026, 2, 1, 7), current: 50 },
    ];
    await seed(appId, medium);

    await compactSnapshots(appId, 7);

    await expect(idbGetSnapshots(appId)).resolves.toEqual([
      { ts: startOfDayUtc(ts(2026, 2, 1, 5)), current: 50 },
      { ts: startOfDayUtc(ts(2026, 3, 10, 2)), current: 200 },
    ]);
  });

  it("compacts snapshots older than 90 days to one weekly aggregate", async () => {
    const appId = "old";
    const old: Snapshot[] = [
      { ts: ts(2025, 12, 8, 4), current: 20 },
      { ts: ts(2025, 12, 10, 12), current: 20 },
      { ts: ts(2025, 12, 14, 23), current: 20 },
      { ts: ts(2025, 11, 24, 8), current: 100 },
      { ts: ts(2025, 11, 25, 8), current: 200 },
    ];
    await seed(appId, old);

    await compactSnapshots(appId, 7);

    await expect(idbGetSnapshots(appId)).resolves.toEqual([
      { ts: startOfIsoWeekUtc(ts(2025, 11, 24, 8)), current: 150 },
      { ts: startOfIsoWeekUtc(ts(2025, 12, 8, 4)), current: 20 },
    ]);
  });

  it("always preserves the all-time minimum snapshot", async () => {
    const appId = "min-preserved";
    const oldWeek: Snapshot[] = [
      { ts: ts(2025, 11, 3, 10), current: 0 },
      { ts: ts(2025, 11, 4, 10), current: 50 },
      { ts: ts(2025, 11, 5, 10), current: 100 },
    ];
    await seed(appId, oldWeek);

    await compactSnapshots(appId, 7);
    const compacted = await idbGetSnapshots(appId);

    expect(compacted).toContainEqual({ ts: ts(2025, 11, 3, 10), current: 0 });
    expect(compacted).toContainEqual({ ts: startOfIsoWeekUtc(ts(2025, 11, 3, 10)), current: 50 });
  });

  it("is idempotent when run twice", async () => {
    const appId = "idempotent";
    const snaps: Snapshot[] = [
      { ts: FIXED_NOW - DAY_MS, current: 99 },
      { ts: ts(2026, 3, 10, 3), current: 100 },
      { ts: ts(2026, 3, 10, 13), current: 300 },
      { ts: ts(2025, 12, 8, 4), current: 10 },
      { ts: ts(2025, 12, 9, 4), current: 30 },
    ];
    await seed(appId, snaps);

    await compactSnapshots(appId, 7);
    const once = await idbGetSnapshots(appId);

    await compactSnapshots(appId, 7);
    const twice = await idbGetSnapshots(appId);

    expect(twice).toEqual(once);
  });

  it("is a no-op for an app with no data", async () => {
    await seed("another-app", [{ ts: FIXED_NOW - DAY_MS, current: 123 }]);

    await expect(compactSnapshots("missing-app", 7)).resolves.toBeUndefined();
    await expect(idbGetSnapshots("missing-app")).resolves.toEqual([]);
    await expect(idbGetSnapshots("another-app")).resolves.toEqual([{ ts: FIXED_NOW - DAY_MS, current: 123 }]);
  });

  it("compacts all three tiers independently when present together", async () => {
    const appId = "all-tiers";
    const snaps: Snapshot[] = [
      { ts: FIXED_NOW - DAY_MS, current: 1000 },
      { ts: FIXED_NOW - 2 * DAY_MS, current: 1100 },

      { ts: ts(2026, 3, 1, 2), current: 100 },
      { ts: ts(2026, 3, 1, 12), current: 200 },
      { ts: ts(2026, 2, 20, 6), current: 300 },
      { ts: ts(2026, 2, 20, 8), current: 500 },

      { ts: ts(2025, 12, 8, 3), current: 10 },
      { ts: ts(2025, 12, 10, 3), current: 10 },
      { ts: ts(2025, 11, 24, 3), current: 30 },
      { ts: ts(2025, 11, 26, 3), current: 50 },
    ];
    await seed(appId, snaps);

    await compactSnapshots(appId, 7);

    await expect(idbGetSnapshots(appId)).resolves.toEqual([
      { ts: startOfIsoWeekUtc(ts(2025, 11, 24, 3)), current: 40 },
      { ts: startOfIsoWeekUtc(ts(2025, 12, 8, 3)), current: 10 },
      { ts: startOfDayUtc(ts(2026, 2, 20, 6)), current: 400 },
      { ts: startOfDayUtc(ts(2026, 3, 1, 2)), current: 150 },
      { ts: FIXED_NOW - 2 * DAY_MS, current: 1100 },
      { ts: FIXED_NOW - DAY_MS, current: 1000 },
    ]);
  });
});
