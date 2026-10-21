import { describe, expect, it } from "vitest";
import { buildCardViewModel } from "../src/utils/card.js";
import type { Snapshot } from "../src/types/index.js";
import { analyzeSeasonalTrend } from "../src/utils/seasonal.js";
import { buildShareText } from "../src/utils/share.js";

describe("Resynced partial history", () => {
  it("shows a dated historical comparison without promoting it to a current alert", () => {
    const hour = 3_600_000;
    const now = Date.UTC(2026, 8, 16, 16, 30);
    const end = Date.UTC(2026, 8, 16);
    const snapshots: Snapshot[] = Array.from({ length: 60 * 24 }, (_, index) => ({
      ts: end - (60 * 24 - index) * hour + 6 * 60_000,
      current: index < 53 * 24 ? 4000 : 3000,
      source: "games-popularity", granularity: "hourly",
    }));
    snapshots.push({ ts: now, current: 3100, source: "steam", granularity: "instant" });
    const vm = buildCardViewModel({ appid: "3751950", name: "Resynced", image: "" }, {
      "3751950": { current: 3100, fetchedAt: now },
    }, snapshots, 60, now);
    expect(vm.displayTrendPct).toBe(-25);
    expect(vm.trendAsOf).toBe(end);
    expect(vm.earlyActivity).toBeUndefined();
    expect(vm.current).toBe(3100);
    expect(analyzeSeasonalTrend(snapshots, now).status).toBe("stale");
    expect(buildShareText(vm)).toContain("Historical comparison through 2026-09-16T00:00:00.000Z");
  });
  it("does not label a legacy peak as provider ATH after a failed acquisition", () => {
    const now = Date.now();
    const vm = buildCardViewModel({ appid: "3751950", name: "Resynced", image: "" }, {
      "3751950": { current: 2200, allTimePeak: 85500, fetchedAt: now,
        freshness: { allTimePeak: { source: "steamcharts", status: "error", attemptedAt: now } } },
    }, [], 60, now);
    expect(vm.allTimePeak).toBeNull();
  });
  it("does not promote sparse legacy history or a SteamSpy peak into reliable metrics", () => {
    const now = Date.now();
    const snapshots: Snapshot[] = [
      ...Array.from({ length: 60 }, (_, day) => ({ ts: now - (60 - day) * 86_400_000, current: 85_000 - day * 1000, source: "legacy" as const, granularity: "unknown" as const })),
      { ts: now - 300_000, current: 2000, source: "steam", granularity: "instant" },
      { ts: now, current: 2200, source: "steam", granularity: "instant" },
    ];
    const vm = buildCardViewModel({ appid: "3751950", name: "Black Flag Resynced", image: "" }, {
      "3751950": { current: 2200, allTimePeak: 85_500, fetchedAt: now,
        freshness: { allTimePeak: { source: "steamspy", status: "ok", acquiredAt: now, attemptedAt: now } } },
    }, snapshots, 60);
    expect(vm.current).toBe(2200);
    expect(vm.allTimePeak).toBeNull();
    expect(vm.observedPeak).toBe(2200);
    expect(vm.displayTrendPct).toBeNull();
    expect(vm.availableGraphWindows.map((window) => window.key)).toEqual(["24h", "3d", "7d", "15d", "1m", "all"]);
    expect(vm.snaps.map((point) => point.current)).toEqual([2000, 2200]);
  });
});
