import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ computeTrend: vi.fn() }));
vi.mock("../src/utils/trend.js", async () => ({ ...(await vi.importActual<object>("../src/utils/trend.js")), computeTrend: mocks.computeTrend }));
import { publishLiveResult } from "../src/background/signals.js";
import { getNotificationState } from "../src/background/notificationState.js";
import type { Game, Settings } from "../src/types/index.js";
const game: Game = { appid: "1", name: "Game", image: "image" };
const settings: Settings = { notificationsEnabled: true, globalThresholdUp: 30, globalThresholdDown: -25, quietHoursEnabled: false, quietStart: "23:00", quietEnd: "07:00", quietDays: 127 };
beforeEach(async () => { await chrome.storage.local.clear(); await chrome.storage.local.set({ sw_games: [game] }); mocks.computeTrend.mockReturnValue(null); });
async function publish(current: number, at: number): Promise<void> { vi.spyOn(Date, "now").mockReturnValue(at); await publishLiveResult({ game, current, snapshots: [], settings, gameSettings: { notifyThresholdPlayers: 100 }, cache: { "1": { current, fetchedAt: at } } }); }
describe("notification delivery", () => {
  it("suppresses an isolated weekly spike and clears an obsolete pending trend alert", async () => {
    await chrome.storage.local.set({ sw_notification_state_1: { trendUp: { fingerprint: "trendUp:weekly-v2:30", lastValue: 40, lastObservedAt: 1, armed: true, observations: 3, pendingId: "old-event" } } });
    mocks.computeTrend.mockReturnValue({ pct: 42.9, delta: 100, sustained: false });
    await publish(90, 360000);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    expect((await getNotificationState("1")).trendUp).toBeUndefined();
  });

  it("delivers a sustained weekly loss with an explicit comparison period", async () => {
    mocks.computeTrend.mockReturnValue({ pct: 0, delta: 0, sustained: false });
    await publish(90, 0);
    mocks.computeTrend.mockReturnValue({ pct: -30, delta: -100, sustained: true });
    await publish(90, 60000); await publish(90, 360000);
    expect(chrome.notifications.create).toHaveBeenCalledWith("sw_1_trendDown_60000", expect.objectContaining({ message: expect.stringContaining("last 7 days vs previous 7 days") }));
  });
  it("primes then delivers one sustained above crossing", async () => { await publish(90, 0); await publish(100, 60_000); await publish(110, 360_000); expect(chrome.notifications.create).toHaveBeenCalledWith("sw_1_above_60000", expect.any(Object)); });
  it("keeps pending state after failed delivery and retries same ID", async () => { vi.mocked(chrome.notifications.create).mockRejectedValueOnce(new Error("offline")); await publish(90, 0); await publish(100, 60_000); await publish(110, 360_000); await publish(120, 420_000); expect(chrome.notifications.create).toHaveBeenNthCalledWith(2, "sw_1_above_60000", expect.any(Object)); });
  it("keeps quiet-hour pending delivery until quiet hours end", async () => {
    const quiet = { ...settings, quietHoursEnabled: true, quietStart: "00:00", quietEnd: "23:59" };
    const run = async (current: number, at: number, active: Settings) => { vi.spyOn(Date, "now").mockReturnValue(at); await publishLiveResult({ game, current, snapshots: [], settings: active, gameSettings: { notifyThresholdPlayers: 100 }, cache: { "1": { current, fetchedAt: at } } }); };
    await run(90, 0, quiet); await run(100, 60_000, quiet); await run(110, 360_000, quiet);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    await run(120, 420_000, settings);
    expect(chrome.notifications.create).toHaveBeenCalledWith("sw_1_above_60000", expect.any(Object));
  });
  it("serializes duplicate concurrent publication into one native delivery", async () => {
    await publish(90, 0); await publish(100, 60_000);
    await Promise.all([publish(110, 360_000), publish(110, 360_000)]);
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });
  it("does not deliver for removed games", async () => {
    await publish(90, 0); await chrome.storage.local.set({ sw_games: [] });
    await publish(110, 360_000);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });
  it("delivers a sustained below-zero crossing", async () => {
    const run = async (current: number, at: number) => { vi.spyOn(Date, "now").mockReturnValue(at); await publishLiveResult({ game, current, snapshots: [], settings, gameSettings: { notifyBelowPlayers: 0 }, cache: { "1": { current, fetchedAt: at } } }); };
    await run(2, 0); await run(0, 60_000); await run(0, 360_000);
    expect(chrome.notifications.create).toHaveBeenCalledWith("sw_1_below_60000", expect.any(Object));
  });
});
