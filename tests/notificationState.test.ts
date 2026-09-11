import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteNotificationState, getNotificationState, setNotificationState } from "../src/background/notificationState.js";

const above = { fingerprint: "above:100", lastValue: 100, lastObservedAt: 1_000, armed: true, observations: 1 };
beforeEach(async () => { await chrome.storage.local.clear(); });
describe("notification state", () => {
  it("survives a worker-style reread", async () => { await setNotificationState("1", { above }); await expect(getNotificationState("1")).resolves.toEqual({ above }); });
  it("deletes state when a game is removed", async () => { await setNotificationState("1", { above }); await deleteNotificationState("1"); await expect(getNotificationState("1")).resolves.toEqual({}); });
  it("retains a durable pending event across a simulated worker restart", async () => {
    const pending = { ...above, crossedAt: 60_000, observations: 2, pendingId: "above_60000" };
    await setNotificationState("1", { above: pending });
    vi.resetModules();
    const restarted = await import("../src/background/notificationState.js");
    await expect(restarted.getNotificationState("1")).resolves.toEqual({ above: pending });
  });
});
