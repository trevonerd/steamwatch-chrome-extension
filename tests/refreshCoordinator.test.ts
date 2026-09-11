import { describe, expect, it, vi } from "vitest";

import { RefreshCoordinator } from "../src/background/refreshCoordinator.js";
import type { CachedData, Game, Settings } from "../src/types/index.js";
import type { RefreshCoordinatorDependencies } from "../src/background/refreshCoordinator.js";

const game: Game = { appid: "1", name: "Test Game", image: "https://example.test/1.jpg" };
const settings: Settings = {
  notificationsEnabled: false,
  globalThresholdUp: 30,
  globalThresholdDown: -25,
  quietHoursEnabled: false,
  quietStart: "23:00",
  quietEnd: "07:00",
  quietDays: 0b1111111,
};

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error("Deferred was not initialized");
      resolvePromise(value);
    },
  };
}

function makeDependencies(overrides: Partial<RefreshCoordinatorDependencies> = {}): RefreshCoordinatorDependencies {
  return {
    getGames: vi.fn<[], Promise<Game[]>>().mockResolvedValue([game]),
    getSettings: vi.fn<[], Promise<Settings>>().mockResolvedValue(settings),
    getGameSettings: vi.fn<[string], Promise<{}>>().mockResolvedValue({}),
    getCache: vi.fn<[], Promise<Record<string, CachedData>>>().mockResolvedValue({}),
    setCache: vi.fn<[Record<string, CachedData>], Promise<void>>().mockResolvedValue(undefined),
    setLastFetchTime: vi.fn<[number], Promise<void>>().mockResolvedValue(undefined),
    setLastFetchAttemptTime: vi.fn<[number], Promise<void>>().mockResolvedValue(undefined),
    fetchCurrentPlayers: vi.fn<[string], Promise<number | null>>().mockResolvedValue(100),
    fetchSteamChartsResult: vi.fn().mockResolvedValue({ status: "unavailable" }),
    fetchSteamSpyResult: vi.fn().mockResolvedValue({ status: "unavailable" }),
    fetchTwitchResult: vi.fn().mockResolvedValue({ status: "unavailable" }),
    refreshHistory: vi.fn<[string], Promise<boolean>>().mockResolvedValue(false),
    saveSnapshot: vi.fn<[string, import("../src/types/index.js").Snapshot], Promise<void>>().mockResolvedValue(undefined),
    getSnapshots: vi.fn().mockResolvedValue([]),
    publishLiveResult: vi.fn<[Parameters<RefreshCoordinatorDependencies["publishLiveResult"]>[0]], Promise<"stable">>().mockResolvedValue("stable"),
    updateBadge: vi.fn(),
    clearBadge: vi.fn(),
    now: vi.fn<[], number>().mockReturnValue(1_000),
    ...overrides,
  };
}

describe("RefreshCoordinator", () => {
  it("retries failed history on explicit refresh even when live data is already being fetched", async () => {
    const current = deferred<number | null>();
    const dependencies = makeDependencies({ fetchCurrentPlayers: vi.fn().mockReturnValue(current.promise) });
    const coordinator = new RefreshCoordinator(dependencies);
    const first = coordinator.refresh();
    await vi.waitFor(() => expect(dependencies.refreshHistory).toHaveBeenCalledTimes(1));
    await coordinator.auxiliaryIdle();
    const second = coordinator.refresh(true);
    await vi.waitFor(() => expect(dependencies.refreshHistory).toHaveBeenCalledWith("1", true));
    expect(second).toBe(first);
    current.resolve(100);
    await second;
    expect(dependencies.fetchCurrentPlayers).toHaveBeenCalledTimes(1);
  });
  it("shares one live cycle between concurrent callers", async () => {
    const current = deferred<number | null>();
    const dependencies = makeDependencies({ fetchCurrentPlayers: vi.fn().mockReturnValue(current.promise) });
    const coordinator = new RefreshCoordinator(dependencies);

    const first = coordinator.refresh();
    const second = coordinator.refresh();

    expect(first).toBe(second);
    current.resolve(100);
    await expect(first).resolves.toEqual({ ok: true });
    expect(dependencies.fetchCurrentPlayers).toHaveBeenCalledTimes(1);
  });

  it("publishes healthy games when another game's current source throws", async () => {
    const secondGame: Game = { appid: "2", name: "Second Game", image: "https://example.test/2.jpg" };
    const dependencies = makeDependencies({
      getGames: vi.fn().mockResolvedValue([game, secondGame]),
      fetchCurrentPlayers: vi.fn().mockImplementation(async (appid: string) => {
        if (appid === "1") throw new Error("transport failed");
        return 200;
      }),
    });
    const coordinator = new RefreshCoordinator(dependencies);

    await expect(coordinator.refresh()).resolves.toEqual({ ok: true });

    expect(dependencies.saveSnapshot).toHaveBeenCalledWith("2", expect.objectContaining({ current: 200 }));
    expect(dependencies.setLastFetchTime).toHaveBeenCalledWith(1_000);
  });

  it("uses the latest favorite cache when a slower game signal finishes after a newer game", async () => {
    const secondGame: Game = { appid: "2", name: "Second Game", image: "https://example.test/2.jpg" };
    const slowSignal = deferred<"stable">();
    const firstBadge = deferred<void>();
    let cache: Record<string, CachedData> = {};
    const updateBadge = vi.fn((
      _rising: number,
      _alerting: number,
      _favorite: string | undefined,
      latestCache: Record<string, CachedData>,
    ) => {
      if (updateBadge.mock.calls.length === 1) firstBadge.resolve(undefined);
      return latestCache;
    });
    const dependencies = makeDependencies({
      getGames: vi.fn().mockResolvedValue([game, secondGame]),
      getSettings: vi.fn().mockResolvedValue({ ...settings, badgeFavoriteAppid: "2" }),
      getCache: vi.fn().mockImplementation(async () => cache),
      setCache: vi.fn().mockImplementation(async (next: Record<string, CachedData>) => { cache = next; }),
      fetchCurrentPlayers: vi.fn().mockImplementation(async (appid: string) => appid === "1" ? 100 : 200),
      publishLiveResult: vi.fn().mockImplementation(async (input: { readonly game: Game }) => input.game.appid === "1" ? slowSignal.promise : "stable"),
      updateBadge,
    });
    const coordinator = new RefreshCoordinator(dependencies);

    const cycle = coordinator.refresh();
    await firstBadge.promise;
    slowSignal.resolve("stable");
    await cycle;

    const latestBadgeCache = updateBadge.mock.calls.at(-1)?.[3];
    expect(latestBadgeCache?.["2"]?.current).toBe(200);
    expect(updateBadge.mock.calls.at(-1)?.[2]).toBe("2");
  });

  it("returns failure and only records an attempt when every current provider fails", async () => {
    const dependencies = makeDependencies({ fetchCurrentPlayers: vi.fn().mockResolvedValue(null) });
    const coordinator = new RefreshCoordinator(dependencies);

    await expect(coordinator.refresh()).resolves.toEqual({ ok: false, error: "No current player counts were available." });

    expect(dependencies.setLastFetchAttemptTime).toHaveBeenCalledWith(1_000);
    expect(dependencies.setLastFetchTime).not.toHaveBeenCalled();
    expect(dependencies.saveSnapshot).not.toHaveBeenCalled();
    await coordinator.auxiliaryIdle();
    expect(dependencies.fetchSteamChartsResult).toHaveBeenCalledWith("1");
  });

  it("records a failed current attempt without replacing its retained acquisition time", async () => {
    let cache: Record<string, CachedData> = {
      "1": {
        current: 50,
        fetchedAt: 400,
        freshness: { current: { source: "steam", status: "ok", acquiredAt: 400, attemptedAt: 400 } },
      },
    };
    const dependencies = makeDependencies({
      fetchCurrentPlayers: vi.fn().mockResolvedValue(null),
      getCache: vi.fn().mockImplementation(async () => cache),
      setCache: vi.fn().mockImplementation(async (next: Record<string, CachedData>) => { cache = next; }),
    });
    const coordinator = new RefreshCoordinator(dependencies);

    await coordinator.refresh();

    expect(cache["1"]?.fetchedAt).toBe(400);
    expect(cache["1"]?.freshness?.current).toEqual({ source: "steam", status: "error", acquiredAt: 400, attemptedAt: 1_000 });
  });

  it("publishes current data without waiting for hung auxiliary sources", async () => {
    const charts = deferred<{ readonly status: "unavailable" }>();
    const dependencies = makeDependencies({ fetchSteamChartsResult: vi.fn().mockReturnValue(charts.promise) });
    const coordinator = new RefreshCoordinator(dependencies);

    await expect(coordinator.refresh()).resolves.toEqual({ ok: true });

    expect(dependencies.saveSnapshot).toHaveBeenCalledWith("1", expect.objectContaining({ current: 100 }));
    expect(dependencies.setCache).toHaveBeenCalled();
    charts.resolve({ status: "unavailable" });
    await coordinator.auxiliaryIdle();
  });

  it("does not write a current sample after its game is removed", async () => {
    const dependencies = makeDependencies({
      getGames: vi.fn<[], Promise<Game[]>>().mockResolvedValueOnce([game]).mockResolvedValue([]),
    });
    const coordinator = new RefreshCoordinator(dependencies);

    await expect(coordinator.refresh()).resolves.toEqual({ ok: false, error: "No current player counts were available." });

    expect(dependencies.saveSnapshot).not.toHaveBeenCalled();
    expect(dependencies.setCache).not.toHaveBeenCalled();
  });

  it("uses negative metadata freshness to defer unavailable provider retries", async () => {
    const cache: CachedData = {
      current: 50,
      fetchedAt: 1,
      freshness: {
        peak24h: { source: "steamcharts", status: "unavailable", attemptedAt: 900 },
      },
    };
    const dependencies = makeDependencies({ getCache: vi.fn().mockResolvedValue({ "1": cache }) });
    const coordinator = new RefreshCoordinator(dependencies);

    await coordinator.refresh();
    await coordinator.auxiliaryIdle();

    expect(dependencies.fetchSteamChartsResult).not.toHaveBeenCalled();
  });

  it("keeps the prior acquisition age for a missing field in a partial metadata result", async () => {
    let cache: Record<string, CachedData> = {
      "1": {
        current: 50,
        peak24h: 80,
        allTimePeak: 150,
        fetchedAt: 400,
        freshness: {
          peak24h: { source: "steamcharts", status: "ok", acquiredAt: 400, attemptedAt: 0 },
          allTimePeak: { source: "steamcharts", status: "ok", acquiredAt: 400, attemptedAt: 0 },
        },
      },
    };
    const dependencies = makeDependencies({
      getCache: vi.fn().mockImplementation(async () => cache),
      setCache: vi.fn().mockImplementation(async (next: Record<string, CachedData>) => { cache = next; }),
      fetchSteamChartsResult: vi.fn().mockResolvedValue({ status: "ok", value: { peak24h: 90 } }),
      now: vi.fn().mockReturnValue(4_000_000),
    });
    const coordinator = new RefreshCoordinator(dependencies);

    await coordinator.refresh();
    await coordinator.auxiliaryIdle();

    expect(cache["1"]?.peak24h).toBe(90);
    expect(cache["1"]?.freshness?.allTimePeak).toEqual({ source: "steamcharts", status: "unavailable", acquiredAt: 400, attemptedAt: 4_000_000 });
  });

  it("persists zero as a successful current sample", async () => {
    const dependencies = makeDependencies({ fetchCurrentPlayers: vi.fn().mockResolvedValue(0) });
    const coordinator = new RefreshCoordinator(dependencies);

    await expect(coordinator.refresh()).resolves.toEqual({ ok: true });

    expect(dependencies.saveSnapshot).toHaveBeenCalledWith("1", expect.objectContaining({ current: 0 }));
    expect(dependencies.setLastFetchTime).toHaveBeenCalledWith(1_000);
  });
});
