import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GamesPopularityHistorySchema } from "../src/types/index.js";
import { refreshHistory } from "../src/background/historyBootstrap.js";
import { _resetDbForTesting, idbClearAllData, idbGetBootstrapStatus, idbGetSnapshots } from "../src/utils/idb-storage.js";
import { buildCardViewModel } from "../src/utils/card.js";

const pages = z.array(GamesPopularityHistorySchema).parse(JSON.parse(readFileSync("tests/fixtures/resynced-games-popularity.json", "utf8")));
const now = Date.UTC(2026, 8, 11, 10, 40);
beforeEach(async () => { await idbClearAllData(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await _resetDbForTesting(); });

describe("Resynced actual fallback history", () => {
  it("imports real paginated observations and populates all periods and seasonal analysis", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("steamcharts.com")) return Response.json([]);
      return Response.json(pages[url.includes("cursor=") ? 1 : 0]);
    }));
    await expect(refreshHistory("3751950", true)).resolves.toBe(true);
    expect((await idbGetBootstrapStatus("3751950"))?.state).toBe("completed");
    const snaps = await idbGetSnapshots("3751950");
    expect(snaps.length).toBeGreaterThan(1300);
    expect(snaps.every((s) => s.source === "games-popularity")).toBe(true);
    const vm = buildCardViewModel({ appid: "3751950", name: "Black Flag Resynced", image: "" }, {}, snaps, 60, now);
    expect(vm.availableGraphWindows.map((w) => w.key)).toEqual(["24h", "3d", "7d", "15d", "1m", "all"]);
    expect(vm.avg24h).toBeGreaterThan(0);
    expect(vm.seasonalAnalysis?.status).toBe("ready");
    expect(vm.trend?.pct).toBe(-20.6);
    if (vm.seasonalAnalysis?.status === "ready") {
      expect(vm.seasonalAnalysis.comparison?.recentMean).toBeCloseTo(3786.6687, 3);
      expect(vm.seasonalAnalysis.comparison?.baselineMean).toBeCloseTo(4769.8675, 3);
      expect(vm.seasonalAnalysis.comparison?.matchedHours).toBe(166);
    }
    expect(vm.allTimePeak).toBeNull();
  });
});
