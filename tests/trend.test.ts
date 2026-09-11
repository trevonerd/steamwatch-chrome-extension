import { describe, expect, it } from "vitest";
import { analyzeSeasonalTrend, compute24hAvg, compute24hAvgFromHourly, computeLatestChangePct, computeLatestChangePctFromHourly, computeLocalPeak, computeRetentionAvg, computeRetentionAvgFromHourly, computeRetentionWindowLabel, computeTrend, computeWindowMin, fmtBadge, fmtNumber, fmtPct, fmtTimeAgo } from "../src/utils/trend.js";
import type { Snapshot } from "../src/types/index.js";
import { normalizeHourly } from "../src/utils/series.js";

const NOW = Date.UTC(2026, 0, 31, 12);
const HOUR = 3_600_000;

function history(recent: (hour: number) => number): Snapshot[] {
  const end = Math.floor(NOW / HOUR) * HOUR;
  return Array.from({ length: 35 * 24 }, (_, index) => {
    const ts = end - (35 * 24 - index) * HOUR;
    const base = 100 + (new Date(ts).getUTCDay() >= 5 ? 40 : 0);
    return { ts, current: ts >= end - 7 * 24 * HOUR ? recent(base) : base, source: "steamcharts", granularity: "hourly" };
  });
}

describe("seasonal trend", () => {
  it("keeps a weekday/weekend seasonal pattern stable", () => {
    expect(computeTrend(history((base) => base), NOW)?.level.key).toBe("STABLE");
  });

  it("detects a sustained 20 percent loss", () => {
    expect(computeTrend(history((base) => base * 0.8), NOW)?.pct).toBe(-20);
  });

  it("does not treat a one-day event as a permanent trend", () => {
    const snapshots = history((base) => base);
    const eventStart = NOW - 2 * 24 * HOUR;
    const event = snapshots.map((snapshot) => snapshot.ts >= eventStart && snapshot.ts < eventStart + 24 * HOUR ? { ...snapshot, current: snapshot.current * 4 } : snapshot);
    expect(computeTrend(event, NOW)?.level.key).toBe("STABLE");
  });

  it("returns low-baseline for small populations and accepts a zero recent value", () => {
    expect(analyzeSeasonalTrend(history(() => 0).map((snapshot) => ({ ...snapshot, current: snapshot.current / 20 })), NOW).status).toBe("low-baseline");
    expect(computeTrend(history(() => 0), NOW)?.pct).toBe(-100);
  });

  it("reports stale and incomplete source data without a fallback trend", () => {
    const stale = history((base) => base).filter((snapshot) => snapshot.ts < NOW - 3 * HOUR);
    expect(analyzeSeasonalTrend(stale, NOW).status).toBe("stale");
    expect(computeTrend(stale, NOW)).toBeNull();
  });
});

describe("coverage-bound metrics", () => {
  it("matches snapshot APIs when supplied a normalized series", () => {
    const snapshots = history((base) => base);
    const hourly = normalizeHourly(snapshots, NOW);
    expect(compute24hAvgFromHourly(hourly, NOW)).toBe(compute24hAvg(snapshots, NOW));
    expect(computeRetentionAvgFromHourly(hourly, 7, NOW)).toBe(computeRetentionAvg(snapshots, 7, NOW));
    expect(computeLatestChangePctFromHourly(hourly, NOW)).toBe(computeLatestChangePct(snapshots, NOW));
  });

  it("requires qualified hourly coverage and excludes monthly peaks from minima", () => {
    expect(compute24hAvg(history((base) => base).slice(-24), NOW)).toBe(140);
    expect(compute24hAvg([{ ts: NOW - HOUR, current: 100, source: "legacy", granularity: "unknown" }], NOW)).toBeNull();
    expect(computeWindowMin([{ ts: NOW, current: 1, source: "steamcharts", granularity: "monthly-peak" }])).toBeNull();
    expect(computeLocalPeak([{ ts: NOW, current: 999, source: "steamcharts", granularity: "monthly-peak" }])).toBeNull();
    expect(computeWindowMin([{ ts: NOW, current: 1 }])).toBeNull();
  });

  it("rejects windows with stale endpoints, gaps, and non-adjacent latest changes", () => {
    const sparse = history((base) => base).slice(-20);
    expect(compute24hAvg(sparse, NOW)).toBeNull();
    const gapped = history((base) => base).slice(-24).filter((_, index) => index < 10 || index > 12);
    expect(compute24hAvg(gapped, NOW)).toBeNull();
    expect(computeLatestChangePct([{ ts: NOW - 4 * HOUR, current: 100, source: "steamcharts", granularity: "hourly" }, { ts: NOW - HOUR, current: 110, source: "steamcharts", granularity: "hourly" }], NOW)).toBeNull();
    expect(computeRetentionWindowLabel(history((base) => base), 7, NOW)).toBe("7d");
  });
});

describe("formatting regressions", () => {
  it("formats player counts and badges", () => {
    expect(fmtNumber(null)).toBe("—");
    expect(fmtNumber(1_500_000)).toBe("1.50M");
    expect(fmtNumber(45_300)).toBe("45.3k");
    expect(fmtBadge(1_234_567)).toBe("1.2M");
    expect(fmtBadge(42_000)).toBe("42k");
  });

  it("formats signs and elapsed time with an explicit clock", () => {
    expect(fmtPct(30)).toBe("+30%");
    expect(fmtPct(-15)).toBe("-15%");
    expect(fmtTimeAgo(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(fmtTimeAgo(NOW - 60_000, NOW)).toBe("1m ago");
  });
});
