import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshHistory } from "../src/background/historyBootstrap.js";
import { _resetDbForTesting, idbClearAllData, idbGetBootstrapStatus, idbGetSnapshots } from "../src/utils/idb-storage.js";
import { buildAvailableGraphWindows, hasEnoughGraphHistory } from "../src/utils/sparkline.js";

// Public SteamCharts response for app 242050, recorded 2026-09-11.
const response: unknown = JSON.parse(readFileSync(new URL("./fixtures/black-flag-history.json", import.meta.url), "utf8"));
const now = Date.UTC(2026, 8, 11, 9, 50);

beforeEach(async () => {
  await idbClearAllData();
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await _resetDbForTesting();
});

describe("Black Flag history recovery", () => {
  it("enables every period after manually recovering a failed import without waiting for backoff", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(refreshHistory("242050")).resolves.toBe(false);
    const failed = await idbGetBootstrapStatus("242050");
    expect(failed?.state).toBe("retry");
    expect(failed?.retryAt).toBeGreaterThan(now);
    const callsAfterFailure = fetch.mock.calls.length;
    fetch.mockImplementation(async () => Response.json(response));
    await expect(refreshHistory("242050")).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(callsAfterFailure);

    await expect(refreshHistory("242050", true)).resolves.toBe(true);

    const snapshots = await idbGetSnapshots("242050");
    expect(snapshots.filter((snapshot) => snapshot.granularity === "hourly").length).toBeGreaterThanOrEqual(700);
    for (const window of buildAvailableGraphWindows(60)) {
      expect(hasEnoughGraphHistory(snapshots, window.windowMs), window.key).toBe(true);
    }
    expect((await idbGetBootstrapStatus("242050"))?.state).toBe("completed");
    const callsAfterSuccess = fetch.mock.calls.length;
    await expect(refreshHistory("242050", true)).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(callsAfterSuccess);
  });
});
