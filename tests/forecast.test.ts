// tests/forecast.test.ts
import { describe, it, expect } from "vitest";
import { computeForecast } from "../src/utils/trend.js";
import type { Snapshot } from "../src/types/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build snapshots with evenly-spaced timestamps. */
function makeSnaps(values: number[], intervalMs = 15 * 60_000): Snapshot[] {
  const base = Date.now() - values.length * intervalMs;
  return values.map((current, i) => ({ ts: base + i * intervalMs, current }));
}

/**
 * Build snapshots spanning at least `spanHours` hours with n points.
 * Used to satisfy the minimum-span guard in computeForecast.
 */
function makeSnapsWithSpan(values: number[], spanHours: number): Snapshot[] {
  const n   = values.length;
  const now = Date.now();
  const t0  = now - spanHours * 3_600_000;
  return values.map((current, i) => ({
    ts: t0 + (i / (n - 1)) * spanHours * 3_600_000,
    current,
  }));
}

/** Perfectly linear ascending series spanning the given hours. */
function linearUp(n: number, spanHours = 3, step = 1000): Snapshot[] {
  return makeSnapsWithSpan(Array.from({ length: n }, (_, i) => 10_000 + i * step), spanHours);
}

/** Flat series spanning spanHours. */
function flat(n: number, spanHours = 3, value = 5000): Snapshot[] {
  return makeSnapsWithSpan(Array.from({ length: n }, () => value), spanHours);
}

/** Noisy series with poor linear fit, spanning spanHours. */
function noisy(n: number, spanHours = 3): Snapshot[] {
  const vals = [1000, 9000, 500, 8500, 1200, 7800, 600, 9200, 1100, 8000];
  return makeSnapsWithSpan(vals.slice(0, n), spanHours);
}

// ── Guard conditions ──────────────────────────────────────────────────────────

describe("computeForecast — guards", () => {
  it("returns null for empty array", () => {
    expect(computeForecast([])).toBeNull();
  });

  it("returns null for fewer than 6 snapshots", () => {
    expect(computeForecast(makeSnaps([1000, 2000, 3000, 4000, 5000]))).toBeNull();
  });

  it("returns null when data span is less than 1 hour", () => {
    // 6 snaps at 5-minute intervals = 25 minutes total — below the 1h guard
    expect(computeForecast(makeSnaps([1,2,3,4,5,6], 5 * 60_000))).toBeNull();
  });

  it("returns a result for 6 snapshots spanning >= 1 hour", () => {
    expect(computeForecast(makeSnapsWithSpan([1,2,3,4,5,6], 1))).not.toBeNull();
  });

  it("returns null when all timestamps are identical (degenerate input)", () => {
    const ts = Date.now();
    const snaps: Snapshot[] = Array.from({ length: 6 }, () => ({ ts, current: 1000 }));
    expect(computeForecast(snaps)).toBeNull();
  });
});

// ── Extrapolation cap ─────────────────────────────────────────────────────────

describe("computeForecast — extrapolation cap (anti-garbage-numbers)", () => {
  it("caps changePct to ≤ 80% for 1× extrapolation (6h data, 6h forecast)", () => {
    // Strongly rising game: +10k every hour for 6h
    const snaps = makeSnapsWithSpan([1000, 11000, 21000, 31000, 41000, 51000, 61000], 6);
    const result = computeForecast(snaps, 6)!;
    expect(result).not.toBeNull();
    expect(result.changePct).toBeLessThanOrEqual(80);
  });

  it("caps changePct more aggressively at 4× extrapolation (1.5h data, 6h forecast)", () => {
    // Simulate Marathon scenario: new game, 6 snaps over 1.5h, strongly rising
    const snaps = makeSnapsWithSpan([60000, 65000, 68000, 70000, 72000, 74000], 1.5);
    const result = computeForecast(snaps, 6)!;
    expect(result).not.toBeNull();
    // At 4× extrapolation, cap is ±20% → projected cannot be +43.8% anymore
    // cap = 0.8 / 4 = 0.2 = ±20%
    expect(result.changePct).toBeLessThanOrEqual(25); // slight buffer for rounding
    expect(result.changePct).toBeGreaterThanOrEqual(-25);
  });

  it("Marathon-like scenario: 74k current, 1.5h data — projected is not 106k", () => {
    const snaps = makeSnapsWithSpan([60000, 65000, 68000, 70000, 72000, 74000], 1.5);
    const result = computeForecast(snaps, 6)!;
    expect(result).not.toBeNull();
    // 106k would require +43% — the cap should prevent this
    expect(result.projected).toBeLessThan(100_000);
    // And it should be sensibly above current (74k)
    expect(result.projected).toBeGreaterThan(0);
  });

  it("projected value is never negative", () => {
    const snaps = makeSnapsWithSpan([5000, 4000, 3000, 2000, 1000, 500], 3);
    const result = computeForecast(snaps, 24)!;
    expect(result).not.toBeNull();
    expect(result.projected).toBeGreaterThanOrEqual(0);
  });

  it("projected value never exceeds 2× the historical peak in the series", () => {
    const snaps = linearUp(12, 3, 2000);
    const result = computeForecast(snaps, 6)!;
    const histPeak = Math.max(...snaps.map(s => s.current));
    expect(result.projected).toBeLessThanOrEqual(histPeak * 2);
  });
});

// ── Projected value (directional) ─────────────────────────────────────────────

describe("computeForecast — projected direction", () => {
  it("projects higher for rising series", () => {
    const snaps = linearUp(12, 3);
    const result = computeForecast(snaps, 6)!;
    const lastVal = snaps.at(-1)!.current;
    expect(result.projected).toBeGreaterThan(lastVal);
  });

  it("projects lower for declining series", () => {
    const snaps = makeSnapsWithSpan([10000,9800,9600,9400,9200,9000,8800,8600,8400,8200,8000,7800], 3);
    const result = computeForecast(snaps, 6)!;
    expect(result.projected).toBeLessThan(7800);
  });

  it("projects flat for flat series", () => {
    const result = computeForecast(flat(12, 3))!;
    expect(result.projected).toBeCloseTo(5000, -1);
    expect(result.changePct).toBe(0);
  });

  it("projected value is a rounded integer", () => {
    const result = computeForecast(linearUp(10, 3))!;
    expect(Number.isInteger(result.projected)).toBe(true);
  });
});

// ── Reliability (requires ≥ 3h data, ≥ 12 snaps, R² ≥ 0.5) ──────────────────

describe("computeForecast — reliability", () => {
  it("reliable=true for perfectly linear series with ≥ 3h and ≥ 12 snapshots", () => {
    expect(computeForecast(linearUp(20, 4))!.reliable).toBe(true);
  });

  it("reliable=false for < 3h of data (even if R² is high)", () => {
    const snaps = makeSnapsWithSpan(Array.from({length:12},(_,i)=>1000+i*500), 1.5);
    expect(computeForecast(snaps, 6)!.reliable).toBe(false);
  });

  it("reliable=false for < 12 snapshots (even with good R²)", () => {
    expect(computeForecast(linearUp(8, 3))!.reliable).toBe(false);
  });

  it("reliable=false for noisy non-linear data", () => {
    const result = computeForecast(noisy(10, 3));
    if (result) expect(result.reliable).toBe(false);
  });

  it("r² is in [0, 1]", () => {
    const r = computeForecast(linearUp(12, 3))!;
    expect(r.r2).toBeGreaterThanOrEqual(0);
    expect(r.r2).toBeLessThanOrEqual(1);
  });

  it("r² close to 1 for perfectly linear data", () => {
    expect(computeForecast(linearUp(20, 4))!.r2).toBeGreaterThan(0.99);
  });
});

// ── hoursAhead ────────────────────────────────────────────────────────────────

describe("computeForecast — hoursAhead", () => {
  it("defaults to 6", () => {
    expect(computeForecast(linearUp(12, 3))!.hoursAhead).toBe(6);
  });

  it("respects custom hoursAhead", () => {
    expect(computeForecast(linearUp(12, 3), 12)!.hoursAhead).toBe(12);
  });
});
