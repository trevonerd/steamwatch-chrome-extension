import { describe, expect, it } from "vitest";
import { buildEarlyActivity } from "../src/utils/earlyActivity.js";
import { normalizeHourly } from "../src/utils/series.js";
import type { Snapshot } from "../src/types/index.js";
import { buildCardViewModel } from "../src/utils/card.js";

const now = Date.UTC(2026, 8, 11, 12);
const hour = 3_600_000;
const history = (hours: number, value: (i: number) => number): Snapshot[] => Array.from({ length: hours }, (_, i) => ({
  ts: now - (hours - i) * hour, current: value(i), source: "steamcharts", granularity: "hourly",
}));
const analyze = (snapshots: Snapshot[]) => buildEarlyActivity(snapshots, normalizeHourly(snapshots, now), now);

describe("early activity", () => {
  it("keeps preliminary launch comparisons outside the weekly signal", () => {
    const vm = buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, history(48, (i) => i < 24 ? 100 : 1000), 60, now);
    expect(vm.earlyActivity).toMatchObject({ status: "preliminary", comparison: { pct: 900 } });
    expect(vm.trend).toBeNull();
    expect(vm.displayTrendPct).toBeNull();
    expect(vm.trendCls).toBe("stable");
  });

  it("switches to the weekly model only when enough history is available", () => {
    const vm = buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, history(14 * 24, () => 100), 60, now);
    expect(vm.trend?.pct).toBe(0);
    expect(vm.earlyActivity).toBeUndefined();
  });
  it("provides progress without inventing a percentage for the first observation", () => {
    expect(analyze([{ ts: now, current: 100, source: "steam", granularity: "instant" }]))
      .toMatchObject({ status: "collecting", observations: 1, minimum: 100, maximum: 100 });
    expect(analyze([]).comparison).toBeUndefined();
  });
  it("shows the observed range rather than a launch-to-night decline", () => {
    expect(analyze(history(12, (i) => 1000 - i * 50))).toMatchObject({ status: "collecting", minimum: 450, maximum: 1000 });
  });
  it("compares matched hours of complete days without confusing nights with losses", () => {
    const result = analyze(history(48, (i) => i % 24 < 12 ? 100 : 400));
    expect(result).toMatchObject({ status: "preliminary", comparison: { pct: 0, recentMean: 250, baselineMean: 250, matchedHours: 24 } });
  });
  it("labels a genuine day-to-day change as preliminary", () => {
    expect(analyze(history(48, (i) => i < 24 ? 100 : 80)))
      .toMatchObject({ status: "preliminary", comparison: { pct: -20, delta: -20 } });
  });
  it("does not divide by tiny or zero baselines", () => {
    expect(analyze(history(48, (i) => i < 24 ? 0 : 5)))
      .toMatchObject({ status: "preliminary", comparison: { pct: null, delta: 5 } });
  });
  it("preserves a real fall to zero", () => {
    expect(analyze(history(48, (i) => i < 24 ? 100 : 0))).toMatchObject({ comparison: { pct: -100 } });
  });
  it("rejects stale history and sparse or missing endpoint comparisons", () => {
    expect(analyze(history(48, () => 100).slice(0, -3)).status).toBe("stale");
    expect(analyze(history(48, () => 100).filter((_, i) => i % 4 === 0)).comparison).toBeUndefined();
    expect(analyze(history(48, () => 100).filter((_, i) => i !== 23)).comparison).toBeUndefined();
  });
  it("excludes unknown and future observations from the range", () => {
    expect(analyze([{ ts: now, current: 999 }, { ts: now + hour, current: 888, source: "steam", granularity: "instant" }]))
      .toMatchObject({ status: "collecting", observations: 0, minimum: null, maximum: null });
  });
});
