import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Game, Settings, Snapshot } from "../src/types/index.js";

type PriceResult =
  | { kind: "free" }
  | { kind: "error"; reason: string }
  | {
      kind: "priced";
      data: {
        priceOriginal: number;
        priceCurrent: number;
        discountPct: number;
        currentFormatted: string;
        originalFormatted: string;
      };
    };

const mocks = vi.hoisted(() => ({
  fetchCurrentPlayers: vi.fn(),
  fetchSteamChartsBootstrap: vi.fn(),
  fetchSteamChartsData: vi.fn(),
  fetchSteamSpyData: vi.fn(),
  fetchTwitchViewers: vi.fn(),
  fetchPriceData: vi.fn(),
  getGames: vi.fn(),
  getSettings: vi.fn(),
  getGameSettings: vi.fn(),
  setCache: vi.fn(),
  getCache: vi.fn(),
  setLastFetchTime: vi.fn(),
  getEffectiveRegion: vi.fn(),
  idbBulkSaveSnapshots: vi.fn(),
  idbSaveSnapshot: vi.fn(),
  idbGetSnapshots: vi.fn(),
  idbSaveItadMapping: vi.fn(),
  idbGetItadMapping: vi.fn(),
  idbGetCooldown: vi.fn(),
  idbSetCooldown: vi.fn(),
  migrateToIndexedDB: vi.fn(),
  computeTrend: vi.fn(),
  detectSpike: vi.fn(),
  fmtNumber: vi.fn(),
  fmtBadge: vi.fn(),
  lookupItadGame: vi.fn(),
  fetchHistoricalLow: vi.fn(),
}));

vi.mock("../src/utils/api.js", () => ({
  fetchCurrentPlayers: mocks.fetchCurrentPlayers,
  fetchSteamChartsBootstrap: mocks.fetchSteamChartsBootstrap,
  fetchSteamChartsData: mocks.fetchSteamChartsData,
  fetchSteamSpyData: mocks.fetchSteamSpyData,
  fetchTwitchViewers: mocks.fetchTwitchViewers,
  fetchPriceData: mocks.fetchPriceData,
}));

vi.mock("../src/utils/storage.js", () => ({
  getGames: mocks.getGames,
  getSettings: mocks.getSettings,
  getGameSettings: mocks.getGameSettings,
  setCache: mocks.setCache,
  getCache: mocks.getCache,
  setLastFetchTime: mocks.setLastFetchTime,
  getEffectiveRegion: mocks.getEffectiveRegion,
}));

vi.mock("../src/utils/idb-storage.js", () => ({
  idbBulkSaveSnapshots: mocks.idbBulkSaveSnapshots,
  idbSaveSnapshot: mocks.idbSaveSnapshot,
  idbGetSnapshots: mocks.idbGetSnapshots,
  idbSaveItadMapping: mocks.idbSaveItadMapping,
  idbGetItadMapping: mocks.idbGetItadMapping,
  idbGetCooldown: mocks.idbGetCooldown,
  idbSetCooldown: mocks.idbSetCooldown,
}));

vi.mock("../src/utils/migrate.js", () => ({
  migrateToIndexedDB: mocks.migrateToIndexedDB,
}));

vi.mock("../src/utils/trend.js", () => ({
  computeTrend: mocks.computeTrend,
  detectSpike: mocks.detectSpike,
  fmtNumber: mocks.fmtNumber,
  fmtBadge: mocks.fmtBadge,
}));

vi.mock("../src/utils/itad-api.js", () => ({
  lookupItadGame: mocks.lookupItadGame,
  fetchHistoricalLow: mocks.fetchHistoricalLow,
}));

const game: Game = {
  appid: "123",
  name: "Half-Life",
  image: "https://cdn.example.com/123.jpg",
};

const settings: Settings = {
  trendEnabled: true,
  purgeAfterDays: 7,
  notificationsEnabled: false,
  spikeDetection: false,
  globalThresholdUp: 30,
  globalThresholdDown: -25,
  crashThreshold: -50,
  fetchIntervalMinutes: 15,
  quietHoursEnabled: false,
  quietStart: "23:00",
  quietEnd: "07:00",
  quietDays: 0b1111111,
  rankByPlayers: true,
  priceAlertsEnabled: false,
  priceDropMinPct: 30,
  regionCode: "US",
};

function primeChromeMocks(): void {
  const chromeMock = globalThis.chrome as any;
  chromeMock.runtime.onInstalled = { addListener: vi.fn() };
  chromeMock.runtime.onStartup = { addListener: vi.fn() };
  chromeMock.runtime.onMessage = { addListener: vi.fn() };
  chromeMock.alarms.onAlarm = { addListener: vi.fn() };
  chromeMock.action = {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    setBadgeTextColor: vi.fn(),
  };
}

async function loadFetchNowListener(): Promise<(
  message: { type: "FETCH_NOW" },
  sender: unknown,
  sendResponse: (response: { ok: boolean; error?: string }) => void,
) => boolean> {
  vi.resetModules();
  primeChromeMocks();
  await import("../src/background/index.js");
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]?.[0];
  expect(listener).toBeTypeOf("function");
  return listener as (
    message: { type: "FETCH_NOW" },
    sender: unknown,
    sendResponse: (response: { ok: boolean; error?: string }) => void,
  ) => boolean;
}

async function triggerFetchNow(): Promise<{ ok: boolean; error?: string }> {
  const listener = await loadFetchNowListener();
  return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const keepOpen = listener({ type: "FETCH_NOW" }, {}, (response) => resolve(response));
    expect(keepOpen).toBe(true);
  });
}

beforeEach(() => {
  primeChromeMocks();

  mocks.fetchCurrentPlayers.mockResolvedValue(100);
  mocks.fetchSteamChartsBootstrap.mockResolvedValue([]);
  mocks.fetchSteamChartsData.mockResolvedValue({ current: 100, peak24h: 120, allTimePeak: 250 });
  mocks.fetchSteamSpyData.mockResolvedValue({ peak: 200, name: game.name });
  mocks.fetchTwitchViewers.mockResolvedValue(null);
  mocks.fetchPriceData.mockResolvedValue({ kind: "free" });
  mocks.getGames.mockResolvedValue([game]);
  mocks.getSettings.mockResolvedValue(settings);
  mocks.getGameSettings.mockResolvedValue({});
  mocks.setCache.mockResolvedValue(undefined);
  mocks.getCache.mockResolvedValue({});
  mocks.setLastFetchTime.mockResolvedValue(undefined);
  mocks.getEffectiveRegion.mockReturnValue("US");
  mocks.idbBulkSaveSnapshots.mockResolvedValue(undefined);
  mocks.idbSaveSnapshot.mockResolvedValue(undefined);
  mocks.idbGetSnapshots.mockResolvedValue([{ ts: 1, current: 90 }, { ts: 2, current: 100 }]);
  mocks.idbSaveItadMapping.mockResolvedValue(undefined);
  mocks.idbGetItadMapping.mockResolvedValue(null);
  mocks.idbGetCooldown.mockResolvedValue(null);
  mocks.idbSetCooldown.mockResolvedValue(undefined);
  mocks.migrateToIndexedDB.mockResolvedValue(undefined);
  mocks.computeTrend.mockReturnValue(null);
  mocks.detectSpike.mockReturnValue(null);
  mocks.fmtNumber.mockImplementation((n: number) => String(n));
  mocks.fmtBadge.mockImplementation((n: number) => String(n));
  mocks.lookupItadGame.mockResolvedValue(null);
  mocks.fetchHistoricalLow.mockResolvedValue(new Map());
});

describe("background bootstrap integration", () => {
  it("runs bootstrap on first fetchGame call and sets sentinel before fetch", async () => {
    const order: string[] = [];
    const bootstrapSnaps: Snapshot[] = [{ ts: 10, current: 50 }];

    mocks.idbSetCooldown.mockImplementation(async () => {
      order.push("setCooldown");
    });
    mocks.fetchSteamChartsBootstrap.mockImplementation(async () => {
      order.push("bootstrap");
      return bootstrapSnaps;
    });

    await expect(triggerFetchNow()).resolves.toEqual({ ok: true });

    expect(mocks.idbGetCooldown).toHaveBeenCalledWith("bootstrap__123");
    expect(mocks.idbSetCooldown).toHaveBeenCalledTimes(1);
    expect(mocks.fetchSteamChartsBootstrap).toHaveBeenCalledWith("123");
    expect(mocks.idbBulkSaveSnapshots).toHaveBeenCalledWith("123", bootstrapSnaps);
    expect(order).toEqual(["setCooldown", "bootstrap"]);
  });

  it("skips bootstrap when cooldown already exists", async () => {
    mocks.idbGetCooldown.mockResolvedValue(Date.now() + 60_000);

    await expect(triggerFetchNow()).resolves.toEqual({ ok: true });

    expect(mocks.fetchSteamChartsBootstrap).not.toHaveBeenCalled();
    expect(mocks.idbBulkSaveSnapshots).not.toHaveBeenCalled();
    expect(mocks.idbSetCooldown).not.toHaveBeenCalled();
  });

  it("does not block live snapshot save when bootstrap fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.fetchSteamChartsBootstrap.mockRejectedValue(new Error("boom"));

    await expect(triggerFetchNow()).resolves.toEqual({ ok: true });

    expect(mocks.idbSaveSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.idbSaveSnapshot).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ current: 100 }),
    );

    warn.mockRestore();
  });

  it("does not bulk save when bootstrap returns no snapshots", async () => {
    mocks.fetchSteamChartsBootstrap.mockResolvedValue([]);

    await expect(triggerFetchNow()).resolves.toEqual({ ok: true });

    expect(mocks.fetchSteamChartsBootstrap).toHaveBeenCalledWith("123");
    expect(mocks.idbBulkSaveSnapshots).not.toHaveBeenCalled();
  });
});
