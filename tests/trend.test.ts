// tests/trend.test.ts
import { describe, it, expect } from "vitest";
import {
  computeTrend,
  compute24hAvg,
  compute24hGain,
  computeRetentionAvg,
  computeRetentionGain,
  computeLocalPeak,
  computeWindowMin,
  fmtNumber,
  fmtPct,
  fmtTimeAgo,
} from "../src/utils/trend.js";
import type { Snapshot } from "../src/types/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build N snapshots spaced `intervalMs` apart, ending at Date.now().
 * Default interval is 30 minutes (default fetch interval).
 */
function makeSnaps(values: number[], intervalMs = 30 * 60_000): Snapshot[] {
  const base = Date.now() - (values.length - 1) * intervalMs;
  return values.map((current, i) => ({ ts: base + i * intervalMs, current }));
}

/**
 * Build snapshots that span `totalHours` hours, evenly distributed.
 * Useful for explicit time-window tests.
 */
function makeSnapsOverHours(values: number[], totalHours: number): Snapshot[] {
  const totalMs = totalHours * 3_600_000;
  const base = Date.now() - totalMs;
  const step = values.length > 1 ? totalMs / (values.length - 1) : 0;
  return values.map((current, i) => ({ ts: base + i * step, current }));
}

// ── computeTrend ─────────────────────────────────────────────────────────────

describe("computeTrend", () => {
  it("returns null when fewer than 6 snapshots", () => {
    expect(computeTrend(makeSnaps([1000, 2000, 3000, 4000, 5000]))).toBeNull();
  });

  it("returns null when older-half average is zero", () => {
    // All zeros in older half → division by zero guard
    const snaps = makeSnapsOverHours([0, 0, 0, 1000, 2000, 3000], 6);
    expect(computeTrend(snaps)).toBeNull();
  });

  it("detects EXPLOSION: sudden spike from stable base (30 → 50 000)", () => {
    // Game stable at ~30, then explodes to 50 000 in recent half
    const snaps = makeSnapsOverHours([30, 28, 32, 30, 49000, 50000, 51000], 6);
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.level.key).toBe("EXPLOSION");
    expect(result!.pct).toBeGreaterThan(50);
  });

  it("detects EXPLOSION: gradual strong doubling over 24h", () => {
    // older half avg ~1000, recent half avg ~2000 → +100%
    const snaps = makeSnapsOverHours([900, 950, 1000, 1050, 1800, 2000, 2200], 24);
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.level.key).toBe("EXPLOSION");
    expect(result!.pct).toBeGreaterThan(50);
  });

  it("detects STRONG_UP: ~30% increase over full window", () => {
    // older half avg ~1000, recent half avg ~1300 → +30%
    const snaps = makeSnapsOverHours([950, 1000, 1050, 1250, 1300, 1350], 12);
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.level.key).toBe("STRONG_UP");
  });

  it("detects UP: ~10% increase over full window", () => {
    // older half avg ~1000, recent half avg ~1100 → +10%
    const snaps = makeSnapsOverHours([950, 1000, 1050, 1080, 1100, 1120], 12);
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.level.key).toBe("UP");
  });

  it("detects STABLE: flat over full window", () => {
    const snaps = makeSnapsOverHours([1000, 1000, 1000, 1010, 1000, 990], 12);
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.level.key).toBe("STABLE");
  });

  it("detects DOWN: ~12% decline over full window", () => {
    // older half avg ~1000, recent half avg ~880 → -12%
    const snaps = makeSnapsOverHours([1000, 1000, 1000, 900, 880, 860], 12);
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.level.key).toBe("DOWN");
  });

  it("detects STRONG_DOWN: ~40% decline over full window", () => {
    // older half avg ~1000, recent half avg ~600 → -40%
    const snaps = makeSnapsOverHours([1000, 1000, 1000, 620, 600, 580], 12);
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.level.key).toBe("STRONG_DOWN");
  });

  it("correctly shows STRONG_DOWN for collapsed game (peak 41 → current 8)", () => {
    // Reproduces the real bug: game peaked at 41 earlier, now sitting at ~8.
    // Old logic saw 5→8 in the last 6 snaps and reported +60% EXPLOSION.
    // New logic sees the full 24h trajectory and correctly reports a collapse.
    const snaps = makeSnapsOverHours(
      [38, 41, 35, 20, 12, 10, 8, 7, 8, 6, 8, 8],
      24,
    );
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    // Older half avg ~31, recent half avg ~8 → roughly -74% → STRONG_DOWN
    expect(result!.pct).toBeLessThan(-20);
    expect(["STRONG_DOWN", "DOWN"].includes(result!.level.key)).toBe(true);
  });

  it("does NOT show a rise when recent micro-fluctuation is up but overall trend is down", () => {
    // Game collapsed from 1000 to 100, last two readings went 95→105 (micro +10%).
    // Old logic: +10% → UP. New logic: overall down → DOWN or STRONG_DOWN.
    const snaps = makeSnapsOverHours(
      [1000, 950, 800, 600, 400, 200, 120, 95, 100, 105],
      24,
    );
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.pct).toBeLessThan(0);
  });

  it("rounds pct to 1 decimal", () => {
    const snaps = makeSnapsOverHours([1000, 1000, 1000, 1100, 1100, 1100], 12);
    const result = computeTrend(snaps);
    expect(result).not.toBeNull();
    expect(result!.pct).toBe(10);
  });

  it("computes correct delta", () => {
    const snaps = makeSnapsOverHours([1000, 1000, 1000, 1100, 1100, 1100], 12);
    const result = computeTrend(snaps);
    expect(result!.delta).toBe(100);
  });

  it("uses 24h window and ignores older snapshots beyond 24h", () => {
    // Very old snaps with high values — should be excluded from computation.
    // Within 24h the game is stable at ~1000, so trend should be STABLE.
    const old = makeSnapsOverHours([50000, 50000, 50000], 48).map((s) => ({
      ...s,
      ts: s.ts - 86_400_000 * 2, // push 2 extra days back
    }));
    const recent = makeSnapsOverHours([1000, 1000, 1000, 1000, 1000, 1000], 20);
    const result = computeTrend([...old, ...recent]);
    expect(result).not.toBeNull();
    expect(result!.level.key).toBe("STABLE");
  });
});

// ── compute24hAvg ─────────────────────────────────────────────────────────────

describe("compute24hAvg", () => {
  it("returns null for empty array", () => {
    expect(compute24hAvg([])).toBeNull();
  });

  it("returns null when all snapshots are older than 24h", () => {
    const old = [{ ts: Date.now() - 90_000_000, current: 5000 }];
    expect(compute24hAvg(old)).toBeNull();
  });

  it("returns null with too few recent snapshots", () => {
    const snaps: Snapshot[] = [
      { ts: Date.now() - 23 * 3_600_000, current: 1000 },
      { ts: Date.now() - 12 * 3_600_000, current: 2000 },
    ];
    expect(compute24hAvg(snaps)).toBeNull();
  });

  it("returns null when snapshots do not cover a near-full 24h window", () => {
    const now = Date.now();
    const snaps: Snapshot[] = [
      { ts: now - 10 * 3_600_000, current: 1000 },
      { ts: now - 8 * 3_600_000, current: 1200 },
      { ts: now - 6 * 3_600_000, current: 1100 },
      { ts: now - 4 * 3_600_000, current: 1150 },
      { ts: now - 2 * 3_600_000, current: 1180 },
      { ts: now - 30 * 60_000, current: 1190 },
    ];
    expect(compute24hAvg(snaps)).toBeNull();
  });

  it("averages snapshots across a near-full 24h window, excluding >24h old", () => {
    const now = Date.now();
    const snaps: Snapshot[] = [
      { ts: now - 90_000_000,  current: 9999 }, // > 24h, excluded
      { ts: now - 23.5 * 3_600_000, current: 1000 },
      { ts: now - 20 * 3_600_000, current: 2000 },
      { ts: now - 16 * 3_600_000, current: 1000 },
      { ts: now - 12 * 3_600_000, current: 1400 },
      { ts: now - 6 * 3_600_000, current: 1600 },
      { ts: now - 10 * 60_000, current: 1200 },
    ];
    expect(compute24hAvg(snaps)).toBe(Math.round((1000 + 2000 + 1000 + 1400 + 1600 + 1200) / 6));
  });

  it("rounds to integer", () => {
    const now = Date.now();
    const snaps: Snapshot[] = [
      { ts: now - 23.8 * 3_600_000, current: 1001 },
      { ts: now - 20 * 3_600_000, current: 1002 },
      { ts: now - 16 * 3_600_000, current: 1003 },
      { ts: now - 12 * 3_600_000, current: 1004 },
      { ts: now - 8 * 3_600_000, current: 1005 },
      { ts: now - 5 * 60_000, current: 1006 },
    ];
    expect(Number.isInteger(compute24hAvg(snaps))).toBe(true);
  });
});

describe("compute24hGain", () => {
  it("returns null when there is not enough reliable 24h coverage", () => {
    const snaps: Snapshot[] = [
      { ts: Date.now() - 10 * 3_600_000, current: 1000 },
      { ts: Date.now() - 5 * 3_600_000, current: 1300 },
      { ts: Date.now() - 60_000, current: 1400 },
    ];
    expect(compute24hGain(snaps)).toBeNull();
  });

  it("returns the delta from the oldest to latest reliable 24h snapshot", () => {
    const now = Date.now();
    const snaps: Snapshot[] = [
      { ts: now - 23.5 * 3_600_000, current: 1000 },
      { ts: now - 20 * 3_600_000, current: 1100 },
      { ts: now - 16 * 3_600_000, current: 1200 },
      { ts: now - 12 * 3_600_000, current: 1300 },
      { ts: now - 8 * 3_600_000, current: 1400 },
      { ts: now - 5 * 60_000, current: 1600 },
    ];
    expect(compute24hGain(snaps)).toBe(600);
  });
});

describe("computeRetentionAvg", () => {
  it("returns null without reliable full-window coverage", () => {
    const now = Date.now();
    const snaps: Snapshot[] = [
      { ts: now - 40 * 60_000, current: 1000 },
      { ts: now - 20 * 60_000, current: 1100 },
      { ts: now - 5 * 60_000, current: 1200 },
      { ts: now - 4 * 60_000, current: 1300 },
      { ts: now - 3 * 60_000, current: 1400 },
      { ts: now - 2 * 60_000, current: 1500 },
    ];
    expect(computeRetentionAvg(snaps, 3)).toBeNull();
  });

  it("computes an average across the configured retention window", () => {
    const now = Date.now();
    const snaps: Snapshot[] = [
      { ts: now - 2.95 * 86_400_000, current: 1000 },
      { ts: now - 2.4 * 86_400_000, current: 1200 },
      { ts: now - 1.8 * 86_400_000, current: 1400 },
      { ts: now - 1.2 * 86_400_000, current: 1600 },
      { ts: now - 0.6 * 86_400_000, current: 1800 },
      { ts: now - 10 * 60_000, current: 2000 },
    ];
    expect(computeRetentionAvg(snaps, 3)).toBe(1500);
  });
});

describe("computeRetentionGain", () => {
  it("returns the delta across the configured retention window", () => {
    const now = Date.now();
    const snaps: Snapshot[] = [
      { ts: now - 6.8 * 86_400_000, current: 500 },
      { ts: now - 5.2 * 86_400_000, current: 700 },
      { ts: now - 3.8 * 86_400_000, current: 900 },
      { ts: now - 2.2 * 86_400_000, current: 1100 },
      { ts: now - 1.1 * 86_400_000, current: 1300 },
      { ts: now - 10 * 60_000, current: 1500 },
    ];
    expect(computeRetentionGain(snaps, 7)).toBe(1000);
  });
});

// ── computeLocalPeak ──────────────────────────────────────────────────────────

describe("computeLocalPeak", () => {
  it("returns null for empty array", () => {
    expect(computeLocalPeak([])).toBeNull();
  });

  it("returns the maximum value", () => {
    expect(computeLocalPeak(makeSnaps([500, 9000, 3000, 1000]))).toBe(9000);
  });

  it("handles single snapshot", () => {
    expect(computeLocalPeak(makeSnaps([42]))).toBe(42);
  });
});

// ── fmtNumber ─────────────────────────────────────────────────────────────────

describe("fmtNumber", () => {
  it("returns dash for null", () => {
    expect(fmtNumber(null)).toBe("—");
  });

  it("returns dash for undefined", () => {
    expect(fmtNumber(undefined)).toBe("—");
  });

  it("formats millions with 2 decimals", () => {
    expect(fmtNumber(1_500_000)).toBe("1.50M");
  });

  it("formats thousands with 1 decimal", () => {
    expect(fmtNumber(45_300)).toBe("45.3k");
  });

  it("formats small numbers without suffix", () => {
    expect(fmtNumber(999)).toBe("999");
  });

  it("formats exactly 1000 as 1.0k", () => {
    expect(fmtNumber(1000)).toBe("1.0k");
  });

  it("formats zero", () => {
    expect(fmtNumber(0)).toBe("0");
  });
});

// ── fmtPct ────────────────────────────────────────────────────────────────────

describe("fmtPct", () => {
  it("prefixes positive with +", () => {
    expect(fmtPct(30)).toBe("+30%");
  });

  it("does not double-sign negative", () => {
    expect(fmtPct(-15)).toBe("-15%");
  });

  it("handles zero", () => {
    expect(fmtPct(0)).toBe("+0%");
  });
});

// ── fmtTimeAgo ────────────────────────────────────────────────────────────────

describe("fmtTimeAgo", () => {
  it("returns 'just now' for recent timestamp", () => {
    expect(fmtTimeAgo(Date.now() - 10_000)).toBe("just now");
  });

  it("returns minutes ago", () => {
    expect(fmtTimeAgo(Date.now() - 5 * 60_000)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    expect(fmtTimeAgo(Date.now() - 3 * 3600_000)).toBe("3h ago");
  });

  it("returns singular hour", () => {
    expect(fmtTimeAgo(Date.now() - 3600_000)).toBe("1h ago");
  });
});

// ── computeWindowMin ──────────────────────────────────────────────────────────

describe("computeWindowMin", () => {
  it("returns null for empty array", () => {
    expect(computeWindowMin([])).toBeNull();
  });

  it("returns the single snapshot as minimum", () => {
    expect(computeWindowMin([{ ts: 1000, current: 50 }])).toEqual({ value: 50, timestamp: 1000 });
  });

  it("returns the snapshot with minimum current value", () => {
    const snaps = [
      { ts: 1000, current: 100 },
      { ts: 2000, current: 30 },
      { ts: 3000, current: 80 },
    ];
    expect(computeWindowMin(snaps)).toEqual({ value: 30, timestamp: 2000 });
  });

  it("returns first occurrence when all values are equal", () => {
    const snaps = [
      { ts: 1000, current: 50 },
      { ts: 2000, current: 50 },
    ];
    expect(computeWindowMin(snaps)).toEqual({ value: 50, timestamp: 1000 });
  });

  it("filters out zero in mixed zero+non-zero array (the core fix)", () => {
    const snaps = [
      { ts: 1000, current: 100 },
      { ts: 2000, current: 0 },
      { ts: 3000, current: 25 },
    ];
    // The zero is filtered out because non-zero values exist
    expect(computeWindowMin(snaps)).toEqual({ value: 25, timestamp: 3000 });
  });

  it("finds min across 10 snapshots", () => {
    const snaps = Array.from({ length: 10 }, (_, i) => ({ ts: i * 1000, current: i === 5 ? 1 : 100 }));
    expect(computeWindowMin(snaps)).toEqual({ value: 1, timestamp: 5000 });
  });

  // ── New tests for zero-filtering behavior ──────────────────────────────────
  
  it("excludes zero-player snapshots when at least one non-zero exists", () => {
    const snaps = [
      { ts: 1000, current: 0 },    // failed fetch
      { ts: 2000, current: 500 },  // real data
      { ts: 3000, current: 300 },  // real data
    ];
    expect(computeWindowMin(snaps)).toEqual({ value: 300, timestamp: 3000 });
  });

  it("returns zero value when ALL snapshots are zero (dead game)", () => {
    const snaps = [
      { ts: 1000, current: 0 },
      { ts: 2000, current: 0 },
      { ts: 3000, current: 0 },
    ];
    expect(computeWindowMin(snaps)).toEqual({ value: 0, timestamp: 1000 });
  });

  it("ignores zeros in a mixed array with more complex data", () => {
    const snaps = [
      { ts: 1000, current: 0 },
      { ts: 2000, current: 1000 },
      { ts: 3000, current: 0 },
      { ts: 4000, current: 250 },
      { ts: 5000, current: 0 },
      { ts: 6000, current: 500 },
    ];
    expect(computeWindowMin(snaps)).toEqual({ value: 250, timestamp: 4000 });
  });

  it("handles single zero snapshot (dead game with only one reading)", () => {
    const snaps = [{ ts: 1000, current: 0 }];
    expect(computeWindowMin(snaps)).toEqual({ value: 0, timestamp: 1000 });
  });

  it("handles single non-zero snapshot (unchanged behavior)", () => {
    const snaps = [{ ts: 1000, current: 500 }];
    expect(computeWindowMin(snaps)).toEqual({ value: 500, timestamp: 1000 });
  });

  it("uses zero when it is the true minimum in an all-nonzero array", () => {
    // This is already tested above, but being explicit: if no zeros exist, behavior unchanged
    const snaps = [
      { ts: 1000, current: 100 },
      { ts: 2000, current: 50 },
      { ts: 3000, current: 75 },
    ];
    expect(computeWindowMin(snaps)).toEqual({ value: 50, timestamp: 2000 });
  });
});

// ── fmtBadge ─────────────────────────────────────────────────────────────────

import { fmtBadge } from "../src/utils/trend.js";

describe("fmtBadge", () => {
  it("formats millions with 1 decimal", () => {
    expect(fmtBadge(1_234_567)).toBe("1.2M");
    expect(fmtBadge(1_000_000)).toBe("1.0M");
  });

  it("formats tens of thousands as integer k", () => {
    expect(fmtBadge(42_000)).toBe("42k");
    expect(fmtBadge(10_000)).toBe("10k");
    expect(fmtBadge(99_500)).toBe("100k");
  });

  it("formats thousands with 1 decimal k", () => {
    expect(fmtBadge(1_200)).toBe("1.2k");
    expect(fmtBadge(1_000)).toBe("1.0k");
    expect(fmtBadge(9_999)).toBe("10.0k");
  });

  it("formats sub-thousand as plain number", () => {
    expect(fmtBadge(999)).toBe("999");
    expect(fmtBadge(0)).toBe("0");
    expect(fmtBadge(1)).toBe("1");
  });
});
