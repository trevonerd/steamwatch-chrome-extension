// tests/graph-windows.test.ts
// TDD for expanding GraphWindowKey from 3 to 6 time filter values.
import { describe, it, expect } from "vitest";
import {
  buildAvailableGraphWindows,
  filterSnapshotsByWindow,
  hasEnoughGraphHistory,
  GRAPH_WINDOW_MS,
} from "../src/utils/sparkline.js";
import type { GraphWindowKey, Snapshot } from "../src/types/index.js";

function snaps(values: number[]): Snapshot[] {
  return values.map((current, i) => ({ ts: Date.now() + i * 60_000, current }));
}

// ── GraphWindowKey type expansion ────────────────────────────────────────────

describe("GraphWindowKey type", () => {
  it("accepts all 6 window keys: 24h, 3d, 7d, 15d, 1m, all", () => {
    const keys: GraphWindowKey[] = ["24h", "3d", "7d", "15d", "1m", "all"];
    expect(keys).toHaveLength(6);
  });
});

// ── GRAPH_WINDOW_MS constant with all 6 values ──────────────────────────────

describe("GRAPH_WINDOW_MS constant", () => {
  it("has all 6 keys mapped to correct milliseconds", () => {
    expect(GRAPH_WINDOW_MS["24h"]).toBe(86_400_000);
    expect(GRAPH_WINDOW_MS["3d"]).toBe(259_200_000);
    expect(GRAPH_WINDOW_MS["7d"]).toBe(604_800_000);
    expect(GRAPH_WINDOW_MS["15d"]).toBe(1_296_000_000);
    expect(GRAPH_WINDOW_MS["1m"]).toBe(2_592_000_000);
    expect(GRAPH_WINDOW_MS["all"]).toBe(0);
  });

  it("has exactly 6 entries", () => {
    expect(Object.keys(GRAPH_WINDOW_MS)).toHaveLength(6);
  });

  it("24h = 86_400_000 ms", () => {
    expect(GRAPH_WINDOW_MS["24h"]).toBe(24 * 60 * 60 * 1000);
  });

  it("3d = 3 * 24h", () => {
    expect(GRAPH_WINDOW_MS["3d"]).toBe(3 * GRAPH_WINDOW_MS["24h"]);
  });

  it("7d = 7 * 24h", () => {
    expect(GRAPH_WINDOW_MS["7d"]).toBe(7 * GRAPH_WINDOW_MS["24h"]);
  });

  it("15d = 15 * 24h", () => {
    expect(GRAPH_WINDOW_MS["15d"]).toBe(15 * GRAPH_WINDOW_MS["24h"]);
  });

  it("1m = 30 * 24h", () => {
    expect(GRAPH_WINDOW_MS["1m"]).toBe(30 * GRAPH_WINDOW_MS["24h"]);
  });

  it("all = 0 (no time filter sentinel)", () => {
    expect(GRAPH_WINDOW_MS["all"]).toBe(0);
  });
});

// ── filterSnapshotsByWindow with "all" window (windowMs = 0) ────────────────

describe("filterSnapshotsByWindow with windowMs = 0 (all window)", () => {
  it("returns ALL snapshots when windowMs is 0", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 100 * 86_400_000, current: 100 }, // 100 days ago
      { ts: now - 50 * 86_400_000, current: 200 },  // 50 days ago
      { ts: now - 1 * 86_400_000, current: 300 },   // 1 day ago
      { ts: now - 60_000, current: 400 },           // 1 minute ago
    ];
    const result = filterSnapshotsByWindow(data, 0);
    expect(result).toHaveLength(4);
  });

  it("returns snapshots unchanged when windowMs is 0", () => {
    const data = snaps([100, 200, 300]);
    const result = filterSnapshotsByWindow(data, 0);
    expect(result).toEqual(data);
  });
});

// ── filterSnapshotsByWindow with other windows ──────────────────────────────

describe("filterSnapshotsByWindow with non-zero windows", () => {
  it("filters to last 7 days when windowMs = 604_800_000 (7d)", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 10 * 86_400_000, current: 100 }, // 10 days ago (out)
      { ts: now - 6 * 86_400_000, current: 200 },  // 6 days ago (in)
      { ts: now - 3 * 86_400_000, current: 300 },  // 3 days ago (in)
      { ts: now - 60_000, current: 400 },          // 1 minute ago (in)
    ];
    const result = filterSnapshotsByWindow(data, 604_800_000);
    expect(result).toHaveLength(3);
    expect(result[0]?.current).toBe(200);
  });

  it("filters to last 24 hours when windowMs = 86_400_000 (24h)", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 2 * 86_400_000, current: 100 }, // 2 days ago (out)
      { ts: now - 12 * 3_600_000, current: 200 }, // 12 hours ago (in)
      { ts: now - 60_000, current: 300 },         // 1 minute ago (in)
    ];
    const result = filterSnapshotsByWindow(data, 86_400_000);
    expect(result).toHaveLength(2);
  });
});

// ── hasEnoughGraphHistory with "all" window (windowMs = 0) ──────────────────

describe("hasEnoughGraphHistory with windowMs = 0 (all window)", () => {
  it("returns false when fewer than 6 snapshots, regardless of span", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 100 * 86_400_000, current: 1 },
      { ts: now - 50 * 86_400_000, current: 2 },
      { ts: now - 25 * 86_400_000, current: 3 },
      { ts: now - 10 * 86_400_000, current: 4 },
      { ts: now - 1 * 86_400_000, current: 5 }, // only 5 snapshots
    ];
    expect(hasEnoughGraphHistory(data, 0)).toBe(false);
  });

  it("returns true when exactly 6 snapshots exist for 'all' window", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 100_000, current: 1 },
      { ts: now - 80_000, current: 2 },
      { ts: now - 60_000, current: 3 },
      { ts: now - 40_000, current: 4 },
      { ts: now - 20_000, current: 5 },
      { ts: now - 1_000, current: 6 }, // span is only ~100s, but still true for 'all'
    ];
    expect(hasEnoughGraphHistory(data, 0)).toBe(true);
  });

  it("returns true with 6+ snapshots, no span check required for 'all'", () => {
    const now = Date.now();
    const data: Snapshot[] = [
      { ts: now - 300 * 86_400_000, current: 1 }, // 300 days ago
      { ts: now - 200 * 86_400_000, current: 2 },
      { ts: now - 100 * 86_400_000, current: 3 },
      { ts: now - 50 * 86_400_000, current: 4 },
      { ts: now - 10 * 86_400_000, current: 5 },
      { ts: now, current: 6 }, // huge span
    ];
    expect(hasEnoughGraphHistory(data, 0)).toBe(true);
  });
});

// ── hasEnoughGraphHistory with regular windows ──────────────────────────────

describe("hasEnoughGraphHistory with regular windows (non-zero windowMs)", () => {
  it("requires 6+ snapshots AND 75% span for 7d window (604_800_000)", () => {
    const now = Date.now();
    const windowMs = 604_800_000; // 7d

    // 75% of 7d = 5.25d
    const minSpan = windowMs * 0.75; // 453_600_000 ms = 5.25 days

    const data: Snapshot[] = [
      { ts: now - 6 * 86_400_000, current: 1 },
      { ts: now - 5 * 86_400_000, current: 2 },
      { ts: now - 4 * 86_400_000, current: 3 },
      { ts: now - 3 * 86_400_000, current: 4 },
      { ts: now - 2 * 86_400_000, current: 5 },
      { ts: now - 1 * 86_400_000, current: 6 }, // span = 5d, which is < 5.25d
    ];
    expect(hasEnoughGraphHistory(data, windowMs)).toBe(false);

    // Now add one more to push span to 6d > 5.25d
    const dataWithSpan: Snapshot[] = [
      { ts: now - 6.1 * 86_400_000, current: 1 },
      { ts: now - 5 * 86_400_000, current: 2 },
      { ts: now - 4 * 86_400_000, current: 3 },
      { ts: now - 3 * 86_400_000, current: 4 },
      { ts: now - 2 * 86_400_000, current: 5 },
      { ts: now - 0.1 * 86_400_000, current: 6 }, // span ≈ 6d > 5.25d
    ];
    expect(hasEnoughGraphHistory(dataWithSpan, windowMs)).toBe(true);
  });

  it("returns false for 24h window without 75% span", () => {
    const now = Date.now();
    const windowMs = 86_400_000; // 24h
    const minSpan = windowMs * 0.75; // 64_800_000 ms = 18h

    const data: Snapshot[] = [
      { ts: now - 12 * 3_600_000, current: 1 }, // 12h ago
      { ts: now - 10 * 3_600_000, current: 2 },
      { ts: now - 8 * 3_600_000, current: 3 },
      { ts: now - 6 * 3_600_000, current: 4 },
      { ts: now - 4 * 3_600_000, current: 5 },
      { ts: now - 2 * 3_600_000, current: 6 }, // span = 10h < 18h
    ];
    expect(hasEnoughGraphHistory(data, windowMs)).toBe(false);
  });
});

// ── buildAvailableGraphWindows with all 6 windows ──────────────────────────

describe("buildAvailableGraphWindows", () => {
  it("returns all 6 windows when retention is 30+ days", () => {
    const windows = buildAvailableGraphWindows(30);
    const labels = windows.map((w) => w.label);
    expect(labels).toContain("24h");
    expect(labels).toContain("3d");
    expect(labels).toContain("7d");
    expect(labels).toContain("15d");
    expect(labels).toContain("1m");
    expect(labels).toContain("all");
  });

  it("includes only windows that fit within retention (except 'all')", () => {
    // 7 days retention → can include 24h, 3d, 7d, but not 15d, 1m
    const windows = buildAvailableGraphWindows(7);
    const keys = windows.map((w) => w.key);
    expect(keys).toContain("24h");
    expect(keys).toContain("3d");
    expect(keys).toContain("7d");
    expect(keys).not.toContain("15d");
    expect(keys).not.toContain("1m");
    expect(keys).toContain("all"); // always included
  });

  it("always includes the 'all' window", () => {
    expect(buildAvailableGraphWindows(1).some((w) => w.key === "all")).toBe(true);
    expect(buildAvailableGraphWindows(3).some((w) => w.key === "all")).toBe(true);
    expect(buildAvailableGraphWindows(100).some((w) => w.key === "all")).toBe(true);
  });

  it("returns windows in order: 24h, 3d, 7d, 15d, 1m, all", () => {
    const windows = buildAvailableGraphWindows(30);
    const keys = windows.map((w) => w.key);
    const expectedOrder = ["24h", "3d", "7d", "15d", "1m", "all"];
    expect(keys).toEqual(expectedOrder);
  });

  it("filters out 15d when retention is 14 days", () => {
    const windows = buildAvailableGraphWindows(14);
    const keys = windows.map((w) => w.key);
    expect(keys).not.toContain("15d");
    expect(keys).not.toContain("1m");
    expect(keys).toContain("7d");
  });

  it("filters out 1m (30d) when retention is 29 days", () => {
    const windows = buildAvailableGraphWindows(29);
    const keys = windows.map((w) => w.key);
    expect(keys).not.toContain("1m");
    expect(keys).toContain("15d");
  });

  it("includes 1m when retention is exactly 30 days", () => {
    const windows = buildAvailableGraphWindows(30);
    const keys = windows.map((w) => w.key);
    expect(keys).toContain("1m");
  });

  it("builds correct windowMs for each key", () => {
    const windows = buildAvailableGraphWindows(30);
    const map = Object.fromEntries(windows.map((w) => [w.key, w.windowMs]));
    expect(map["24h"]).toBe(86_400_000);
    expect(map["3d"]).toBe(259_200_000);
    expect(map["7d"]).toBe(604_800_000);
    expect(map["15d"]).toBe(1_296_000_000);
    expect(map["1m"]).toBe(2_592_000_000);
    expect(map["all"]).toBe(0);
  });

  it("deduplicates when retention matches a window size (e.g., 3 days)", () => {
    const windows = buildAvailableGraphWindows(3);
    const keys = windows.map((w) => w.key);
    // Should have 24h, 3d, and all — no duplicates
    expect(keys.filter((k) => k === "3d")).toHaveLength(1);
  });
});
