import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pctAt: vi.fn<(at: number) => number | null>(),
  changes: vi.fn<() => unknown[]>(),
  news: vi.fn<() => Promise<unknown[]>>(),
}));
vi.mock("../src/utils/seasonal.js", async () => ({
  ...(await vi.importActual<object>("../src/utils/seasonal.js")),
  analyzeSeasonalTrendFromHourly: (_points: unknown, at: number) => {
    const pct = mocks.pctAt(at);
    return pct === null
      ? { status: "insufficient", coverage: 0, reason: "" }
      : { status: "ready", coverage: 1, reason: "", trend: { pct, delta: pct, level: { key: "STABLE" } } };
  },
  detectPlayerChanges: () => mocks.changes(),
}));
vi.mock("../src/utils/news.js", async () => ({
  ...(await vi.importActual<object>("../src/utils/news.js")),
  getSteamNews: () => mocks.news(),
}));

import { getNotificationState } from "../src/background/notificationState.js";
import { publishLiveResult } from "../src/background/signals.js";
import type { Game, Settings } from "../src/types/index.js";

const game: Game = { appid: "1", name: "Game", image: "image" };
const settings: Settings = {
  notificationsEnabled: true,
  globalThresholdUp: 30,
  globalThresholdDown: -25,
  quietHoursEnabled: false,
  quietStart: "23:00",
  quietEnd: "07:00",
  quietDays: 127,
};
beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ sw_games: [game] });
  mocks.pctAt.mockReturnValue(null);
  mocks.changes.mockReturnValue([]);
  mocks.news.mockResolvedValue([]);
});
async function publish(current: number, at: number): Promise<void> {
  vi.spyOn(Date, "now").mockReturnValue(at);
  await publishLiveResult({
    game,
    current,
    snapshots: [],
    settings,
    gameSettings: { notifyThresholdPlayers: 100 },
    cache: { "1": { current, fetchedAt: at } },
  });
}
describe("notification delivery", () => {
  it("suppresses an isolated weekly spike and clears an obsolete pending trend alert", async () => {
    await chrome.storage.local.set({
      sw_notification_state_1: {
        trendUp: {
          fingerprint: "trendUp:weekly-v2:30",
          lastValue: 40,
          lastObservedAt: 1,
          armed: true,
          observations: 3,
          pendingId: "old-event",
        },
      },
    });
    mocks.pctAt.mockReturnValue(42.9);
    await publish(90, 360000);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    expect((await getNotificationState("1")).trendUp?.pendingId).toBeUndefined();
  });

  it("alerts only once the 24h momentum has held above the threshold for three completed hours", async () => {
    const hour = 3_600_000;
    const t0 = 10 * hour;
    // Crossed only in the latest hour: the two earlier hours keep the held value below the threshold.
    mocks.pctAt.mockImplementation((at) => (at >= t0 ? 35 : 0));
    await publish(90, t0);
    await publish(90, t0 + 60_000);
    await publish(90, t0 + 420_000);
    expect(chrome.notifications.create).not.toHaveBeenCalledWith(
      expect.stringContaining("trendUp"),
      expect.any(Object),
    );
    await publish(90, t0 + 2 * hour);
    await publish(90, t0 + 2 * hour + 420_000);
    expect(chrome.notifications.create).toHaveBeenCalledWith(`sw_1_trendUp_${t0 + 2 * hour}`, expect.any(Object));
  });

  it("delivers a held 24h loss with an explicit comparison period", async () => {
    mocks.pctAt.mockReturnValue(0);
    await publish(90, 0);
    mocks.pctAt.mockReturnValue(-30);
    await publish(90, 60000);
    await publish(90, 360000);
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      "sw_1_trendDown_60000",
      expect.objectContaining({ message: expect.stringContaining("last 24 hours vs the same hours a week earlier") }),
    );
  });

  it("announces a sudden change once, with the official news published before it", async () => {
    const now = 100 * 3_600_000;
    const startTs = now - 6 * 3_600_000;
    mocks.changes.mockReturnValue([
      { startTs, lastTs: now - 3_600_000, direction: "drop", pct: -45, hours: 6, ongoing: true },
    ]);
    mocks.news.mockResolvedValue([
      { title: "Patch 1.4: mode removed", url: "https://example.test/n", date: startTs - 3_600_000 },
    ]);
    await publish(90, now);
    await publish(90, now + 60_000);
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      `sw_1_change_${startTs}`,
      expect.objectContaining({
        title: "Game — Sudden drop",
        message: expect.stringContaining("Latest news: Patch 1.4: mode removed"),
      }),
    );
  });

  it("primes then delivers one sustained above crossing", async () => {
    await publish(90, 0);
    await publish(100, 60_000);
    await publish(110, 360_000);
    expect(chrome.notifications.create).toHaveBeenCalledWith("sw_1_above_60000", expect.any(Object));
  });
  it("keeps pending state after failed delivery and retries same ID", async () => {
    vi.mocked(chrome.notifications.create).mockRejectedValueOnce(new Error("offline"));
    await publish(90, 0);
    await publish(100, 60_000);
    await publish(110, 360_000);
    await publish(120, 420_000);
    expect(chrome.notifications.create).toHaveBeenNthCalledWith(2, "sw_1_above_60000", expect.any(Object));
  });
  it("keeps quiet-hour pending delivery until quiet hours end", async () => {
    const quiet = { ...settings, quietHoursEnabled: true, quietStart: "00:00", quietEnd: "23:59" };
    const run = async (current: number, at: number, active: Settings) => {
      vi.spyOn(Date, "now").mockReturnValue(at);
      await publishLiveResult({
        game,
        current,
        snapshots: [],
        settings: active,
        gameSettings: { notifyThresholdPlayers: 100 },
        cache: { "1": { current, fetchedAt: at } },
      });
    };
    await run(90, 0, quiet);
    await run(100, 60_000, quiet);
    await run(110, 360_000, quiet);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    await run(120, 420_000, settings);
    expect(chrome.notifications.create).toHaveBeenCalledWith("sw_1_above_60000", expect.any(Object));
  });
  it("serializes duplicate concurrent publication into one native delivery", async () => {
    await publish(90, 0);
    await publish(100, 60_000);
    await Promise.all([publish(110, 360_000), publish(110, 360_000)]);
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });
  it("does not deliver for removed games", async () => {
    await publish(90, 0);
    await chrome.storage.local.set({ sw_games: [] });
    await publish(110, 360_000);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });
  it("delivers a sustained below-zero crossing", async () => {
    const run = async (current: number, at: number) => {
      vi.spyOn(Date, "now").mockReturnValue(at);
      await publishLiveResult({
        game,
        current,
        snapshots: [],
        settings,
        gameSettings: { notifyBelowPlayers: 0 },
        cache: { "1": { current, fetchedAt: at } },
      });
    };
    await run(2, 0);
    await run(0, 60_000);
    await run(0, 360_000);
    expect(chrome.notifications.create).toHaveBeenCalledWith("sw_1_below_60000", expect.any(Object));
  });
});
