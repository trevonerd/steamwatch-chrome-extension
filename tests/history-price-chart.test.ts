// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { filterPriceRecordsByWindow, downsamplePriceRecords } from "../src/utils/sparkline.js";
import type { PriceRecord } from "../src/types/index.js";

// Helper to build mock PriceRecord array
function makePriceRecords(count: number, spanMs: number): PriceRecord[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: now - spanMs + (i / (count - 1)) * spanMs,
    priceAmountInt: 2499 + Math.round(Math.sin(i) * 500), // vary price
    regularAmountInt: 2999,
    cut: 0,
    shop: "steam",
  }));
}

describe("filterPriceRecordsByWindow", () => {
  it("returns all records when windowMs === 0", () => {
    const records = makePriceRecords(10, 30 * 86_400_000);
    expect(filterPriceRecordsByWindow(records, 0)).toHaveLength(10);
  });

  it("returns only records within the window", () => {
    const records = makePriceRecords(30, 30 * 86_400_000); // 30 days of data
    const sevenDayMs = 7 * 86_400_000;
    const filtered = filterPriceRecordsByWindow(records, sevenDayMs);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(records.length);
    const cutoff = Date.now() - sevenDayMs;
    filtered.forEach((r) => expect(r.timestamp).toBeGreaterThanOrEqual(cutoff));
  });

  it("returns empty array when no records match window", () => {
    const oldRecords: PriceRecord[] = [{
      timestamp: Date.now() - 60 * 86_400_000, // 60 days old
      priceAmountInt: 1999,
      regularAmountInt: 1999,
      cut: 0,
      shop: "steam",
    }];
    const sevenDayMs = 7 * 86_400_000;
    expect(filterPriceRecordsByWindow(oldRecords, sevenDayMs)).toHaveLength(0);
  });
});

describe("downsamplePriceRecords", () => {
  it("returns records unchanged when count <= maxPoints", () => {
    const records = makePriceRecords(5, 86_400_000);
    expect(downsamplePriceRecords(records, 50)).toHaveLength(5);
  });

  it("downsamples to at most maxPoints records", () => {
    const records = makePriceRecords(200, 30 * 86_400_000);
    const result = downsamplePriceRecords(records, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("preserves first and last records", () => {
    const records = makePriceRecords(100, 30 * 86_400_000);
    const result = downsamplePriceRecords(records, 10);
    expect(result[0]!.timestamp).toBe(records[0]!.timestamp);
    expect(result[result.length - 1]!.timestamp).toBe(records[99]!.timestamp);
  });
});
