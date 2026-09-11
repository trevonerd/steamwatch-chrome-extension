import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageRequest, MessageResponse } from "../src/types/index.js";

type MessageListener = (
  message: MessageRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void,
) => boolean;

type AlarmListener = (alarm: chrome.alarms.Alarm) => void;

const mocks = vi.hoisted(() => ({
  refresh: vi.fn<[], Promise<{ readonly ok: boolean; readonly error?: string }>>(),
  migrate: vi.fn<[], Promise<void>>(),
  getGames: vi.fn(),
  compactSnapshots: vi.fn(),
  addMessageListener: vi.fn<[MessageListener], void>(),
  addAlarmListener: vi.fn<[AlarmListener], void>(),
  addInstalledListener: vi.fn<[(details: chrome.runtime.InstalledDetails) => void], void>(),
  addStartupListener: vi.fn<[() => void], void>(),
  clearAlarm: vi.fn(),
  createAlarm: vi.fn(),
  addStorageListener: vi.fn(),
  getCache: vi.fn(),
  getSettings: vi.fn(),
  refreshBadge: vi.fn(),
}));

vi.mock("../src/background/refreshCoordinator.js", () => ({
  createRefreshCoordinator: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../src/utils/migrate.js", () => ({ migrateToIndexedDB: mocks.migrate }));
vi.mock("../src/utils/storage.js", () => ({
  FETCH_INTERVAL_MINUTES: 5,
  TRACKING_RETENTION_DAYS: 60,
  getGames: mocks.getGames,
  getCache: mocks.getCache,
  getSettings: mocks.getSettings,
}));
vi.mock("../src/background/signals.js", () => ({ refreshBadgeFromCache: mocks.refreshBadge }));
vi.mock("../src/utils/compaction.js", () => ({ compactSnapshots: mocks.compactSnapshots }));

function primeChrome(): void {
  vi.stubGlobal("chrome", {
    runtime: {
      onInstalled: { addListener: mocks.addInstalledListener },
      onStartup: { addListener: mocks.addStartupListener },
      onMessage: { addListener: mocks.addMessageListener },
    },
    alarms: {
      clear: mocks.clearAlarm,
      create: mocks.createAlarm,
      onAlarm: { addListener: mocks.addAlarmListener },
    },
    storage: { onChanged: { addListener: mocks.addStorageListener } },
  });
}

async function loadListeners(): Promise<{ readonly message: MessageListener; readonly alarm: AlarmListener }> {
  vi.resetModules();
  primeChrome();
  await import("../src/background/index.js");
  const message = mocks.addMessageListener.mock.calls[0]?.[0];
  const alarm = mocks.addAlarmListener.mock.calls[0]?.[0];
  if (!message || !alarm) throw new Error("Background listeners were not registered");
  return { message, alarm };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refresh.mockResolvedValue({ ok: true });
  mocks.migrate.mockResolvedValue(undefined);
  mocks.getGames.mockResolvedValue([]);
  mocks.compactSnapshots.mockResolvedValue(undefined);
  mocks.getCache.mockResolvedValue({ "1": { current: 10, fetchedAt: 1 } });
  mocks.getSettings.mockResolvedValue({ badgeFavoriteAppid: "1" });
});

describe("background lifecycle", () => {
  it("retries unavailable history on extension update", async () => {
    await loadListeners();
    const installed = mocks.addInstalledListener.mock.calls[0]?.[0];
    installed?.({ reason: "update" as chrome.runtime.OnInstalledReason, previousVersion: "2.0.1.7" });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith(true));
  });

  it("routes FETCH_NOW through the shared refresh coordinator", async () => {
    const { message } = await loadListeners();
    const response = await new Promise<MessageResponse>((resolve) => {
      expect(message({ type: "FETCH_NOW" }, {}, resolve)).toBe(true);
    });

    expect(response).toEqual({ ok: true });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("returns the coordinator failure without treating it as a successful refresh", async () => {
    mocks.refresh.mockResolvedValue({ ok: false, error: "No current player counts were available." });
    const { message } = await loadListeners();
    const response = await new Promise<MessageResponse>((resolve) => {
      message({ type: "FETCH_NOW" }, {}, resolve);
    });

    expect(response).toEqual({ ok: false, error: "No current player counts were available." });
  });

  it("routes fetch alarms through the same coordinator", async () => {
    const { alarm } = await loadListeners();

    alarm({ name: "sw_fetch", scheduledTime: 1 } as chrome.alarms.Alarm);
    await Promise.resolve();

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes the favorite badge from cache after local storage changes", async () => {
    await loadListeners();
    const listener = mocks.addStorageListener.mock.calls[0]?.[0];
    if (!listener) throw new Error("Background did not register a storage listener");
    listener({ sw_settings: { newValue: {} } }, "local");
    await vi.waitFor(() => expect(mocks.refreshBadge).toHaveBeenCalledWith("1", { "1": { current: 10, fetchedAt: 1 } }));
  });

  it("refreshes for a favorite current-freshness cache change", async () => {
    await loadListeners();
    const listener = mocks.addStorageListener.mock.calls[0]?.[0];
    if (!listener) throw new Error("Background did not register a storage listener");
    listener({
      sw_cache: {
        oldValue: { "1": { current: 10, fetchedAt: 1 } },
        newValue: { "1": { current: 10, fetchedAt: 1, freshness: { current: { source: "steam", status: "error", attemptedAt: 2 } } } },
      },
    }, "local");
    await vi.waitFor(() => expect(mocks.refreshBadge).toHaveBeenCalledTimes(1));
  });

  it("does not refresh the badge for an auxiliary-only cache change", async () => {
    await loadListeners();
    const listener = mocks.addStorageListener.mock.calls[0]?.[0];
    if (!listener) throw new Error("Background did not register a storage listener");
    listener({ sw_cache: { oldValue: { "1": { current: 10, fetchedAt: 1, peak24h: 20 } }, newValue: { "1": { current: 10, fetchedAt: 1, peak24h: 30 } } } }, "local");
    await Promise.resolve();
    expect(mocks.refreshBadge).not.toHaveBeenCalled();
  });
});
