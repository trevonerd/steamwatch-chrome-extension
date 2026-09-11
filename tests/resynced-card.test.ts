import { describe, expect, it } from "vitest";
import { buildCardViewModel } from "../src/utils/card.js";
import type { Snapshot } from "../src/types/index.js";

describe("Resynced partial history", () => {
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
    expect(vm.retentionAvg).toBeUndefined();
    expect(vm.retentionGain).toBeUndefined();
    expect(vm.displayTrendPct).toBeNull();
    expect(vm.availableGraphWindows).toEqual([]);
  });
});
