import type { Game, Snapshot } from "../types/index.js";
import { idbGetSnapshots, idbSaveSnapshot } from "./idb-storage.js";

const MIGRATION_SENTINEL_KEY = "sw_migration_complete";
const GAMES_KEY = "sw_games";
const SNAP_PREFIX = "sw_snaps_";

export interface MigrationStats {
  migrated: number;
  skipped: number;
  errors: number;
}

function isValidSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { ts?: unknown; current?: unknown };
  return (
    typeof candidate.ts === "number" &&
    Number.isFinite(candidate.ts) &&
    typeof candidate.current === "number" &&
    Number.isFinite(candidate.current)
  );
}

async function getLocal<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

export async function migrateToIndexedDB(): Promise<MigrationStats> {
  const sentinel = await getLocal<boolean>(MIGRATION_SENTINEL_KEY);
  if (sentinel === true) {
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  const stats: MigrationStats = { migrated: 0, skipped: 0, errors: 0 };
  const games = await getLocal<readonly Game[]>(GAMES_KEY);

  if (!Array.isArray(games) || games.length === 0) {
    return stats;
  }

  const expectedByApp = new Map<string, number>();

  for (const game of games) {
    const appId = game.appid;
    const rawSnapshots = await getLocal<unknown>(`${SNAP_PREFIX}${appId}`);

    if (!Array.isArray(rawSnapshots)) {
      stats.skipped += 1;
      expectedByApp.set(appId, 0);
      continue;
    }

    let validCount = 0;

    for (const rawSnapshot of rawSnapshots) {
      if (!isValidSnapshot(rawSnapshot)) {
        stats.errors += 1;
        continue;
      }

      try {
        await idbSaveSnapshot(appId, rawSnapshot);
        stats.migrated += 1;
        validCount += 1;
      } catch (error) {
        stats.errors += 1;
        console.error("[migrate] Failed to save snapshot to IndexedDB", {
          appId,
          error,
        });
      }
    }

    expectedByApp.set(appId, validCount);
  }

  let allVerified = true;

  for (const [appId, expectedCount] of expectedByApp.entries()) {
    try {
      const stored = await idbGetSnapshots(appId);
      if (stored.length !== expectedCount) {
        allVerified = false;
        stats.errors += 1;
        console.error("[migrate] Snapshot verification count mismatch", {
          appId,
          expectedCount,
          actualCount: stored.length,
        });
      }
    } catch (error) {
      allVerified = false;
      stats.errors += 1;
      console.error("[migrate] Failed to verify snapshots after migration", {
        appId,
        error,
      });
    }
  }

  if (allVerified) {
    await chrome.storage.local.set({ [MIGRATION_SENTINEL_KEY]: true });
  }

  return stats;
}
