// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { freshnessTitle, populatePanel, renderSparkline } from "../src/popup/graphs.js";
import { buildCardViewModel } from "../src/utils/card.js";

const now = Date.UTC(2026, 8, 11, 12);
const options = { width: 372, height: 56, maxPoints: 200, strokeColor: "#00c8ff", now };

describe("popup graphs", () => {
  it("labels a short-history comparison as preliminary and exposes its limits", () => {
    const snaps = Array.from({ length: 48 }, (_, index) => ({ ts: now - (48 - index) * 3_600_000,
      current: index < 24 ? 100 : 80, source: "steamcharts" as const, granularity: "hourly" as const }));
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, now));
    expect(panel.querySelector(".early-activity")?.textContent).toContain("24h vs previous 24h: -20% · preliminary");
    expect(panel.querySelector(".early-activity")?.textContent).toContain("does not trigger trend alerts");
  });
  it("shows matched averages and the fixed weekly comparison independently of the selected graph period", () => {
    const snaps = Array.from({ length: 14 * 24 }, (_, index) => ({ ts: now - (14 * 24 - index) * 3_600_000,
      current: index >= 7 * 24 ? 80 : 100, source: "steamcharts" as const, granularity: "hourly" as const }));
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, now));
    expect(panel.querySelector(".weekly-comparison")?.textContent).toContain("7d vs previous 7d: -20%");
    expect(panel.querySelector(".weekly-comparison")?.textContent).toContain("80 average players vs 100");
    panel.querySelector<HTMLButtonElement>('[data-window="3d"]')?.click();
    expect(panel.querySelectorAll(".weekly-comparison")).toHaveLength(1);
    expect(panel.querySelector(".weekly-comparison")?.textContent).toContain("168/168 matched hours");
  });
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
