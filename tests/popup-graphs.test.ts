// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { freshnessTitle, renderSparkline } from "../src/popup/graphs.js";

const now = Date.UTC(2026, 8, 11, 12);
const options = { width: 372, height: 56, maxPoints: 200, strokeColor: "#00c8ff", now };

describe("popup graphs", () => {
  it("colors individual rises and falls independently of the overall stroke", () => {
    const result = renderSparkline([100, 105, 102, 103].map((current, index) => ({
      ts: now - (3 - index) * 3_600_000, current, source: "steamcharts", granularity: "hourly",
    })), { ...options, strokeColor: "#ef4444" });
    expect(Array.from(result!.svg.querySelectorAll("polyline"), (line) => line.getAttribute("stroke")))
      .toEqual(["#22c55e", "#ef4444", "#00c8ff"]);
  });

  it("draws disconnected observations as separate marks", () => {
    const result = renderSparkline([
      { ts: now - 10 * 3_600_000, current: 0, source: "steamcharts", granularity: "hourly" },
      { ts: now, current: 100, source: "steam", granularity: "instant" },
    ], options);
    expect(result?.svg.querySelectorAll("circle")).toHaveLength(2);
    expect(result?.svg.querySelectorAll("polyline")).toHaveLength(0);
    expect(result?.points[0]?.current).toBe(0);
  });

  it("does not draw legacy daily peaks as a player curve", () => {
    expect(renderSparkline([{ ts: now, current: 85500 }], options)).toBeNull();
  });

  it("explains unknown and unavailable field provenance", () => {
    expect(freshnessTitle(undefined)).toContain("unknown");
    expect(freshnessTitle({ source: "steamcharts", status: "unavailable", attemptedAt: now })).toBe("Not available from steamcharts");
  });
});
