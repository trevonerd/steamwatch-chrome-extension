import { readFileSync } from "node:fs";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartDataSchema, fetchSteamChartsHistoryResult } from "../src/utils/api.js";
import { buildCardViewModel } from "../src/utils/card.js";
import { buildGraphSeries } from "../src/utils/sparkline.js";
import { analyzeSeasonalTrend } from "../src/utils/seasonal.js";

const samples = z.array(z.object({
  appid: z.string(), name: z.string(), current: z.number(), acquiredAt: z.number(), source: z.string().url(), history: ChartDataSchema,
})).parse(JSON.parse(readFileSync("tests/fixtures/provider-sample-2026-09-11.json", "utf8")));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("recorded real provider sample", () => {
  it.each(samples)("reconciles API, history and periods for $name", async (sample) => {
    vi.useFakeTimers();
    vi.setSystemTime(sample.acquiredAt);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(sample.history))));
    const history = await fetchSteamChartsHistoryResult(sample.appid);
    expect(fetch).toHaveBeenCalledWith(sample.source, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    if (sample.appid === "3751950") {
      expect(history.status).toBe("unavailable");
      return;
    }
    expect(history.status).toBe("ok");
    if (history.status !== "ok") throw new Error(`Expected recorded history for ${sample.appid}`);
    const vm = buildCardViewModel({ appid: sample.appid, name: sample.name, image: "" }, {
      [sample.appid]: { current: sample.current, fetchedAt: sample.acquiredAt },
    }, history.value, 60, sample.acquiredAt);
    expect(vm.current).toBe(sample.current);
    expect(vm.availableGraphWindows.map((window) => window.key)).toEqual(["24h", "3d", "7d", "15d", "1m", "all"]);
    expect(vm.avg24h).toBeGreaterThan(0);
    expect(vm.seasonalAnalysis?.status).toBe("ready");
    expect(vm.retentionAvg).toBeUndefined(); // 30 hourly days do not establish a 60-day average.
    const graph = buildGraphSeries(vm.snaps, 7 * 86_400_000, sample.acquiredAt, 372, 56, 200);
    expect(graph.segments.flatMap((segment) => segment.points).length).toBeLessThanOrEqual(200);
    expect(graph.coverage).toBeGreaterThanOrEqual(0.8);
    expect(analyzeSeasonalTrend(history.value, sample.acquiredAt + 3 * 3_600_000).status).toBe("stale");
    const earlier = sample.acquiredAt - 2 * 86_400_000;
    expect(analyzeSeasonalTrend(history.value, earlier)).toEqual(analyzeSeasonalTrend(history.value.filter((point) => point.ts <= earlier), earlier));
  });

  it.each(samples.filter((sample) => sample.appid === "440" || sample.appid === "289070"))(
    "keeps $name stable across 48 hourly replay positions despite the daily range", async (sample) => {
      vi.useFakeTimers();
      vi.setSystemTime(sample.acquiredAt);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(sample.history))));
      const history = await fetchSteamChartsHistoryResult(sample.appid);
      if (history.status !== "ok") throw new Error("Expected recorded hourly history");
      const day = history.value.filter((point) => point.granularity === "hourly" && point.ts >= sample.acquiredAt - 86_400_000).map((point) => point.current);
      expect(Math.max(...day) / Math.min(...day)).toBeGreaterThan(1.3);
      for (let hour = 0; hour < 48; hour++) {
        const result = analyzeSeasonalTrend(history.value, sample.acquiredAt - hour * 3_600_000);
        expect(result.status).toBe("ready");
        if (result.status === "ready") expect(result.trend.level.key).toBe("STABLE");
      }
    },
  );

  it("contains distinct real histories instead of a reused graph fixture", () => {
    const profiles = samples.filter((sample) => sample.history.length > 0).map((sample) => JSON.stringify(sample.history.slice(-168)));
    expect(new Set(profiles).size).toBe(9);
  });
});
