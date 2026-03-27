import { openDB, type IDBPDatabase, type DBSchema } from "idb";

import type { PriceRecord, Snapshot } from "../types/index.js";

const DB_NAME = "steamwatch";
const DB_VERSION = 1;

interface SnapshotRow {
  id?: number;
  appId: string;
  ts: number;
  current: number;
}

interface ItadMappingRow {
  appId: string;
  itadUuid: string;
  updatedAt: number;
}

interface PriceHistoryRow {
  id?: number;
  appId: string;
  timestamp: number;
  priceAmountInt: number;
  regularAmountInt: number;
  cut: number;
  shop: string;
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
  itadMappings: {
    key: string;
    value: ItadMappingRow;
    indexes: {
      byUpdatedAt: number;
    };
  };
  priceHistory: {
    key: number;
    value: PriceHistoryRow;
    indexes: {
      byApp: string;
      byAppTime: [string, number];
    };
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

        if (!db.objectStoreNames.contains("itadMappings")) {
          const mappings = db.createObjectStore("itadMappings", {
            keyPath: "appId",
          });
          mappings.createIndex("byUpdatedAt", "updatedAt");
        }

        if (!db.objectStoreNames.contains("priceHistory")) {
          const ph = db.createObjectStore("priceHistory", {
            keyPath: "id",
            autoIncrement: true,
          });
          ph.createIndex("byApp", "appId");
          ph.createIndex("byAppTime", ["appId", "timestamp"]);
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

function toPriceRecord(row: PriceHistoryRow): PriceRecord {
  return {
    appId: row.appId,
    timestamp: row.timestamp,
    priceAmountInt: row.priceAmountInt,
    regularAmountInt: row.regularAmountInt,
    cut: row.cut,
    shop: row.shop,
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

export async function idbSaveItadMapping(appId: string, uuid: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("itadMappings", "readwrite", { durability: "relaxed" });
  await tx.store.put({
    appId,
    itadUuid: uuid,
    updatedAt: Date.now(),
  });
  await tx.done;
}

export async function idbGetItadMapping(appId: string): Promise<string | null> {
  const db = await getDB();
  const mapping = await db.get("itadMappings", appId);
  return mapping?.itadUuid ?? null;
}

export async function idbSavePriceHistory(
  appId: string,
  records: readonly PriceRecord[],
): Promise<void> {
  const db = await getDB();

  const deleteTx = db.transaction("priceHistory", "readwrite", { durability: "relaxed" });
  const deleteIndex = deleteTx.store.index("byApp");
  const keys = await deleteIndex.getAllKeys(appId);

  for (const key of keys) {
    await deleteTx.store.delete(key);
  }

  await deleteTx.done;

  if (records.length === 0) {
    return;
  }

  const writeTx = db.transaction("priceHistory", "readwrite", { durability: "relaxed" });
  for (const record of records) {
    await writeTx.store.add({
      appId,
      timestamp: record.timestamp,
      priceAmountInt: record.priceAmountInt,
      regularAmountInt: record.regularAmountInt,
      cut: record.cut,
      shop: record.shop,
    });
  }
  await writeTx.done;
}

export async function idbGetPriceHistory(appId: string): Promise<PriceRecord[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("priceHistory", "byApp", appId);
  rows.sort((a, b) => a.timestamp - b.timestamp);
  return rows.map(toPriceRecord);
}

export async function _resetDbForTesting(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}
