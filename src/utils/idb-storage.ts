import { openDB, type IDBPDatabase, type DBSchema } from "idb";

import { SnapshotSchema } from "../types/index.js";
import type {
  BootstrapLease,
  BootstrapStatus,
  Snapshot,
  SnapshotSource,
} from "../types/index.js";

const DB_NAME = "steamwatch";
const DB_VERSION = 5;

interface SnapshotRow extends Snapshot {
  id?: number;
  appId: string;
}

interface CooldownRow {
  key: string;
  expiresAt: number;
}

interface BootstrapRow extends BootstrapStatus {
  token?: string;
  leaseExpiresAt?: number;
}

interface TombstoneRow {
  appId: string;
  removedAt: number;
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
  bootstrapStates: {
    key: string;
    value: BootstrapRow;
  };
  gameTombstones: {
    key: string;
    value: TombstoneRow;
  };
}

let dbPromise: Promise<IDBPDatabase<SteamwatchDb>> | null = null;
let activeDb: IDBPDatabase<SteamwatchDb> | null = null;

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

        if (!db.objectStoreNames.contains("bootstrapStates")) {
          db.createObjectStore("bootstrapStates", { keyPath: "appId" });
        }

        if (!db.objectStoreNames.contains("gameTombstones")) {
          db.createObjectStore("gameTombstones", { keyPath: "appId" });
        }
      },
      blocked() {
        dbPromise = null;
      },
      blocking() {
        activeDb?.close();
        activeDb = null;
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    }).then((db) => {
      activeDb = db;
      return db;
    });
  }

  return dbPromise;
}

function toSnapshot(row: SnapshotRow): Snapshot | null {
  const parsed = SnapshotSchema.safeParse({
    ts: row.ts,
    current: row.current,
    ...(row.source ? { source: row.source } : {}),
    ...(row.granularity ? { granularity: row.granularity } : {}),
    ...(row.aggregate ? { aggregate: row.aggregate } : {}),
  });
  if (!parsed.success) return null;
  return {
    ts: parsed.data.ts,
    current: parsed.data.current,
    source: parsed.data.source ?? "legacy",
    granularity: parsed.data.granularity ?? "unknown",
    ...(parsed.data.aggregate ? { aggregate: parsed.data.aggregate } : {}),
  };
}

function toSnapshotRow(appId: string, snap: Snapshot): SnapshotRow {
  return {
    appId,
    ts: snap.ts,
    current: snap.current,
    ...(snap.source ? { source: snap.source } : {}),
    ...(snap.granularity ? { granularity: snap.granularity } : {}),
    ...(snap.aggregate ? { aggregate: snap.aggregate } : {}),
  };
}

function sourcePriority(source: SnapshotSource): number {
  if (source === "steam") return 3;
  if (source === "steamcharts") return 2;
  return 1;
}

function snapshotPriority(snapshot: Snapshot): number {
  const source = snapshot.source ?? "legacy";
  const granularity = snapshot.granularity ?? "unknown";
  const resolution = granularity === "instant" ? 2 : granularity === "hourly" ? 1 : 0;
  return sourcePriority(source) * 10 + resolution;
}

function measurementKind(snapshot: Snapshot): string {
  const granularity = snapshot.granularity ?? "unknown";
  if (granularity === "instant" || granularity === "hourly") return "observation";
  return granularity;
}

function selectPreferredSnapshots(snapshots: readonly Snapshot[]): Snapshot[] {
  const selected = new Map<string, Snapshot>();
  const knownValues = new Set(snapshots
    .filter((snapshot) => measurementKind(snapshot) !== "unknown")
    .map((snapshot) => `${snapshot.ts}:${snapshot.current}`));
  for (const snapshot of snapshots) {
    const unknownKey = `unknown:${snapshot.ts}:${snapshot.current}`;
    const kind = measurementKind(snapshot);
    if (kind === "unknown" && knownValues.has(`${snapshot.ts}:${snapshot.current}`)) continue;
    if (kind !== "unknown") {
      const unknown = selected.get(unknownKey);
      if (unknown) selected.delete(unknownKey);
    }

    const key = kind === "unknown" ? unknownKey : `${kind}:${snapshot.ts}`;
    const previous = selected.get(key);
    if (!previous || snapshotPriority(snapshot) > snapshotPriority(previous)) {
      selected.set(key, snapshot);
    }
  }
  return [...selected.values()].sort((left, right) => left.ts - right.ts);
}

function toPersistableSnapshot(snapshot: Snapshot, now: number): Snapshot | null {
  const parsed = SnapshotSchema.safeParse(snapshot);
  if (!parsed.success || parsed.data.ts > now) return null;
  return {
    ts: parsed.data.ts,
    current: parsed.data.current,
    ...(parsed.data.source ? { source: parsed.data.source } : {}),
    ...(parsed.data.granularity ? { granularity: parsed.data.granularity } : {}),
    ...(parsed.data.aggregate ? { aggregate: parsed.data.aggregate } : {}),
  };
}

async function rollbackTransaction(tx: { abort(): void; done: Promise<unknown> }): Promise<void> {
  try {
    tx.abort();
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
  }
  await tx.done.catch(() => undefined);
}

function importedSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    source: snapshot.source ?? "steamcharts",
    granularity: snapshot.granularity ?? "unknown",
  };
}

export async function idbSaveSnapshot(appId: string, snap: Snapshot): Promise<void> {
  await idbBulkSaveSnapshots(appId, [snap]);
}

export async function idbBulkSaveSnapshots(
  appId: string,
  snapshots: readonly Snapshot[],
): Promise<void> {
  const now = Date.now();
  const validSnapshots = snapshots.flatMap((snapshot) => {
    const parsed = toPersistableSnapshot(snapshot, now);
    return parsed ? [parsed] : [];
  });
  if (validSnapshots.length === 0) {
    return;
  }

  const db = await getDB();
  const tx = db.transaction(["snapshots", "gameTombstones"], "readwrite", { durability: "relaxed" });
  const tombstone = await tx.objectStore("gameTombstones").get(appId);
  if (tombstone) {
    await tx.done;
    return;
  }
  try {
    const store = tx.objectStore("snapshots");
    const index = store.index("byAppTime");
    const byTimestamp = new Map<number, Snapshot[]>();
    for (const snapshot of validSnapshots) {
      const current = byTimestamp.get(snapshot.ts);
      if (current) current.push(snapshot);
      else byTimestamp.set(snapshot.ts, [snapshot]);
    }
    for (const [timestamp, additions] of byTimestamp) {
      const range = IDBKeyRange.bound([appId, timestamp], [appId, timestamp]);
      const [existingRows, existingKeys] = await Promise.all([index.getAll(range), index.getAllKeys(range)]);
      const existing = existingRows.flatMap((row) => {
        const snapshot = toSnapshot(row);
        return snapshot ? [snapshot] : [];
      });
      const merged = selectPreferredSnapshots([...existing, ...additions]);
      for (const key of existingKeys) {
        await store.delete(key);
      }
      for (const snapshot of merged) {
        await store.add(toSnapshotRow(appId, snapshot));
      }
    }
    await tx.done;
  } catch (error) {
    await rollbackTransaction(tx);
    throw error;
  }
}

export async function idbGetSnapshots(appId: string): Promise<Snapshot[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("snapshots", "byApp", appId);
  rows.sort((a, b) => a.ts - b.ts);
  return rows.flatMap((row) => {
    const snapshot = toSnapshot(row);
    return snapshot ? [snapshot] : [];
  });
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
  return rows.flatMap((row) => {
    const snapshot = toSnapshot(row);
    return snapshot ? [snapshot] : [];
  });
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

/**
 * Runs the read, calculation and replacement of one game's series under the
 * same IndexedDB write transaction. Writers that start while this runs queue
 * behind the transaction, so a live observation cannot be lost in the gap.
 */
export async function idbTransformSnapshotsAtomically(
  appId: string,
  transform: (snapshots: readonly Snapshot[]) => readonly Snapshot[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("snapshots", "readwrite", { durability: "relaxed" });
  const store = tx.objectStore("snapshots");
  const index = store.index("byApp");
  const [rows, keys] = await Promise.all([index.getAll(appId), index.getAllKeys(appId)]);
  const snapshots = rows.flatMap((row) => {
    const snapshot = toSnapshot(row);
    return snapshot ? [snapshot] : [];
  });
  try {
    const next = [...transform(snapshots)].sort((left, right) => left.ts - right.ts);
    for (const key of keys) {
      await store.delete(key);
    }
    for (const snapshot of next) {
      await store.add(toSnapshotRow(appId, snapshot));
    }
    await tx.done;
  } catch (error) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export async function idbClearAllData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["snapshots", "cooldowns", "bootstrapStates", "gameTombstones"],
    "readwrite",
    { durability: "relaxed" },
  );
  await Promise.all([
    tx.objectStore("snapshots").clear(),
    tx.objectStore("cooldowns").clear(),
    tx.objectStore("bootstrapStates").clear(),
    tx.objectStore("gameTombstones").clear(),
  ]);
  await tx.done;
}

export async function _resetDbForTesting(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  activeDb = null;
  dbPromise = null;
}

function createLease(appId: string, attempt: number, now: number, leaseDurationMs: number): BootstrapLease {
  return {
    appId,
    token: crypto.randomUUID(),
    expiresAt: now + leaseDurationMs,
    attempt,
  };
}

function canAcquireBootstrap(row: BootstrapRow | undefined, now: number, retryFailed: boolean): boolean {
  if (!row) return true;
  if (row.state === "retry" || row.state === "unavailable") return retryFailed || (row.retryAt ?? 0) <= now;
  if (row.state === "leased") return (row.leaseExpiresAt ?? 0) <= now;
  return (row.completedAt ?? 0) + 6 * 60 * 60_000 <= now;
}

/** Acquires one durable bootstrap lease, or returns null while another run owns it. */
export async function idbAcquireBootstrapLease(
  appId: string,
  now: number,
  leaseDurationMs: number,
  retryFailed = false,
): Promise<BootstrapLease | null> {
  const db = await getDB();
  const tx = db.transaction(["bootstrapStates", "gameTombstones"], "readwrite", { durability: "relaxed" });
  const [tombstone, previous] = await Promise.all([
    tx.objectStore("gameTombstones").get(appId),
    tx.objectStore("bootstrapStates").get(appId),
  ]);
  if (tombstone || !canAcquireBootstrap(previous, now, retryFailed)) {
    await tx.done;
    return null;
  }

  const attempt = previous?.state === "completed" ? 1 : (previous?.attempt ?? 0) + 1;
  const lease = createLease(appId, attempt, now, leaseDurationMs);
  await tx.objectStore("bootstrapStates").put({
    appId,
    state: "leased",
    attempt: lease.attempt,
    token: lease.token,
    leaseExpiresAt: lease.expiresAt,
  });
  await tx.done;
  return lease;
}

/** Completes an import and writes its deduplicated snapshots in one transaction. */
export async function idbCompleteBootstrapImport(
  lease: BootstrapLease,
  snapshots: readonly Snapshot[],
): Promise<boolean> {
  const db = await getDB();
  const tx = db.transaction(
    ["snapshots", "bootstrapStates", "gameTombstones"],
    "readwrite",
    { durability: "relaxed" },
  );
  const [tombstone, status] = await Promise.all([
    tx.objectStore("gameTombstones").get(lease.appId),
    tx.objectStore("bootstrapStates").get(lease.appId),
  ]);
  if (tombstone || status?.state !== "leased" || status.token !== lease.token) {
    await tx.done;
    return false;
  }

  const now = Date.now();
  const imported = selectPreferredSnapshots(snapshots.flatMap((snapshot) => {
    const parsed = toPersistableSnapshot(snapshot, now);
    return parsed ? [importedSnapshot(parsed)] : [];
  }));
  if (imported.length === 0) {
    await tx.objectStore("bootstrapStates").put({
      appId: lease.appId,
      state: "retry",
      attempt: lease.attempt,
      retryAt: now + 15 * 60_000,
    });
    await tx.done;
    return false;
  }
  try {
    const store = tx.objectStore("snapshots");
    const index = store.index("byApp");
    const [existingRows, existingKeys] = await Promise.all([
      index.getAll(lease.appId),
      index.getAllKeys(lease.appId),
    ]);
    const existing = existingRows.flatMap((row) => {
      const snapshot = toSnapshot(row);
      return snapshot ? [snapshot] : [];
    });
    const merged = selectPreferredSnapshots([...existing, ...imported]);
    for (const key of existingKeys) {
      await store.delete(key);
    }
    for (const snapshot of merged) {
      await store.add(toSnapshotRow(lease.appId, snapshot));
    }

    const timestamps = imported.map((snapshot) => snapshot.ts);
    await tx.objectStore("bootstrapStates").put({
      appId: lease.appId,
      state: "completed",
      attempt: lease.attempt,
      completedAt: now,
      importedCount: imported.length,
      ...(timestamps.length > 0 ? { startTs: Math.min(...timestamps), endTs: Math.max(...timestamps) } : {}),
    });
    await tx.done;
    return true;
  } catch (error) {
    await rollbackTransaction(tx);
    throw error;
  }
}

/** Records a recoverable failure only when the caller still owns the lease. */
export async function idbFailBootstrapLease(lease: BootstrapLease, retryAt: number, state: "retry" | "unavailable" = "retry"): Promise<boolean> {
  const db = await getDB();
  const tx = db.transaction("bootstrapStates", "readwrite", { durability: "relaxed" });
  const status = await tx.store.get(lease.appId);
  if (status?.state !== "leased" || status.token !== lease.token) {
    await tx.done;
    return false;
  }
  await tx.store.put({
    appId: lease.appId,
    state,
    attempt: lease.attempt,
    retryAt,
  });
  await tx.done;
  return true;
}

export async function idbGetBootstrapStatus(appId: string): Promise<BootstrapStatus | null> {
  const db = await getDB();
  const status = await db.get("bootstrapStates", appId);
  if (!status) return null;
  const { token: _token, leaseExpiresAt: _leaseExpiresAt, ...publicStatus } = status;
  return publicStatus;
}

/**
 * Deletes one game's IDB state atomically and leaves a tombstone so an import
 * that was already in flight cannot recreate snapshots after removal.
 */
export async function idbDeleteGameData(appId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["snapshots", "cooldowns", "bootstrapStates", "gameTombstones"],
    "readwrite",
    { durability: "relaxed" },
  );
  const snapshots = tx.objectStore("snapshots");
  const cooldowns = tx.objectStore("cooldowns");
  const snapshotKeys = await snapshots.index("byApp").getAllKeys(appId);
  const cooldownRows = await cooldowns.getAll();
  for (const key of snapshotKeys) {
    await snapshots.delete(key);
  }
  for (const cooldown of cooldownRows) {
    if (cooldown.key.startsWith(`${appId}__`) || cooldown.key === `bootstrap__${appId}`) {
      await cooldowns.delete(cooldown.key);
    }
  }
  await tx.objectStore("bootstrapStates").delete(appId);
  await tx.objectStore("gameTombstones").put({ appId, removedAt: Date.now() });
  await tx.done;
}

/** Clears the removal guard when the user explicitly tracks the game again. */
export async function idbClearGameTombstone(appId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("gameTombstones", "readwrite", { durability: "relaxed" });
  await tx.store.delete(appId);
  await tx.done;
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
