import { openDB, type IDBPDatabase, type DBSchema } from "idb";

import type { Snapshot } from "../types/index.js";

const DB_NAME = "steamwatch";
const DB_VERSION = 3;

interface SnapshotRow {
  id?: number;
  appId: string;
  ts: number;
  current: number;
}

interface CooldownRow {
  key: string;
  expiresAt: number;
}

interface SteamwatchDb extends DBSchema {
  snapshots: {
    key: number;
    value: SnapshotRow;
    indexes: {
      byApp: string;
      byAppTime: [string, number];
    };
  };
  cooldowns: {
    key: string;
    value: CooldownRow;
  };
}

let dbPromise: Promise<IDBPDatabase<SteamwatchDb>> | null = null;

function getDB(): Promise<IDBPDatabase<SteamwatchDb>> {
  if (!dbPromise) {
    dbPromise = openDB<SteamwatchDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("snapshots")) {
          const snap = db.createObjectStore("snapshots", {
            keyPath: "id",
            autoIncrement: true,
          });
          snap.createIndex("byApp", "appId");
          snap.createIndex("byAppTime", ["appId", "ts"]);
        }

        if (!db.objectStoreNames.contains("cooldowns")) {
          db.createObjectStore("cooldowns", {
            keyPath: "key",
          });
        }
      },
      blocked() {
        dbPromise = null;
      },
      blocking() {
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });
  }

  return dbPromise;
}

function toSnapshot(row: SnapshotRow): Snapshot {
  return {
    ts: row.ts,
    current: row.current,
  };
}

export async function idbSaveSnapshot(appId: string, snap: Snapshot): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("snapshots", "readwrite", { durability: "relaxed" });
  await tx.store.add({
    appId,
    ts: snap.ts,
    current: snap.current,
  });
  await tx.done;
}

export async function idbBulkSaveSnapshots(
  appId: string,
  snapshots: readonly Snapshot[],
): Promise<void> {
  if (snapshots.length === 0) {
    return;
  }

  const db = await getDB();
  const tx = db.transaction("snapshots", "readwrite", { durability: "relaxed" });
  for (const snap of snapshots) {
    await tx.store.add({
      appId,
      ts: snap.ts,
      current: snap.current,
    });
  }
  await tx.done;
}

export async function idbGetSnapshots(appId: string): Promise<Snapshot[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("snapshots", "byApp", appId);
  rows.sort((a, b) => a.ts - b.ts);
  return rows.map(toSnapshot);
}

export async function idbGetSnapshotsInRange(
  appId: string,
  startTs: number,
  endTs: number,
): Promise<Snapshot[]> {
  const db = await getDB();
  const range = IDBKeyRange.bound([appId, startTs], [appId, endTs]);
  const rows = await db.getAllFromIndex("snapshots", "byAppTime", range);
  rows.sort((a, b) => a.ts - b.ts);
  return rows.map(toSnapshot);
}

export async function idbDeleteSnapshots(appId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("snapshots", "readwrite", { durability: "relaxed" });
  const index = tx.store.index("byApp");
  const keys = await index.getAllKeys(appId);

  for (const key of keys) {
    await tx.store.delete(key);
  }

  await tx.done;
}

export async function _resetDbForTesting(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}

export async function idbGetCooldown(key: string): Promise<number | null> {
  const db = await getDB();
  const entry = await db.get("cooldowns", key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry.expiresAt;
}

export async function idbSetCooldown(key: string, expiresAt: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("cooldowns", "readwrite", { durability: "relaxed" });
  await tx.store.put({
    key,
    expiresAt,
  });
  await tx.done;
}

export async function idbPurgeCooldowns(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("cooldowns", "readwrite", { durability: "relaxed" });
  const now = Date.now();
  const allEntries = await tx.store.getAll();

  for (const entry of allEntries) {
    if (entry.expiresAt <= now) {
      await tx.store.delete(entry.key);
    }
  }

  await tx.done;
}
