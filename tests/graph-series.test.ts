import { describe, expect, it } from "vitest";
import { buildGraphSeries, hasEnoughGraphHistory, hasEnoughGraphHistoryFromHourly } from "../src/utils/sparkline.js";
import { normalizeHourly } from "../src/utils/series.js";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 0, 31, 12);

function hourly(count: number, start = NOW - count * HOUR): import("../src/types/index.js").Snapshot[] {
  return Array.from({ length: count }, (_, index) => ({ ts: start + index * HOUR, current: 100 + index, source: "steamcharts" as const, granularity: "hourly" as const }));
}

describe("buildGraphSeries", () => {
  it("uses real timestamp spacing and splits gaps", () => {
    const snapshots = [...hourly(2, NOW - 8 * HOUR), ...hourly(2, NOW - 2 * HOUR)];
    const graph = buildGraphSeries(snapshots, 24 * HOUR, NOW, 240, 60);
    expect(graph.segments).toHaveLength(2);
    expect(graph.segments[0]?.points[1]?.x).toBeLessThan(graph.segments[1]?.points[0]?.x ?? 0);
  });

  it("preserves spikes while bounding a dense segment", () => {
    const snapshots = Array.from({ length: 1_000 }, (_, index) => ({ ts: NOW - 60 * 60_000 + index * 60, current: index === 500 ? 9_999 : 100, source: "steam" as const, granularity: "instant" as const }));
    const graph = buildGraphSeries(snapshots, HOUR, NOW, 240, 60, 40);
    const points = graph.segments.flatMap((segment) => segment.points);
    expect(points.length).toBeLessThanOrEqual(40);
    expect(points.some((point) => point.current === 9_999)).toBe(true);
  });

  it("excludes legacy, monthly, aggregate, and future observations while retaining zero", () => {
    const graph = buildGraphSeries([
      { ts: NOW - HOUR, current: 0, source: "steamcharts", granularity: "hourly" },
      { ts: NOW - HOUR, current: 99, source: "legacy", granularity: "unknown" },
      { ts: NOW - 2 * HOUR, current: 99, source: "steamcharts", granularity: "monthly-peak" },
      { ts: NOW + HOUR, current: 99, source: "steamcharts", granularity: "hourly" },
    ], 24 * HOUR, NOW, 240, 60);
    expect(graph.segments.flatMap((segment) => segment.points).map((point) => point.current)).toEqual([0]);
  });

  it("enforces one global budget across isolated segments while retaining global extrema", () => {
    const snapshots = Array.from({ length: 1_000 }, (_, index) => ({
      ts: NOW - (1_000 - index) * 4 * HOUR,
      current: index === 111 ? -5 : index === 777 ? 9_999 : 100,
      source: "steamcharts" as const,
      granularity: "hourly" as const,
    }));
    const graph = buildGraphSeries(snapshots, 0, NOW, 240, 60, 200);
    const points = graph.segments.flatMap((segment) => segment.points);
    expect(points.length).toBeLessThanOrEqual(200);
    expect(points.some((point) => point.current === -5)).toBe(true);
    expect(points.some((point) => point.current === 9_999)).toBe(true);
    expect(graph.segments.every((segment) => segment.points.length === 1)).toBe(true);
  });
});

describe("hasEnoughGraphHistory", () => {
  it("matches the snapshot API when supplied normalized points", () => {
    const snapshots = hourly(24);
    expect(hasEnoughGraphHistoryFromHourly(normalizeHourly(snapshots, NOW), 24 * HOUR, NOW)).toBe(hasEnoughGraphHistory(snapshots, 24 * HOUR, NOW));
  });

  it("rejects dense same-hour samples and accepts coverage-complete windows", () => {
    const dense = Array.from({ length: 1_000 }, (_, index) => ({ ts: NOW - HOUR + index, current: 100, source: "steam" as const, granularity: "instant" as const }));
    expect(hasEnoughGraphHistory(dense, 30 * 24 * HOUR, NOW)).toBe(false);
    expect(hasEnoughGraphHistory(hourly(24), 24 * HOUR, NOW)).toBe(true);
  });
});
