import {
  fetchCurrentPlayers,
  fetchSteamChartsResult,
  fetchSteamSpyResult,
  fetchTwitchResult,
} from "../utils/api.js";
import {
  getCache,
  getGameSettings,
  getGames,
  getSettings,
  setCache,
  setLastFetchAttemptTime,
  setLastFetchTime,
} from "../utils/storage.js";
import { idbGetSnapshots, idbSaveSnapshot } from "../utils/idb-storage.js";
import { refreshHistory } from "./historyBootstrap.js";
import { buildCachedData } from "./fetchCycle.js";
import { publishLiveResult, updateBadge } from "./signals.js";
import { formatError } from "../utils/log.js";

import type {
  CachedData,
  FieldFreshness,
  Game,
  GameSettings,
  ProviderResult,
  Settings,
  Snapshot,
  SteamChartsData,
  SteamSpyData,
} from "../types/index.js";

const METADATA_TTL_MS = 60 * 60_000;
const TWITCH_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 5 * 60_000;

export interface RefreshResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface RefreshCoordinatorDependencies {
  readonly getGames: () => Promise<Game[]>;
  readonly getSettings: () => Promise<Settings>;
  readonly getGameSettings: (appid: string) => Promise<GameSettings>;
  readonly getCache: () => Promise<Record<string, CachedData>>;
  readonly setCache: (cache: Record<string, CachedData>) => Promise<void>;
  readonly setLastFetchTime: (timestamp: number) => Promise<void>;
  readonly setLastFetchAttemptTime: (timestamp: number) => Promise<void>;
  readonly fetchCurrentPlayers: (appid: string) => Promise<number | null>;
  readonly fetchSteamChartsResult: (appid: string) => Promise<ProviderResult<SteamChartsData>>;
  readonly fetchSteamSpyResult: (appid: string) => Promise<ProviderResult<SteamSpyData>>;
  readonly fetchTwitchResult: (gameName: string) => Promise<ProviderResult<number>>;
  readonly refreshHistory: (appid: string, retryFailed?: boolean) => Promise<boolean>;
  readonly saveSnapshot: (appid: string, snapshot: Snapshot) => Promise<void>;
  readonly getSnapshots: (appid: string) => Promise<Snapshot[]>;
  readonly publishLiveResult: (input: {
    readonly game: Game;
    readonly current: number;
    readonly snapshots: readonly Snapshot[];
    readonly settings: Settings;
    readonly gameSettings: GameSettings;
    readonly cache: Record<string, CachedData>;
  }) => Promise<"rising" | "alerting" | "stable">;
  readonly updateBadge: (rising: number, alerting: number, favoriteAppid: string | undefined, cache: Record<string, CachedData>, gameSignals: ReadonlyMap<string, "rising" | "alerting" | "stable">) => void;
  readonly clearBadge: () => void;
  readonly now: () => number;
}

export class RefreshCoordinator {
  private liveCycle: Promise<RefreshResult> | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private readonly auxiliaryJobs = new Map<string, Promise<void>>();
  private readonly gameSignals = new Map<string, "rising" | "alerting" | "stable">();

  public constructor(private readonly dependencies: RefreshCoordinatorDependencies) {}

  public refresh(retryFailedHistory = false): Promise<RefreshResult> {
    if (retryFailedHistory) {
      this.startSourceJob("manual-history", async () => {
        const games = await this.dependencies.getGames();
        for (const game of games) {
          this.startSourceJob(`${game.appid}:history`, async () => {
            await this.dependencies.refreshHistory(game.appid, true);
          });
        }
      });
    }
    if (this.liveCycle) return this.liveCycle;
    const cycle = this.runLiveCycle().finally(() => {
      if (this.liveCycle === cycle) this.liveCycle = null;
    });
    this.liveCycle = cycle;
    return cycle;
  }

  public async auxiliaryIdle(): Promise<void> {
    await Promise.all(this.auxiliaryJobs.values());
  }

  private async runLiveCycle(): Promise<RefreshResult> {
    const attemptedAt = this.dependencies.now();
    await this.dependencies.setLastFetchAttemptTime(attemptedAt);
    const [games, settings] = await Promise.all([
      this.dependencies.getGames(),
      this.dependencies.getSettings(),
    ]);
    this.gameSignals.clear();
    if (games.length === 0) {
      this.dependencies.clearBadge();
      return { ok: true };
    }

    const settled = await Promise.allSettled(games.map((game) => this.refreshGame(game, settings, attemptedAt)));
    const successfulAt = settled.flatMap((result) => result.status === "fulfilled" && result.value.published && result.value.acquiredAt !== undefined
      ? [result.value.acquiredAt]
      : []);
    const count = successfulAt.length;
    if (count === 0) {
      return { ok: false, error: "No current player counts were available." };
    }
    await this.dependencies.setLastFetchTime(Math.max(...successfulAt));
    return { ok: true };
  }

  private async refreshGame(game: Game, settings: Settings, attemptedAt: number): Promise<{ readonly published: boolean; readonly acquiredAt?: number }> {
    this.startSourceJob(`${game.appid}:history`, async () => { await this.dependencies.refreshHistory(game.appid); });
    this.startAuxiliary(game, attemptedAt);
    let current: number | null;
    try {
      current = await this.dependencies.fetchCurrentPlayers(game.appid);
    } catch (error: unknown) {
      console.warn(`[SteamWatch] Current player fetch failed for ${game.appid}: ${formatError(error)}`);
      await this.markCurrentFailure(game.appid, "error", this.dependencies.now());
      return { published: false };
    }
    const acquiredAt = this.dependencies.now();
    if (current === null) {
      await this.markCurrentFailure(game.appid, "error", acquiredAt);
      return { published: false };
    }

    const committed = await this.enqueueWrite(async () => {
      const followed = await this.dependencies.getGames();
      if (!followed.some((candidate) => candidate.appid === game.appid)) return false;
      const cache = await this.dependencies.getCache();
      const previous = cache[game.appid];
      const cacheData = buildCachedData({
        currentPlayers: current,
        ...(previous ? { prevCache: previous } : {}),
        fetchedAt: acquiredAt,
        twitchViewers: null,
        freshness: {
          current: { source: "steam", status: "ok", acquiredAt, attemptedAt: acquiredAt },
        },
      });
      const nextCache = { ...cache, [game.appid]: cacheData };
      await this.dependencies.setCache(nextCache);
      await this.dependencies.saveSnapshot(game.appid, {
        ts: acquiredAt,
        current,
        source: "steam",
        granularity: "instant",
      });
      return nextCache;
    });
    if (!committed) return { published: false };
    try {
      const [snapshots, gameSettings] = await Promise.all([
        this.dependencies.getSnapshots(game.appid),
        this.dependencies.getGameSettings(game.appid),
      ]);
      const signal = await this.dependencies.publishLiveResult({ game, current, snapshots, settings, gameSettings, cache: committed });
      this.gameSignals.set(game.appid, signal);
      await this.enqueueWrite(async () => {
        const [latestCache, latestSettings] = await Promise.all([
          this.dependencies.getCache(),
          this.dependencies.getSettings(),
        ]);
        const signals = [...this.gameSignals.values()];
        this.dependencies.updateBadge(signals.filter((value) => value === "rising").length, signals.filter((value) => value === "alerting").length, latestSettings.badgeFavoriteAppid, latestCache, this.gameSignals);
      });
    } catch (error: unknown) {
      console.warn(`[SteamWatch] Live signal publish failed for ${game.appid}: ${formatError(error)}`);
    }
    this.startAuxiliary(game, acquiredAt);
    return { published: true, acquiredAt };
  }

  private async markCurrentFailure(appid: string, status: "error" | "unavailable", attemptedAt: number): Promise<void> {
    await this.updateMetadata(appid, (cache) => ({
      ...cache,
      freshness: {
        ...cache.freshness,
        current: this.freshness(
          "steam",
          status === "error" ? { status: "error", error: "Current player count unavailable" } : { status: "unavailable" },
          attemptedAt,
          cache.freshness?.current,
        ),
      },
    }));
  }

  private startAuxiliary(game: Game, attemptedAt: number): void {
    this.startSourceJob(`${game.appid}:steamcharts`, async () => {
      const cache = await this.dependencies.getCache();
      if (!this.isDue(cache[game.appid], "peak24h", METADATA_TTL_MS, attemptedAt)) return;
      const result = await this.dependencies.fetchSteamChartsResult(game.appid);
      await this.saveCharts(game, result, this.dependencies.now());
    });
    this.startSourceJob(`${game.appid}:steamspy`, async () => {
      const cache = await this.dependencies.getCache();
      if (!this.isDue(cache[game.appid], "allTimePeak", METADATA_TTL_MS, attemptedAt)) return;
      const result = await this.dependencies.fetchSteamSpyResult(game.appid);
      await this.saveSpy(game, result, this.dependencies.now());
    });
    this.startSourceJob(`${game.appid}:twitch`, async () => {
      const cache = await this.dependencies.getCache();
      if (!this.isDue(cache[game.appid], "twitchViewers", TWITCH_TTL_MS, attemptedAt)) return;
      const result = await this.dependencies.fetchTwitchResult(game.name);
      await this.saveTwitch(game, result, this.dependencies.now());
    });
  }

  private startSourceJob(key: string, job: () => Promise<void>): void {
    if (this.auxiliaryJobs.has(key)) return;
    const pending = job().catch((error: unknown) => {
      console.warn(`[SteamWatch] Background source ${key} failed: ${formatError(error)}`);
    }).finally(() => this.auxiliaryJobs.delete(key));
    this.auxiliaryJobs.set(key, pending);
  }

  private isDue(cache: CachedData | undefined, metric: "peak24h" | "allTimePeak" | "twitchViewers", ttl: number, now: number): boolean {
    const freshness = cache?.freshness?.[metric];
    if (!freshness) return true;
    const age = now - freshness.attemptedAt;
    return freshness.status === "ok" ? age >= ttl : age >= NEGATIVE_TTL_MS;
  }

  private async saveCharts(game: Game, result: ProviderResult<SteamChartsData>, attemptedAt: number): Promise<void> {
    await this.updateMetadata(game.appid, (cache) => ({
      ...cache,
      ...(result.status === "ok" && result.value.peak24h !== undefined ? { peak24h: result.value.peak24h } : {}),
      ...(result.status === "ok" && result.value.allTimePeak !== undefined ? { allTimePeak: result.value.allTimePeak } : {}),
      ...(result.status === "ok" && result.value.allTimePeakLabel !== undefined ? { allTimePeakLabel: result.value.allTimePeakLabel } : {}),
      freshness: {
        ...cache.freshness,
        peak24h: this.metricFreshness("steamcharts", result, result.status === "ok" && result.value.peak24h !== undefined, attemptedAt, cache.freshness?.peak24h),
        allTimePeak: this.metricFreshness("steamcharts", result, result.status === "ok" && result.value.allTimePeak !== undefined, attemptedAt, cache.freshness?.allTimePeak),
      },
    }));
  }

  private async saveSpy(game: Game, result: ProviderResult<SteamSpyData>, attemptedAt: number): Promise<void> {
    await this.updateMetadata(game.appid, (cache) => ({
      ...cache,
      ...(cache.allTimePeak === undefined && result.status === "ok" && result.value.peak > 0
        ? { allTimePeak: result.value.peak }
        : {}),
      ...(cache.allTimePeak === undefined
        ? { freshness: { ...cache.freshness, allTimePeak: this.metricFreshness("steamspy", result, result.status === "ok" && result.value.peak > 0, attemptedAt, cache.freshness?.allTimePeak) } }
        : {}),
    }));
  }

  private async saveTwitch(game: Game, result: ProviderResult<number>, attemptedAt: number): Promise<void> {
    await this.updateMetadata(game.appid, (cache) => {
      const { twitchViewers: _viewers, ...withoutViewers } = cache;
      return {
        ...(result.status === "unavailable" ? withoutViewers : cache),
        ...(result.status === "ok" ? { twitchViewers: result.value } : {}),
        freshness: { ...cache.freshness, twitchViewers: this.freshness("twitch", result, attemptedAt, cache.freshness?.twitchViewers) },
      };
    });
  }

  private freshness(source: FieldFreshness["source"], result: ProviderResult<unknown>, attemptedAt: number, previous?: FieldFreshness): FieldFreshness {
    return result.status === "ok"
      ? { source, status: "ok", acquiredAt: attemptedAt, attemptedAt }
      : {
        source: previous?.source ?? source,
        status: result.status,
        ...(previous?.acquiredAt !== undefined ? { acquiredAt: previous.acquiredAt } : {}),
        attemptedAt,
      };
  }

  private metricFreshness(source: FieldFreshness["source"], result: ProviderResult<unknown>, available: boolean, attemptedAt: number, previous?: FieldFreshness): FieldFreshness {
    if (result.status !== "ok") return this.freshness(source, result, attemptedAt, previous);
    return available
      ? this.freshness(source, result, attemptedAt, previous)
      : this.freshness(source, { status: "unavailable" }, attemptedAt, previous);
  }

  private async updateMetadata(
    appid: string,
    update: (cache: CachedData) => CachedData,
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      const followed = await this.dependencies.getGames();
      if (!followed.some((game) => game.appid === appid)) return;
      const cache = await this.dependencies.getCache();
      const previous = cache[appid];
      if (!previous) return;
      await this.dependencies.setCache({ ...cache, [appid]: update(previous) });
    });
  }

  private async enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.writeTail;
    let release: (() => void) | undefined;
    this.writeTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      if (!release) throw new Error("Write release was not initialized");
      release();
    }
  }
}

export function createRefreshCoordinator(): RefreshCoordinator {
  return new RefreshCoordinator({
    getGames,
    getSettings,
    getGameSettings,
    getCache,
    setCache,
    setLastFetchTime,
    setLastFetchAttemptTime,
    fetchCurrentPlayers,
    fetchSteamChartsResult,
    fetchSteamSpyResult,
    fetchTwitchResult,
    refreshHistory,
    saveSnapshot: idbSaveSnapshot,
    getSnapshots: idbGetSnapshots,
    publishLiveResult,
    updateBadge,
    clearBadge: () => chrome.action.setBadgeText({ text: "" }),
    now: Date.now,
  });
}
