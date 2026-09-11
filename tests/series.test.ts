import { describe, expect, it } from "vitest";
import { normalizeHourly } from "../src/utils/series.js";

describe("normalizeHourly", () => {
  it("prefers sufficiently supported local Steam samples over provider data", () => {
    const hour = Date.UTC(2026, 0, 1);
    const steam = Array.from({ length: 10 }, (_, index) => ({ ts: hour + index * 5 * 60_000, current: 100, source: "steam" as const, granularity: "instant" as const }));
    expect(normalizeHourly([...steam, { ts: hour + 30 * 60_000, current: 999, source: "steamcharts", granularity: "hourly" }])[0]).toMatchObject({ value: 100, source: "steam" });
  });

  it("uses one hourly provider observation and excludes aggregate resolutions", () => {
    const hour = Date.UTC(2026, 0, 1);
    expect(normalizeHourly([
      { ts: hour, current: 50, source: "steamcharts", granularity: "hourly" },
      { ts: hour, current: 1, source: "steamcharts", granularity: "monthly-peak" },
      { ts: hour, current: 1, source: "legacy", granularity: "unknown" },
    ])).toEqual([{ hour, value: 50, observedAt: hour, source: "steamcharts" }]);
  });

  it("sorts unsorted input and ignores future samples before choosing an hour", () => {
    const hour = Date.UTC(2026, 0, 1);
    const points = normalizeHourly([
      { ts: hour + 2 * 3_600_000, current: 20, source: "steamcharts", granularity: "hourly" },
      { ts: hour, current: 10, source: "steamcharts", granularity: "hourly" },
      { ts: hour + 30 * 60_000, current: 999, source: "steamcharts", granularity: "hourly" },
    ], hour + 15 * 60_000);
    expect(points).toEqual([{ hour, value: 10, observedAt: hour, source: "steamcharts" }]);
  });
});


describe("fallback historical observations", () => {
  it("qualifies hourly fallback history and keeps its provenance", () => {
    const ts = Date.UTC(2026, 8, 11, 9);
    expect(normalizeHourly([{ ts, current: 2269, source: "games-popularity", granularity: "hourly" }]))
      .toEqual([{ hour: ts, value: 2269, observedAt: ts, source: "games-popularity" }]);
  });
});
