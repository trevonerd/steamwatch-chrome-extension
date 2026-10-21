import { describe, expect, it } from "vitest";
import {
  analyzeLatestAvailableSeasonalTrendFromHourly,
  analyzeSeasonalTrend,
  analyzeSeasonalTrendFromHourly,
  detectPlayerChanges,
} from "../src/utils/seasonal.js";
import { normalizeHourly } from "../src/utils/series.js";

describe("analyzeSeasonalTrend", () => {
  const now = Date.UTC(2026, 1, 28, 12);
  const hourly = (valueAt: (hour: number) => number) =>
    Array.from({ length: 35 * 24 + 1 }, (_, index) => {
      const ts = now - (35 * 24 - index) * 3_600_000;
      return { ts, current: valueAt(ts), source: "steamcharts" as const, granularity: "hourly" as const };
    });
  it("requires matching hours from a week earlier or three earlier days", () => {
    const now = Date.UTC(2026, 0, 31, 12);
    const snapshots = Array.from({ length: 3 * 24 }, (_, index) => ({
      ts: now - (3 * 24 - index) * 3_600_000,
      current: 100,
      source: "steamcharts" as const,
      granularity: "hourly" as const,
    }));
    expect(analyzeSeasonalTrend(snapshots, now).status).toBe("insufficient");
  });

  it("returns the same analysis from a normalized series", () => {
    const snapshots = hourly((ts) => (ts >= now - 7 * 24 * 3_600_000 ? 80 : 100));
    expect(analyzeSeasonalTrendFromHourly(normalizeHourly(snapshots, now), now)).toEqual(
      analyzeSeasonalTrend(snapshots, now),
    );
  });

  it("ignores future observations", () => {
    const now = Date.UTC(2026, 0, 31, 12);
    expect(
      analyzeSeasonalTrend([{ ts: now + 3_600_000, current: 100, source: "steamcharts", granularity: "hourly" }], now)
        .status,
    ).toBe("stale");
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
    expect(result).toMatchObject({
      status: "ready",
      trend: { level: expect.objectContaining({ key: "STABLE" }), pct: 0 },
    });
  });

  it("shows a two-day collapse that the weekly average dilutes", () => {
    const day = 24 * 3_600_000;
    const snapshots = hourly((ts) => (ts >= now - day ? 55 : ts >= now - 2 * day ? 85 : 100));
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({
      status: "ready",
      trend: { pct: -45, delta: -45, level: expect.objectContaining({ key: "STRONG_DOWN" }) },
      comparison: { basis: "week", matchedHours: 24, weeklyPct: -8.6, recentPeak: 55, baselinePeak: 100 },
    });
  });

  it("falls back to the 7-day average of each hour when the week-ago hours are missing", () => {
    const snapshots = hourly((ts) => (ts >= now - 24 * 3_600_000 ? 50 : 100)).filter(
      (snapshot) => snapshot.ts >= now - 5 * 24 * 3_600_000,
    );
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({
      status: "ready",
      trend: { pct: -50 },
      comparison: { basis: "7d-avg" },
    });
  });

  it("reports low baseline and sparse comparable-hours explicitly", () => {
    expect(
      analyzeSeasonalTrend(
        hourly(() => 5),
        now,
      ),
    ).toMatchObject({ status: "low-baseline" });
    const sparse = hourly(() => 100).filter((snapshot) => new Date(snapshot.ts).getUTCHours() >= 6);
    expect(analyzeSeasonalTrend(sparse, now)).toMatchObject({ status: "insufficient" });
  });

  it("uses the ratio of matched means instead of overweighting quiet hours", () => {
    const snapshots = hourly((ts) => {
      const recent = ts >= now - 24 * 3_600_000;
      return new Date(ts).getUTCHours() < 12 ? (recent ? 20 : 10) : recent ? 90 : 100;
    });
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({ status: "ready", trend: { pct: 0, delta: 0 } });
  });

  it("shows a one-day event immediately", () => {
    expect(
      analyzeSeasonalTrend(
        hourly((ts) => (ts >= now - 24 * 3_600_000 ? 400 : 100)),
        now,
      ),
    ).toMatchObject({ status: "ready", trend: { pct: 300, level: { key: "EXPLOSION" } } });
  });

  it("classifies a fall to zero as a collapse while a real zero remains a valid observation", () => {
    expect(
      analyzeSeasonalTrend(
        hourly((ts) => (ts >= now - 24 * 3_600_000 ? 0 : 100)),
        now,
      ),
    ).toMatchObject({ status: "ready", trend: { pct: -100, level: { key: "COLLAPSE", cls: "crash" } } });
  });

  it("tolerates up to four missing recent hours", () => {
    const missing = hourly(() => 100).filter(
      (s) => s.ts < now - 5 * 3_600_000 || s.ts >= now - 3_600_000 || s.ts === now,
    );
    expect(analyzeSeasonalTrend(missing, now).status).toBe("ready");
    const tooMany = hourly(() => 100).filter((s) => s.ts < now - 6 * 3_600_000 || s.ts >= now - 3_600_000);
    expect(analyzeSeasonalTrend(tooMany, now).status).toBe("insufficient");
  });

  it("compares identical observations consistently across history providers", () => {
    const snapshots = hourly((ts) => 100 + new Date(ts).getUTCHours()).map((s) => ({
      ...s,
      source: s.ts >= now - 7 * 24 * 3_600_000 ? ("games-popularity" as const) : ("steamcharts" as const),
    }));
    expect(analyzeSeasonalTrend(snapshots, now)).toMatchObject({ status: "ready", trend: { pct: 0 } });
  });

  it.each([
    [9.9, "STABLE"],
    [10, "UP"],
    [25, "STRONG_UP"],
    [50, "EXPLOSION"],
    [-10, "STABLE"],
    [-10.1, "DOWN"],
    [-25, "DOWN"],
    [-25.1, "STRONG_DOWN"],
    [-50, "STRONG_DOWN"],
    [-50.1, "COLLAPSE"],
  ])("labels a %s%% change as %s", (change, key) => {
    const result = analyzeSeasonalTrend(
      hourly((ts) => (ts >= now - 24 * 3_600_000 ? 1000 + Number(change) * 10 : 1000)),
      now,
    );
    expect(result).toMatchObject({ status: "ready", trend: { pct: change, level: { key } } });
  });
});

describe("detectPlayerChanges", () => {
  const hour = 3_600_000;
  const now = Date.UTC(2026, 1, 28, 12);
  const points = (valueAt: (hour: number) => number) =>
    Array.from({ length: 21 * 24 }, (_, index) => {
      const ts = now - (21 * 24 - index) * hour;
      return { hour: ts, observedAt: ts + 60_000, value: valueAt(ts), source: "steamcharts" as const };
    });

  it("marks one ongoing drop from the first hour at least 20% below last week", () => {
    const start = now - 30 * hour;
    expect(
      detectPlayerChanges(
        points((ts) => (ts >= start ? 60 : 100)),
        now,
      ),
    ).toEqual([{ startTs: start, lastTs: now - hour, direction: "drop", pct: -40, hours: 30, ongoing: true }]);
  });

  it("ignores short spikes and tolerates two missing hours", () => {
    const spike = points((ts) => (ts >= now - 50 * hour && ts < now - 45 * hour ? 200 : 100));
    expect(detectPlayerChanges(spike, now)).toEqual([]);
    const start = now - 10 * hour;
    const gapped = points((ts) => (ts >= start ? 150 : 100)).filter(
      (point) => point.hour !== now - 5 * hour && point.hour !== now - 4 * hour,
    );
    expect(detectPlayerChanges(gapped, now)).toMatchObject([{ startTs: start, direction: "rise", hours: 8 }]);
  });

  it("closes a change once players return within 20% of last week", () => {
    const changes = detectPlayerChanges(
      points((ts) => (ts >= now - 40 * hour && ts < now - 20 * hour ? 50 : 100)),
      now,
    );
    expect(changes).toMatchObject([{ direction: "drop", hours: 20, ongoing: false }]);
  });
});

describe("latest available seasonal comparison", () => {
  const hour = 3_600_000;
  const now = Date.UTC(2026, 8, 16, 16);
  const history = (end: number, hours = 14 * 24) =>
    Array.from({ length: hours }, (_, index) => ({
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
      status: "ready",
      trend: { pct: -20 },
      comparison: { endTs: end, matchedHours: 23 },
    });
  });

  it("finds the latest complete comparison despite isolated recent hours", () => {
    const end = now - 16 * hour;
    const points = [
      ...history(end),
      { hour: now - hour, observedAt: now - 10 * 60_000, value: 90, source: "steam" as const },
    ];
    expect(analyzeSeasonalTrendFromHourly(points, now).status).toBe("insufficient");
    expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toMatchObject({
      status: "ready",
      comparison: { endTs: end },
    });
  });

  it("preserves an already current ready comparison", () => {
    const points = history(now);
    expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toEqual(
      analyzeSeasonalTrendFromHourly(points, now),
    );
  });

  it("preserves a current low baseline instead of substituting an older ready comparison", () => {
    const points = history(now, 15 * 24).map((point) => ({
      ...point,
      value:
        point.hour >= now - 24 * hour || (point.hour >= now - 8 * 24 * hour && point.hour < now - 7 * 24 * hour)
          ? 5
          : 100,
    }));
    const current = analyzeSeasonalTrendFromHourly(points, now);
    expect(current.status).toBe("low-baseline");
    expect(analyzeSeasonalTrendFromHourly(points, now - 24 * hour).status).toBe("ready");
    expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toEqual(current);
  });

  it("does not relax required history or recover comparisons older than forty-eight hours", () => {
    for (const points of [
      history(now - 16 * hour, 72),
      history(now - 51 * hour),
      history(now, 336).filter((point) => new Date(point.hour).getUTCHours() >= 6),
    ]) {
      expect(analyzeLatestAvailableSeasonalTrendFromHourly(points, now)).toEqual(
        analyzeSeasonalTrendFromHourly(points, now),
      );
    }
  });

  it("ignores future observations when recovering historical comparisons", () => {
    const points = history(now - 16 * hour);
    const future = history(now + 24 * hour).map((point) => ({ ...point, observedAt: now + hour, value: 10000 }));
    expect(analyzeLatestAvailableSeasonalTrendFromHourly([...points, ...future], now)).toEqual(
      analyzeLatestAvailableSeasonalTrendFromHourly(points, now),
    );
  });
});
