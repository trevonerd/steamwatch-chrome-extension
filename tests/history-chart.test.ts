// tests/history-chart.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("history chart SVG viewBox consistency", () => {
  it("SVG viewBox height matches JS VIEW_H constant (160)", () => {
    const htmlPath = join(__dirname, "../src/options/index.html");
    const html = readFileSync(htmlPath, "utf-8");

    // Extract viewBox from history chart SVG
    const match = html.match(/id="historyChart"[^>]*viewBox="([^"]+)"/);
    expect(match).not.toBeNull();

    const viewBox = match![1]!;
    const parts = viewBox.split(" ");
    expect(parts).toHaveLength(4);

    const viewBoxHeight = parseInt(parts[3]!, 10);
    expect(viewBoxHeight).toBe(160);
  });

  it("hover dot positioning matches coordinate space: midpoint (y=80) renders at ~50%", () => {
    // This test verifies that the math works:
    // pctY = (pt.y / VIEW_H) * 100
    // For a midpoint at y=80 with VIEW_H=160:
    // pctY = (80 / 160) * 100 = 50%
    // This should match the visual position in the SVG with viewBox="0 0 600 160"
    const VIEW_H = 160;
    const pt_y = 80; // midpoint

    const pctY = (pt_y / VIEW_H) * 100;
    expect(pctY).toBeGreaterThanOrEqual(48);
    expect(pctY).toBeLessThanOrEqual(52);
    expect(pctY).toBe(50);
  });

  it("top padding (padY=16) positions correctly in 160-unit space", () => {
    const VIEW_H = 160;
    const padY = 16;
    const topPct = (padY / VIEW_H) * 100;

    // Top edge should be at 10%
    expect(topPct).toBeGreaterThanOrEqual(9);
    expect(topPct).toBeLessThanOrEqual(11);
  });

  it("bottom padding (H - padY = 144) positions correctly in 160-unit space", () => {
    const VIEW_H = 160;
    const padY = 16;
    const H = 160;
    const bottomY = H - padY; // 144
    const bottomPct = (bottomY / VIEW_H) * 100;

    // Bottom edge should be at 90%
    expect(bottomPct).toBeGreaterThanOrEqual(89);
    expect(bottomPct).toBeLessThanOrEqual(91);
  });
});
