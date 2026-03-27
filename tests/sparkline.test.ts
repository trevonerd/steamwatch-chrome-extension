// tests/sparkline.test.ts
import { describe, it, expect } from "vitest";
import {
  buildAvailableGraphWindows,
  buildPriceSparklineSVG,
  buildSparklineSVG,
  downsampleSnapshotsForGraph,
  filterSnapshotsByWindow,
  findNearestPointIndex,
  hasEnoughGraphHistory,
  sparklineColor,
} from "../src/utils/sparkline.js";
import type { PriceRecord, Snapshot } from "../src/types/index.js";

function snaps(values: number[]): Snapshot[] {
  return values.map((current, i) => ({ ts: Date.now() + i * 60_000, current }));
}

// ── buildSparklineSVG ─────────────────────────────────────────────────────────

describe("buildSparklineSVG", () => {
  it("returns null for empty array", () => {
    expect(buildSparklineSVG([])).toBeNull();
  });

  it("returns null for a single snapshot", () => {
    expect(buildSparklineSVG(snaps([1000]))).toBeNull();
  });

  it("returns an SVG string for 2+ snapshots", () => {
    const svg = buildSparklineSVG(snaps([1000, 2000]));
    expect(svg).not.toBeNull();
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("contains a polyline element", () => {
    const svg = buildSparklineSVG(snaps([1000, 1500, 2000]));
    expect(svg).toContain("<polyline");
  });

  it("contains a polygon fill element", () => {
    const svg = buildSparklineSVG(snaps([1000, 1500, 2000]));
    expect(svg).toContain("<polygon");
  });

  it("respects custom width and height in viewBox", () => {
    const svg = buildSparklineSVG(snaps([100, 200]), { width: 80, height: 20 });
    expect(svg).toContain('viewBox="0 0 80 20"');
    expect(svg).toContain('preserveAspectRatio="none"');
    // width/height are intentionally NOT set as SVG attributes — CSS controls size
    expect(svg).not.toContain('width="80"');
    expect(svg).not.toContain('height="20"');
  });

  it("uses provided strokeColor", () => {
    const svg = buildSparklineSVG(snaps([100, 200]), { strokeColor: "#ff0000" });
    expect(svg).toContain('#ff0000');
  });

  it("uses provided fillColor", () => {
    const svg = buildSparklineSVG(snaps([100, 200]), { fillColor: "rgba(255,0,0,0.1)" });
    expect(svg).toContain("rgba(255,0,0,0.1)");
  });

  it("limits to maxPoints most-recent snapshots", () => {
    const many = snaps(Array.from({ length: 100 }, (_, i) => i * 10));
    const svg = buildSparklineSVG(many, { maxPoints: 5 });
    // Only 5 data points → polyline has exactly 5 coordinate pairs
    const match = svg?.match(/polyline points="([^"]+)"/);
    expect(match).not.toBeNull();
    const pairs = match![1]!.trim().split(" ");
    expect(pairs).toHaveLength(5);
  });

  it("handles a flat line (all equal values) without crashing", () => {
    const svg = buildSparklineSVG(snaps([5000, 5000, 5000, 5000]));
    expect(svg).not.toBeNull();
    expect(svg).toContain("<polyline");
  });

  it("is marked aria-hidden for screen readers", () => {
    const svg = buildSparklineSVG(snaps([100, 200]));
    expect(svg).toContain('aria-hidden="true"');
  });

  it("produces valid numeric coordinates (no NaN or Infinity)", () => {
    const svg = buildSparklineSVG(snaps([0, 1000, 500, 2000, 100]));
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });
});

describe("filterSnapshotsByWindow", () => {
  it("keeps only snapshots inside the requested window", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 2 * 86_400_000, current: 100 },
      { ts: now - 12 * 3_600_000, current: 200 },
      { ts: now - 60_000, current: 300 },
    ];
    expect(filterSnapshotsByWindow(data, 24 * 3_600_000)).toHaveLength(2);
  });
});

describe("downsampleSnapshotsForGraph", () => {
  it("keeps first and last snapshots while reducing point count", () => {
    const data = snaps(Array.from({ length: 100 }, (_, i) => i));
    const reduced = downsampleSnapshotsForGraph(data, 12);
    expect(reduced).toHaveLength(12);
    expect(reduced[0]?.current).toBe(0);
    expect(reduced.at(-1)?.current).toBe(99);
  });

  it("returns the original series when already within the cap", () => {
    const data = snaps([1, 2, 3, 4]);
    expect(downsampleSnapshotsForGraph(data, 10)).toHaveLength(4);
  });
});

describe("hasEnoughGraphHistory", () => {
  it("returns false without enough coverage", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 8 * 3_600_000, current: 1 },
      { ts: now - 6 * 3_600_000, current: 2 },
      { ts: now - 4 * 3_600_000, current: 3 },
      { ts: now - 2 * 3_600_000, current: 4 },
      { ts: now - 60 * 60_000, current: 5 },
      { ts: now - 10 * 60_000, current: 6 },
    ];
    expect(hasEnoughGraphHistory(data, 24 * 3_600_000)).toBe(false);
  });

  it("returns true for a well-covered window", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 23 * 3_600_000, current: 1 },
      { ts: now - 20 * 3_600_000, current: 2 },
      { ts: now - 16 * 3_600_000, current: 3 },
      { ts: now - 12 * 3_600_000, current: 4 },
      { ts: now - 8 * 3_600_000, current: 5 },
      { ts: now - 2 * 3_600_000, current: 6 },
      { ts: now - 10 * 60_000, current: 7 },
    ];
    expect(hasEnoughGraphHistory(data, 24 * 3_600_000)).toBe(true);
  });
});

describe("buildAvailableGraphWindows", () => {
  it("returns 24h, 3d, 7d, 15d, 1m, all when retention is 30+ days", () => {
    expect(buildAvailableGraphWindows(30).map((window) => window.label)).toEqual([
      "24h",
      "3d",
      "7d",
      "15d",
      "1m",
      "all",
    ]);
  });

  it("always includes 'all' window even with limited retention", () => {
    expect(buildAvailableGraphWindows(1).map((window) => window.label)).toContain("all");
    expect(buildAvailableGraphWindows(3).map((window) => window.label)).toContain("all");
  });
});

// ── findNearestPointIndex ─────────────────────────────────────────────────────

describe("findNearestPointIndex", () => {
  const pts = [
    { x: 0,  y: 10 },
    { x: 10, y: 8  },
    { x: 20, y: 6  },
    { x: 30, y: 4  },
    { x: 40, y: 2  },
  ];

  it("returns 0 for empty array", () => {
    expect(findNearestPointIndex(15, [])).toBe(0);
  });

  it("returns 0 for single-element array", () => {
    expect(findNearestPointIndex(15, [{ x: 5, y: 5 }])).toBe(0);
  });

  it("returns index of nearest point (x=15 → index 1 or 2, whichever closer)", () => {
    const idx = findNearestPointIndex(15, pts);
    expect([1, 2]).toContain(idx);
  });

  it("returns 0 for x before first point", () => {
    expect(findNearestPointIndex(-5, pts)).toBe(0);
  });

  it("returns last index for x after last point", () => {
    expect(findNearestPointIndex(100, pts)).toBe(4);
  });

  it("returns 0 for exact match at x=0", () => {
    expect(findNearestPointIndex(0, pts)).toBe(0);
  });

  it("returns last index for exact match at x=40", () => {
    expect(findNearestPointIndex(40, pts)).toBe(4);
  });

  it("returns 2 for exact match at x=20", () => {
    expect(findNearestPointIndex(20, pts)).toBe(2);
  });

  it("picks the closer of two adjacent points", () => {
    expect(findNearestPointIndex(12, pts)).toBe(1);
    expect(findNearestPointIndex(18, pts)).toBe(2);
  });
});

function priceRecords(amounts: number[]): PriceRecord[] {
  return amounts.map((priceAmountInt, i) => ({
    appId: "123",
    timestamp: 1_700_000_000_000 + i * 86_400_000,
    priceAmountInt,
    regularAmountInt: 2499,
    cut: 0,
    shop: "steam",
  }));
}

// ── buildPriceSparklineSVG ────────────────────────────────────────────────────

describe("buildPriceSparklineSVG", () => {
  it("returns null for empty array", () => {
    expect(buildPriceSparklineSVG([])).toBeNull();
  });

  it("returns valid SVG for single record", () => {
    const svg = buildPriceSparklineSVG(priceRecords([1499]));
    expect(svg).not.toBeNull();
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain('aria-hidden="true"');
  });

  it("returns SVG starting with <svg for multiple records", () => {
    const svg = buildPriceSparklineSVG(priceRecords([2499, 1999, 999]));
    expect(svg).not.toBeNull();
    expect(svg!.trimStart()).toMatch(/^<svg/);
  });

  it("contains <line elements for multiple records", () => {
    const svg = buildPriceSparklineSVG(priceRecords([2499, 1999, 999]));
    expect(svg).toContain("<line");
  });

  it("uses correct viewBox dimensions (372×40)", () => {
    const svg = buildPriceSparklineSVG(priceRecords([999, 1999]));
    expect(svg).toContain('viewBox="0 0 372 40"');
  });

  it("produces no NaN or Infinity in coordinates", () => {
    const svg = buildPriceSparklineSVG(priceRecords([500, 1000, 750, 2000, 100]));
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });

  it("handles flat prices (all equal) without crashing", () => {
    const svg = buildPriceSparklineSVG(priceRecords([999, 999, 999]));
    expect(svg).not.toBeNull();
    expect(svg).toContain("<line");
  });

  it("falling prices produce green segments", () => {
    const svg = buildPriceSparklineSVG(priceRecords([2499, 999]));
    expect(svg).toMatch(/stroke="#(?:22c55e|16a34a)"/);
  });

  it("rising prices produce red segments", () => {
    const svg = buildPriceSparklineSVG(priceRecords([999, 2499]));
    expect(svg).toMatch(/stroke="#(?:ef4444|dc2626)"/);
  });

  it("sorts records by timestamp regardless of input order", () => {
    const shuffled: PriceRecord[] = [
      { appId: "1", timestamp: 1_700_086_400_000, priceAmountInt: 999, regularAmountInt: 2499, cut: 60, shop: "steam" },
      { appId: "1", timestamp: 1_700_000_000_000, priceAmountInt: 2499, regularAmountInt: 2499, cut: 0, shop: "steam" },
    ];
    const svg = buildPriceSparklineSVG(shuffled);
    expect(svg).not.toBeNull();
    expect(svg).toContain("<line");
  });
});

// ── sparklineColor ────────────────────────────────────────────────────────────

describe("sparklineColor", () => {
  it("returns accent blue for empty array", () => {
    expect(sparklineColor([])).toBe("#00c8ff");
  });

  it("returns accent blue for single snapshot", () => {
    expect(sparklineColor(snaps([1000]))).toBe("#00c8ff");
  });

  it("returns green when last value is significantly higher than first", () => {
    expect(sparklineColor(snaps([1000, 1000, 1500]))).toBe("#22c55e");
  });

  it("returns red when last value is significantly lower than first", () => {
    expect(sparklineColor(snaps([1000, 1000, 500]))).toBe("#ef4444");
  });

  it("returns accent blue when change is within ±2%", () => {
    // 1000 → 1015 is +1.5%, inside the ±2% flat zone
    expect(sparklineColor(snaps([1000, 1015]))).toBe("#00c8ff");
  });

  it("returns green at exactly the 2% up boundary", () => {
    // 1000 → 1021 is +2.1%
    expect(sparklineColor(snaps([1000, 1021]))).toBe("#22c55e");
  });

  it("returns red at exactly the 2% down boundary", () => {
    // 1000 → 979 is -2.1%
    expect(sparklineColor(snaps([1000, 979]))).toBe("#ef4444");
  });
});
