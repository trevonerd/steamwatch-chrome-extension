import { describe, expect, it } from "vitest";
import { analyzeLatestAvailableSeasonalTrendFromHourly, analyzeSeasonalTrend, analyzeSeasonalTrendFromHourly } from "../src/utils/seasonal.js";
import { normalizeHourly } from "../src/utils/series.js";

describe("analyzeSeasonalTrend", () => {
  const now = Date.UTC(2026, 1, 28, 12);
  const hourly = (valueAt: (hour: number) => number) => Array.from({ length: 35 * 24 + 1 }, (_, index) => {
    const ts = now - (35 * 24 - index) * 3_600_000;
    return { ts, current: valueAt(ts), source: "steamcharts" as const, granularity: "hourly" as const };
  });
  it("requires a preceding week of same-hour weekday observations", () => {
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
    expect(analyzeSeasonalTrend(snapshots, now).status).toBe("low-baseline");
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

  it("reports stability after two stable weeks even when the launch month was much higher", () => {
    const snapshots = hourly((ts) => ts >= now - 14 * 24 * 3_600_000 ? 3500 : 12000);
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({ status: "ready", trend: { pct: 0 } });
  });

  it("reports the current weekly pace instead of cumulative loss against old weeks", () => {
    const snapshots = hourly((ts) => ts >= now - 7 * 24 * 3_600_000 ? 80 : ts >= now - 14 * 24 * 3_600_000 ? 100 : 200);
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({ status: "ready", trend: { pct: -20, delta: -20 } });
  });

  it("uses the ratio of matched means instead of overweighting quiet hours", () => {
    const snapshots = hourly((ts) => {
      const recent = ts >= now - 7 * 24 * 3_600_000;
      return new Date(ts).getUTCHours() < 12 ? recent ? 20 : 10 : recent ? 90 : 100;
    });
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({ status: "ready", trend: { pct: 0, delta: 0 } });
  });

  it("keeps a one-day event visible without classifying it as sustained growth", () => {
    const result = analyzeSeasonalTrend(hourly((ts) => ts >= now - 24 * 3_600_000 ? 400 : 100), now);
    expect(result).toMatchObject({ status: "ready", trend: { pct: 42.9, sustained: false, level: { label: "Uneven week" } } });
  });

  it("detects a week-long crash while a real zero remains a valid observation", () => {
    expect(analyzeSeasonalTrend(hourly((ts) => ts >= now - 7 * 24 * 3_600_000 ? 0 : 100), now))
      .toMatchObject({ status: "ready", trend: { pct: -100, sustained: true }, comparison: { fallingDays: 7, matchedHours: 168 } });
  });

  it("does not refresh an incomplete comparison with an unmatched live hour", () => {
    const missingEnd = hourly(() => 100).filter((s) => s.ts !== now - 3_600_000);
    expect(analyzeSeasonalTrend(missingEnd, now).status).toBe("insufficient");
  });

  it("compares identical observations consistently across history providers", () => {
    const snapshots = hourly((ts) => 100 + new Date(ts).getUTCHours()).map((s) => ({
      ...s, source: s.ts >= now - 7 * 24 * 3_600_000 ? "games-popularity" as const : "steamcharts" as const,
    }));
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({ status: "ready", trend: { pct: 0 } });
  });

  it.each([
    [4.96, 5, "UP", true], [5.04, 5, "UP", true],
    [-4.96, -5, "STABLE", false], [-5.04, -5, "STABLE", false], [-5.06, -5.1, "DOWN", true],
  ])("keeps labels and eligibility consistent near the %s%% display boundary", (change, pct, key, sustained) => {
    const result = analyzeSeasonalTrend(hourly((ts) => ts >= now - 7 * 24 * 3_600_000 ? 100 + Number(change) : 100), now);
    expect(result).toMatchObject({ status: "ready", trend: { pct, sustained, level: { key } } });
  });
});

describe("latest available seasonal comparison", () => {
  const hour = 3_600_000;
  const now = Date.UTC(2026, 8, 16, 16);
  const history = (end: number, hours = 14 * 24) => Array.from({ length: hours }, (_, index) => ({
    hour: end - (hours - index) * hour,
    observedAt: end - (hours - index) * hour + 6 * 60_000,
    value: index >= hours - 168 ? 80 : 100,
    source: "games-popularity" as const,
  }));

  it("recovers a dated comparison behind a sixteen-hour provider delay without changing current alert eligibility", () => {
    const end = now - 16 * hour;
    const points = history(end);
    expect(analyzeSeasonalTrendFromHourly(points, now).status).toBe("stale");
    expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toMatchObject({
      status: "ready", trend: { pct: -20 }, comparison: { endTs: end, matchedHours: 168 },
    });
  });

  it("finds the latest complete comparison despite isolated recent hours", () => {
    const end = now - 16 * hour;
    const points = [...history(end), { hour: now - hour, observedAt: now - 10 * 60_000, value: 90, source: "steam" as const }];
    expect(analyzeSeasonalTrendFromHourly(points, now).status).toBe("insufficient");
    expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toMatchObject({
      status: "ready", comparison: { endTs: end },
    });
  });

  it("preserves an already current ready comparison", () => {
    const points = history(now);
    expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toEqual(analyzeSeasonalTrendFromHourly(points, now));
  });

  it("preserves a current low baseline instead of substituting an older ready comparison", () => {
    const points = history(now, 15 * 24).map((point) => ({
      ...point,
      value: point.hour < now - 14 * 24 * hour ? 100 : 5,
    }));
    const current = analyzeSeasonalTrendFromHourly(points, now);
    expect(current.status).toBe("low-baseline");
    expect(analyzeSeasonalTrendFromHourly(points, now - 24 * hour).status).toBe("ready");
    expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toEqual(current);
  });

  it("does not relax required history or recover comparisons older than forty-eight hours", () => {
    for (const points of [history(now - 16 * hour, 168), history(now - 49 * hour), history(now, 336).filter((point) => new Date(point.hour).getUTCHours() >= 6)]) {
      expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toEqual(analyzeSeasonalTrendFromHourly(points, now));
    }
  });

  it("ignores future observations when recovering historical comparisons", () => {
    const points = history(now - 16 * hour);
    const future = history(now + 24 * hour).map((point) => ({ ...point, observedAt: now + hour, value: 10000 }));
    expect(analyzeLatestAvailableSeasonalTrendFromHourly([...points, ...future], now))
      .toEqual(analyzeLatestAvailableSeasonalTrendFromHourly(points, now));
  });
});
