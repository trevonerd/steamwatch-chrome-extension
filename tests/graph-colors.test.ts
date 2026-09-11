import { describe, expect, it } from "vitest";
import { colorGraphSegments, type GraphSeries } from "../src/utils/sparkline.js";

function series(...groups: number[][]): GraphSeries {
  return { startTs: 0, endTs: 10, coverage: 1, segments: groups.map((values) => ({
    points: values.map((current, x) => ({ current, x, y: current, ts: x })),
  })) };
}

describe("colorGraphSegments", () => {
  it("groups consecutive colors without joining gaps", () => {
    const runs = colorGraphSegments(series([100, 103, 106], [100, 103]));
    expect(runs.map((run) => [run.color, run.points.length])).toEqual([["#22c55e", 3], ["#22c55e", 2]]);
  });

  it("preserves turning points and distinguishes strong, small, and flat moves", () => {
    const runs = colorGraphSegments(series([100, 120, 100, 103, 100, 101]));
    expect(runs.map((run) => run.color)).toEqual(["#16a34a", "#dc2626", "#22c55e", "#ef4444", "#00c8ff"]);
    expect(runs[0]?.points.at(-1)).toEqual(runs[1]?.points[0]);
  });

  it("handles empty series, singleton observations, and real zero counts", () => {
    expect(colorGraphSegments(series())).toEqual([]);
    expect(colorGraphSegments(series([], [0]))[0]?.color).toBe("#00c8ff");
    expect(colorGraphSegments(series([0, 0, 100, 0])).map((run) => run.color))
      .toEqual(["#00c8ff", "#16a34a", "#dc2626"]);
  });
});
