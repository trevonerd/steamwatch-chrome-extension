// tests/mapToPoints.test.ts
// Tests for the shared SVG/Canvas coordinate mapper.
// This function is the bridge between both renderers — its correctness
// is load-bearing for both the sparkline SVG and the share canvas PNG.
import { describe, it, expect } from "vitest";
import { mapToPoints } from "../src/utils/sparkline.js";

// ── Guard conditions ──────────────────────────────────────────────────────────

describe("mapToPoints — guards", () => {
  it("returns empty array for empty values", () => {
    expect(mapToPoints([], 160, 36)).toEqual([]);
  });

  it("returns empty array for a single value (no line possible)", () => {
    expect(mapToPoints([5000], 160, 36)).toEqual([]);
  });

  it("returns one point per value for 2+ values", () => {
    expect(mapToPoints([1000, 2000], 160, 36)).toHaveLength(2);
    expect(mapToPoints([1, 2, 3, 4, 5], 160, 36)).toHaveLength(5);
  });
});

// ── X coordinates ─────────────────────────────────────────────────────────────

describe("mapToPoints — X axis", () => {
  it("first point X is padX", () => {
    const pts = mapToPoints([100, 200], 160, 36, 2, 3);
    expect(pts[0]!.x).toBeCloseTo(2);
  });

  it("last point X is width - padX", () => {
    const pts = mapToPoints([100, 200], 160, 36, 2, 3);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(158);
  });

  it("X values are evenly spaced", () => {
    const pts = mapToPoints([10, 20, 30, 40, 50], 100, 40, 0, 0);
    const gaps = pts.slice(1).map((p, i) => p.x - pts[i]!.x);
    const first = gaps[0]!;
    gaps.forEach((g) => expect(g).toBeCloseTo(first, 5));
  });

  it("respects custom padX", () => {
    const pts = mapToPoints([100, 200], 200, 40, 10, 0);
    expect(pts[0]!.x).toBeCloseTo(10);
    expect(pts[1]!.x).toBeCloseTo(190);
  });
});

// ── Y coordinates ─────────────────────────────────────────────────────────────

describe("mapToPoints — Y axis", () => {
  it("highest value maps to padY (top)", () => {
    const pts = mapToPoints([0, 100], 160, 36, 0, 5);
    // value 100 is max → y = padY = 5
    expect(pts[1]!.y).toBeCloseTo(5);
  });

  it("lowest value maps to height - padY (bottom)", () => {
    const pts = mapToPoints([0, 100], 160, 36, 0, 5);
    // value 0 is min → y = height - padY = 31
    expect(pts[0]!.y).toBeCloseTo(31);
  });

  it("mid value maps to vertical midpoint", () => {
    const pts = mapToPoints([0, 50, 100], 160, 100, 0, 0);
    // value 50 is exactly mid → y = 50
    expect(pts[1]!.y).toBeCloseTo(50, 1);
  });

  it("flat series renders at vertical midpoint", () => {
    const pts = mapToPoints([5000, 5000, 5000], 160, 40, 0, 0);
    pts.forEach((p) => expect(p.y).toBeCloseTo(20));
  });

  it("Y never exceeds height for any input", () => {
    const pts = mapToPoints([100, 200, 50, 300, 150], 160, 36, 2, 3);
    pts.forEach((p) => expect(p.y).toBeLessThanOrEqual(36));
  });

  it("Y is never negative", () => {
    const pts = mapToPoints([100, 200, 50, 300, 150], 160, 36, 2, 3);
    pts.forEach((p) => expect(p.y).toBeGreaterThanOrEqual(0));
  });

  it("descending series: later points have larger Y (lower on screen)", () => {
    const pts = mapToPoints([100, 80, 60, 40, 20], 160, 36, 0, 0);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.y).toBeGreaterThan(pts[i - 1]!.y);
    }
  });

  it("ascending series: later points have smaller Y (higher on screen)", () => {
    const pts = mapToPoints([20, 40, 60, 80, 100], 160, 36, 0, 0);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.y).toBeLessThan(pts[i - 1]!.y);
    }
  });
});

// ── Dimensions ────────────────────────────────────────────────────────────────

describe("mapToPoints — dimension handling", () => {
  it("respects different width and height values", () => {
    const pts = mapToPoints([1, 2], 320, 64, 0, 0);
    expect(pts[0]!.x).toBeCloseTo(0);
    expect(pts[1]!.x).toBeCloseTo(320);
    expect(pts[0]!.y).toBeCloseTo(64); // min → bottom
    expect(pts[1]!.y).toBeCloseTo(0);  // max → top
  });

  it("works with very small dimensions", () => {
    expect(() => mapToPoints([100, 200, 300], 16, 8, 1, 1)).not.toThrow();
  });

  it("works with a large series (336 snapshots)", () => {
    const values = Array.from({ length: 336 }, (_, i) => 1000 + i * 10);
    expect(() => mapToPoints(values, 160, 36)).not.toThrow();
    expect(mapToPoints(values, 160, 36)).toHaveLength(336);
  });
});
