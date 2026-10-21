// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { freshnessTitle, populatePanel, renderSparkline } from "../src/popup/graphs.js";
import { buildCardViewModel } from "../src/utils/card.js";

const now = Date.UTC(2026, 8, 11, 12);
const options = { width: 372, height: 56, maxPoints: 200, now };

describe("popup graphs", () => {
  it("preserves all live data tiles and labels extrema by selected period", () => {
    const snaps = Array.from({ length: 73 }, (_, index) => ({ ts: now - index * 3_600_000,
      current: 100, source: "steamcharts" as const, granularity: "hourly" as const }));
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, now));
    expect(Array.from(panel.querySelectorAll(".panel-stats:not(.period-stats) dt"), (item) => item.textContent)).toEqual(["Current", "24h peak", "Observed peak", "Twitch viewers"]);
    panel.querySelector<HTMLButtonElement>('[data-window="3d"]')?.click();
    expect(panel.querySelector(".period-stats")?.textContent).toContain("3d minimum");
    expect(panel.querySelector(".period-stats")?.textContent).toContain("3d maximum");
  });

  it("includes the first hour of a fixed window and ignores single-sample outliers in extrema", () => {
    const evaluatedAt = now + 30 * 60_000;
    const snaps = [
      ...Array.from({ length: 48 }, (_, index) => ({ ts: now - (48 - index) * 3_600_000,
        current: index, source: "steamcharts" as const, granularity: "hourly" as const })),
      { ts: now - 3 * 3_600_000 + 60_000, current: 1, source: "steam" as const, granularity: "instant" as const },
    ];
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, evaluatedAt));
    panel.querySelector<HTMLButtonElement>('[data-window="24h"]')?.click();
    // Hours 24..47 → average 35.5, change 47 - 24, min/max from hourly series only.
    expect(Array.from(panel.querySelectorAll(".period-stats dd"), (item) => item.textContent)).toEqual(["36", "+23", "24", "47"]);
  });

  it("computes All statistics when observation timestamps are offset within the hour", () => {
    const evaluatedAt = now + 57 * 60_000;
    const snaps = Array.from({ length: 73 }, (_, index) => ({ ts: now - (73 - index) * 3_600_000 + 48 * 60_000,
      current: 100, source: "games-popularity" as const, granularity: "hourly" as const }));
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, evaluatedAt));
    panel.querySelector<HTMLButtonElement>('[data-window="all"]')?.click();
    expect(Array.from(panel.querySelectorAll(".period-stats dd"), (item) => item.textContent)).toEqual(["100", "0", "100", "100"]);
    expect(panel.querySelector(".period-stats")?.getAttribute("title")).toContain("Games Popularity");
  });

  it("summarizes available All hours despite a recent gap while fixed periods remain strict", () => {
    const snaps = Array.from({ length: 60 * 24 }, (_, index) => ({ ts: now - (60 * 24 - index) * 3_600_000,
      current: index, source: "games-popularity" as const, granularity: "hourly" as const }))
      .filter((point) => point.ts < now - 16 * 3_600_000);
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "3751950", name: "Black Flag", image: "" }, {}, snaps, 60, now));
    panel.querySelector<HTMLButtonElement>('[data-window="all"]')?.click();
    const values = panel.querySelectorAll(".period-stats dd");
    expect(values[0]?.textContent).toBe("712");
    expect(values[1]?.textContent).toBe("+1.4k");
    for (const value of [values[0], values[1]]) {
      expect(value?.getAttribute("title")).toContain("observed hours");
      expect(value?.getAttribute("title")).toContain("Missing hours excluded");
      expect(value?.getAttribute("title")).toContain(new Date(snaps[0]!.ts).toISOString());
      expect(value?.getAttribute("title")).toContain(new Date(snaps.at(-1)!.ts).toISOString());
    }
    panel.querySelector<HTMLButtonElement>('[data-window="24h"]')?.click();
    expect(Array.from(panel.querySelectorAll(".period-stats dd"), (value) => value.textContent).slice(0, 2)).toEqual(["—", "—"]);
  });

  it.each([1, 2])("withholds All averages and changes for sparse history with %i observations", (count) => {
    const snaps = Array.from({ length: count }, (_, index) => ({ ts: now - (100 - index * 90) * 3_600_000,
      current: 100 + index, source: "games-popularity" as const, granularity: "hourly" as const }));
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, now));
    panel.querySelector<HTMLButtonElement>('[data-window="all"]')?.click();
    expect(Array.from(panel.querySelectorAll(".period-stats dd"), (value) => value.textContent).slice(0, 2)).toEqual(["—", "—"]);
  });

  it("averages observed completed hours at 80% coverage without treating gaps as zero", () => {
    const snaps = [5, 4, 2, 1, 0].map((hours, index) => ({ ts: now - hours * 3_600_000,
      current: hours === 0 ? 10000 : (index + 1) * 10,
      source: "games-popularity" as const, granularity: "hourly" as const }));
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, now));
    panel.querySelector<HTMLButtonElement>('[data-window="all"]')?.click();
    expect(Array.from(panel.querySelectorAll(".period-stats dd"), (value) => value.textContent).slice(0, 2)).toEqual(["25", "+30"]);
  });

  it("renders every selected period for gapped history without showing explanatory blocks", () => {
    const snaps = Array.from({ length: 60 * 24 }, (_, index) => ({ ts: now - (index + 1) * 3_600_000,
      current: 3000 + index, source: "games-popularity" as const, granularity: "hourly" as const }))
      .filter((point) => point.ts < now - 16 * 3_600_000);
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "3751950", name: "Black Flag", image: "" }, {}, snaps, 60, now));
    for (const key of ["24h", "3d", "7d", "15d", "1m", "all"]) {
      const button = panel.querySelector<HTMLButtonElement>(`[data-window="${key}"]`);
      expect(button?.disabled).toBe(false);
      button?.click();
      expect(button?.getAttribute("aria-pressed")).toBe("true");
      expect(panel.querySelector(".panel-sparkline svg")).not.toBeNull();
      expect(panel.querySelectorAll(".panel-stat")).toHaveLength(8);
      expect(panel.querySelector(".period-stats")?.textContent).toContain(`${key === "all" ? "All" : key} minimum`);
      expect(panel.querySelector(".history-notice, .weekly-comparison, .early-activity, .panel-record-low")).toBeNull();
    }
  });

  it("keeps early-history explanations out of the visible panel", () => {
    const snaps = Array.from({ length: 48 }, (_, index) => ({ ts: now - (48 - index) * 3_600_000,
      current: index < 24 ? 100 : 80, source: "steamcharts" as const, granularity: "hourly" as const }));
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, now));
    expect(panel.querySelector(".early-activity, .history-notice, .panel-record-low")).toBeNull();
    expect(panel.querySelectorAll(".panel-stat")).toHaveLength(8);
  });
  it("keeps weekly comparison prose out of the panel when changing periods", () => {
    const snaps = Array.from({ length: 14 * 24 }, (_, index) => ({ ts: now - (14 * 24 - index) * 3_600_000,
      current: index >= 7 * 24 ? 80 : 100, source: "steamcharts" as const, granularity: "hourly" as const }));
    const panel = document.createElement("div");
    populatePanel(panel, buildCardViewModel({ appid: "1", name: "Game", image: "" }, {}, snaps, 60, now));
    panel.querySelector<HTMLButtonElement>('[data-window="3d"]')?.click();
    expect(panel.querySelectorAll(".weekly-comparison, .panel-record-low, .history-notice")).toHaveLength(0);
    expect(panel.querySelector(".period-stats")?.textContent).toContain("3d average");
  });
  it("colors individual rises and falls independently of the overall stroke", () => {
    const result = renderSparkline([100, 105, 102, 103].map((current, index) => ({
      ts: now - (3 - index) * 3_600_000, current, source: "steamcharts", granularity: "hourly",
    })), options);
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
