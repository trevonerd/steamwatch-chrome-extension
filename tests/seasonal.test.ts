import { describe, expect, it } from "vitest";
import { analyzeSeasonalTrend, analyzeSeasonalTrendFromHourly } from "../src/utils/seasonal.js";
import { normalizeHourly } from "../src/utils/series.js";

describe("analyzeSeasonalTrend", () => {
  const now = Date.UTC(2026, 1, 28, 12);
  const hourly = (valueAt: (hour: number) => number) => Array.from({ length: 35 * 24 + 1 }, (_, index) => {
    const ts = now - (35 * 24 - index) * 3_600_000;
    return { ts, current: valueAt(ts), source: "steamcharts" as const, granularity: "hourly" as const };
  });
  it("requires three same-hour weekday baseline observations", () => {
    const now = Date.UTC(2026, 0, 31, 12);
    const snapshots = Array.from({ length: 7 * 24 }, (_, index) => ({
      ts: now - (7 * 24 - index) * 3_600_000,
      current: 100,
      source: "steamcharts" as const,
      granularity: "hourly" as const,
    }));
    expect(analyzeSeasonalTrend(snapshots, now).status).toBe("insufficient");
  });

  it("returns the same analysis from a normalized series", () => {
    const snapshots = hourly((ts) => ts >= now - 7 * 24 * 3_600_000 ? 80 : 100);
    expect(analyzeSeasonalTrendFromHourly(normalizeHourly(snapshots, now), now)).toEqual(analyzeSeasonalTrend(snapshots, now));
  });

  it("ignores future observations", () => {
    const now = Date.UTC(2026, 0, 31, 12);
    expect(analyzeSeasonalTrend([{ ts: now + 3_600_000, current: 100, source: "steamcharts", granularity: "hourly" }], now).status).toBe("stale");
  });

  it("does not divide by zero baseline hours", () => {
    const now = Date.UTC(2026, 0, 31, 12);
    const snapshots = Array.from({ length: 35 * 24 }, (_, index) => ({
      ts: now - (35 * 24 - index) * 3_600_000,
      current: 0,
      source: "steamcharts" as const,
      granularity: "hourly" as const,
    }));
    expect(analyzeSeasonalTrend(snapshots, now).status).toBe("insufficient");
  });

  it("keeps a weekday, weekend, and night-shaped stable population stable", () => {
    const shaped = hourly((ts) => {
      const date = new Date(ts);
      const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
      const night = date.getUTCHours() < 8;
      return 100 + (weekend ? 80 : 0) - (night ? 60 : 0);
    });
    const result = analyzeSeasonalTrend(shaped, now);
    expect(result).toMatchObject({ status: "ready", trend: { level: expect.objectContaining({ key: "STABLE" }), pct: 0 } });
  });

  it("detects a persistent twenty percent decline against matched seasonal hours", () => {
    const snapshots = hourly((ts) => ts >= now - 7 * 24 * 3_600_000 ? 80 : 100);
    const result = analyzeSeasonalTrend(snapshots, now);
    expect(result).toMatchObject({ status: "ready", trend: { pct: -20, level: expect.objectContaining({ key: "DOWN" }) } });
  });

  it("uses median baselines so one historical spike does not erase a sustained decline", () => {
    const spikeWeek = now - 3 * 7 * 24 * 3_600_000;
    const snapshots = hourly((ts) => {
      const recent = ts >= now - 7 * 24 * 3_600_000;
      const spike = ts >= spikeWeek && ts < spikeWeek + 7 * 24 * 3_600_000;
      return recent ? 80 : spike ? 1_000 : 100;
    });
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({ status: "ready", trend: { pct: -20 } });
  });

  it("reports low baseline and sparse comparable-hours explicitly", () => {
    expect(analyzeSeasonalTrend(hourly(() => 5), now)).toMatchObject({ status: "low-baseline" });
    const sparse = hourly(() => 100).filter((snapshot) => new Date(snapshot.ts).getUTCHours() >= 6);
    expect(analyzeSeasonalTrend(sparse, now)).toMatchObject({ status: "insufficient" });
  });
});
