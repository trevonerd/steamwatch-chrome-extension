// tests/card.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildCardViewModel, buildAllViewModels } from "../src/utils/card.js";
import type { Game, CachedData, Snapshot } from "../src/types/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const game: Game = {
  appid: "1245620",
  name:  "Elden Ring",
  image: "https://cdn.akamai.steamstatic.com/steam/apps/1245620/capsule_sm_120.jpg",
};

const cache: Record<string, CachedData> = {
  "1245620": {
    current: 35_000,
    peak24h: 45_000,
    allTimePeak: 953_271,
    allTimePeakLabel: "2 months ago",
    localAllTimePeak: 953_271,
    fetchedAt: Date.now() - 5 * 60_000,
    twitchViewers: 12_345,
    freshness: {
      allTimePeak: {
        source: "steamcharts",
        status: "ok",
        acquiredAt: Date.now() - 5 * 60_000,
        attemptedAt: Date.now() - 5 * 60_000,
      },
    },
  },
};

function chartSnapshot(ts: number, current: number): Snapshot {
  return { ts, current, source: "steamcharts", granularity: "hourly" };
}

function makeSnaps(values: number[], intervalMs = 60 * 60_000): Snapshot[] {
  const base = Date.now() - values.length * intervalMs;
  return values.map((current, i) => chartSnapshot(base + i * intervalMs, current));
}

const snaps12 = makeSnaps([30000,31000,32000,33000,34000,35000,36000,37000,38000,39000,40000,41000]);
const snaps5  = makeSnaps([1000, 2000, 3000, 4000, 5000]);
const daySnaps = makeSnaps(Array.from({ length: 24 }, (_, hour) => 28_000 + hour));
const retentionSnaps = makeSnaps(Array.from({ length: 72 }, (_, hour) => 26_000 + hour));
const seasonalSnaps = makeSnaps(Array.from({ length: 35 * 24 }, (_, hour) => 20_000 + hour));
const emptySnaps: Snapshot[] = [];

// ── buildCardViewModel ─────────────────────────────────────────────────────────

describe("buildCardViewModel", () => {
  it("returns the original game object unchanged", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.game).toBe(game);
  });

  it("reads current from cache", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.current).toBe(35_000);
  });

  it("returns null current when appid absent from cache", () => {
    const vm = buildCardViewModel(game, {}, snaps12, 7);
    expect(vm.current).toBeNull();
  });

  it("exposes a SteamCharts all-time peak as provider ATH", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.allTimePeak).toBe(953_271);
  });

  it("keeps a provider ATH of zero distinct from the observed local peak", () => {
    const cacheLocalPeak = { "1245620": { ...cache["1245620"]!, allTimePeak: 0, localAllTimePeak: 80_000 } };
    const vm = buildCardViewModel(game, cacheLocalPeak, snaps12, 7);
    expect(vm.allTimePeak).toBe(0);
    expect(vm.observedPeak).toBe(41_000);
  });

  it("does not present an observed local peak as a provider ATH", () => {
    const cacheNoPeak = { "1245620": { ...cache["1245620"]!, allTimePeak: 0, localAllTimePeak: 0 } };
    const vm = buildCardViewModel(game, cacheNoPeak, snaps12, 7);
    expect(vm.allTimePeak).toBe(0);
    expect(vm.observedPeak).toBe(41_000);
  });

  it("allTimePeak is null when both cache peak and snaps are empty", () => {
    const vm = buildCardViewModel(game, {}, emptySnaps, 7);
    expect(vm.allTimePeak).toBeNull();
  });

  it("reads the 24h peak from cache", () => {
    const vm = buildCardViewModel(game, cache, seasonalSnaps, 7);
    expect(vm.peak24h).toBe(45_000);
  });

  it("computes displayTrendPct from smoothed trend when available", () => {
    const vm = buildCardViewModel(game, cache, seasonalSnaps, 7);
    expect(vm.displayTrendPct).not.toBeNull();
    expect(vm.displayTrendIcon).not.toBeNull();
    expect(vm.displayTrendCls).toBe(vm.trend?.level.cls ?? "stable");
  });

  it("does not substitute a latest interval change for an unavailable seasonal trend", () => {
    const vm = buildCardViewModel(game, cache, snaps5, 7);
    expect(vm.trend).toBeNull();
    expect(vm.latestChangePct).not.toBeNull();
    expect(vm.displayTrendPct).toBeNull();
    expect(vm.displayTrendIcon).toBeNull();
  });

  it("displayTrendPct is null when there is not enough history", () => {
    const vmNoCache = buildCardViewModel(game, {}, snaps12, 7);
    void vmNoCache;

    const vmEmpty = buildCardViewModel(game, cache, emptySnaps, 7);
    expect(vmEmpty.displayTrendPct).toBeNull();
    expect(vmEmpty.displayTrendIcon).toBeNull();
    expect(vmEmpty.displayTrendCls).toBe("stable");
  });

  it("returns null 24h peak when the cache does not include it", () => {
    const vm = buildCardViewModel(game, cache, emptySnaps, 7);
    expect(vm.peak24h).toBe(45_000);
    const vmNoPeak = buildCardViewModel(game, {}, emptySnaps, 7);
    expect(vmNoPeak.peak24h).toBeNull();
  });

  it("computes trend only from qualified seasonal coverage", () => {
    const vm = buildCardViewModel(game, cache, seasonalSnaps, 7);
    expect(vm.trend).not.toBeNull();
  });

  it("returns null trend for fewer than 6 snapshots", () => {
    const vm = buildCardViewModel(game, cache, snaps5, 7);
    expect(vm.trend).toBeNull();
  });

  it("trendCls is 'stable' when trend is null", () => {
    const vm = buildCardViewModel(game, cache, emptySnaps, 7);
    expect(vm.trendCls).toBe("stable");
  });

  it("trendCls matches trend.level.cls when trend is present", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    if (vm.trend) {
      expect(vm.trendCls).toBe(vm.trend.level.cls);
    }
  });

  it("computes latest change for fresh adjacent qualified hours", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.latestChangePct).not.toBeNull();
  });

  it("returns null latest change for fewer than 2 snapshots", () => {
    const vm = buildCardViewModel(game, cache, [snaps5[0]!], 7);
    expect(vm.latestChangePct).toBeNull();
  });

  it("sparklineStroke is a valid hex colour string", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.sparklineStroke).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("fetchedAt matches cache entry", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.fetchedAt).toBe(cache["1245620"]!.fetchedAt);
  });

  it("fetchedAt is 0 when appid absent from cache", () => {
    const vm = buildCardViewModel(game, {}, snaps12, 7);
    expect(vm.fetchedAt).toBe(0);
  });

  it("exposes the qualified snapshot sequence", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.snaps).toEqual(snaps12);
  });

  it("keeps fetched supplementary metrics on the view model", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.twitchViewers).toBe(12_345);
    expect(vm.retentionDays).toBe(7);
    expect(vm.retentionWindowLabel).toBe("7d");
    expect(vm.availableGraphWindows).toEqual([
      { key: "all", label: "all", windowMs: 0 },
    ]);
    expect(vm.defaultGraphWindow).toBe("all");
  });

  it("only exposes 24h local stats when there is reliable 24h coverage", () => {
    const vmShort = buildCardViewModel(game, cache, snaps12, 7);
    expect(vmShort.avg24h).toBeUndefined();
    expect(vmShort.gain24h).toBeUndefined();

    const vmDay = buildCardViewModel(game, cache, daySnaps, 3);
    expect(vmDay.avg24h).toBeDefined();
    expect(vmDay.gain24h).toBeDefined();

    const vmRetention = buildCardViewModel(game, cache, retentionSnaps, 3);
    expect(vmRetention.retentionAvg).toBeDefined();
    expect(vmRetention.retentionGain).toBeDefined();
    expect(vmRetention.retentionWindowLabel).toBe("3d");
  });

  it("exposes available graph windows and picks 24h as default when possible", () => {
    const graphSnaps = makeSnaps(Array.from({ length: 72 }, (_, hour) => 20_000 + hour));
    const vm = buildCardViewModel(game, cache, graphSnaps, 7);
    expect(vm.availableGraphWindows.map((window) => window.key)).toEqual(["24h", "3d", "all"]);
    expect(vm.defaultGraphWindow).toBe("24h");
  });

  it("includes the retention window when there is enough long-range coverage", () => {
    const retentionGraphSnaps = makeSnaps(Array.from({ length: 7 * 24 }, (_, hour) => 19_000 + hour));
    const vm = buildCardViewModel(game, cache, retentionGraphSnaps, 7);
    expect(vm.availableGraphWindows.map((window) => window.key)).toEqual(["24h", "3d", "7d", "all"]);
  });
});

// ── record lows ────────────────────────────────────────────────────────────────

describe("buildCardViewModel — record lows", () => {
  it("computes recordLow for active window from filtered snapshots", () => {
    const thirtyDaySnaps: Snapshot[] = [
      chartSnapshot(Date.now() - 29.9 * 86_400_000, 30_000),
      chartSnapshot(Date.now() - 25 * 86_400_000, 35_000),
      chartSnapshot(Date.now() - 15 * 86_400_000, 10_000),
      chartSnapshot(Date.now() - 5 * 86_400_000, 50_000),
      chartSnapshot(Date.now() - 1 * 86_400_000, 45_000),
      chartSnapshot(Date.now() - 12 * 3_600_000, 40_000),
      chartSnapshot(Date.now() - 1 * 3_600_000, 45_000),
    ];
    const vm = buildCardViewModel(game, cache, thirtyDaySnaps, 30);
    expect(vm.recordLow).not.toBeNull();
    expect(vm.recordLow?.value).toBeLessThanOrEqual(45_000);
  });

  it("computes allTimeLow from all snapshots regardless of active window", () => {
    const thirtyDaySnaps: Snapshot[] = [
      chartSnapshot(Date.now() - 29.9 * 86_400_000, 30_000),
      chartSnapshot(Date.now() - 15 * 86_400_000, 10_000),
      chartSnapshot(Date.now() - 1 * 86_400_000, 50_000),
      chartSnapshot(Date.now() - 12 * 3_600_000, 40_000),
      chartSnapshot(Date.now() - 1 * 3_600_000, 45_000),
    ];
    const vm = buildCardViewModel(game, cache, thirtyDaySnaps, 30);
    expect(vm.allTimeLow).not.toBeNull();
    expect(vm.allTimeLow?.value).toBe(10_000);
  });

  it("recordLow reflects the available window (all if that's the only option)", () => {
    const oldSnaps: Snapshot[] = [
      chartSnapshot(Date.now() - 29 * 86_400_000, 20_000),
      chartSnapshot(Date.now() - 25 * 86_400_000, 25_000),
    ];
    const vm = buildCardViewModel(game, cache, oldSnaps, 30);
    expect(vm.recordLow).not.toBeNull();
    expect(vm.recordLow?.value).toBe(20_000);
  });

  it("allTimeLow is null when no snapshots at all", () => {
    const vm = buildCardViewModel(game, cache, emptySnaps, 30);
    expect(vm.allTimeLow).toBeNull();
  });

  it("recordLow and allTimeLow can differ when data spans multiple windows", () => {
    const graphSnaps: Snapshot[] = [
      chartSnapshot(Date.now() - 2.95 * 86_400_000, 5_000),
      chartSnapshot(Date.now() - 2.4 * 86_400_000, 30_000),
      chartSnapshot(Date.now() - 1.9 * 86_400_000, 22_000),
      chartSnapshot(Date.now() - 23 * 3_600_000, 23_000),
      chartSnapshot(Date.now() - 18 * 3_600_000, 24_000),
      chartSnapshot(Date.now() - 12 * 3_600_000, 45_000),
      chartSnapshot(Date.now() - 6 * 3_600_000, 26_000),
      chartSnapshot(Date.now() - 2 * 3_600_000, 27_000),
      chartSnapshot(Date.now() - 10 * 60_000, 28_000),
    ];
    const vm = buildCardViewModel(game, cache, graphSnaps, 7);
    expect(vm.recordLow).not.toBeNull();
    expect(vm.allTimeLow).not.toBeNull();
    expect(vm.allTimeLow?.value).toBe(5_000);
  });

  it("recordLow includes correct timestamp", () => {
    const snapsWithTimestamps: Snapshot[] = [
      chartSnapshot(Date.now() - 5 * 86_400_000, 50_000),
      chartSnapshot(Date.now() - 2 * 86_400_000, 30_000),
      chartSnapshot(Date.now() - 12 * 3_600_000, 25_000), // min in window
      chartSnapshot(Date.now() - 1 * 3_600_000, 45_000),
    ];
    const vm = buildCardViewModel(game, cache, snapsWithTimestamps, 7);
    expect(vm.recordLow?.value).toBe(25_000);
    expect(vm.recordLow?.timestamp).toBe(snapsWithTimestamps[2]!.ts);
  });

  it("allTimeLow includes correct timestamp", () => {
    const snapsWithTimestamps: Snapshot[] = [
      chartSnapshot(Date.now() - 29 * 86_400_000, 10_000), // absolute min
      chartSnapshot(Date.now() - 5 * 86_400_000, 50_000),
      chartSnapshot(Date.now() - 12 * 3_600_000, 25_000),
      chartSnapshot(Date.now() - 1 * 3_600_000, 45_000),
    ];
    const vm = buildCardViewModel(game, cache, snapsWithTimestamps, 7);
    expect(vm.allTimeLow?.value).toBe(10_000);
   expect(vm.allTimeLow?.timestamp).toBe(snapsWithTimestamps[0]!.ts);
   });
});

// ── buildAllViewModels ─────────────────────────────────────────────────────────

describe("buildAllViewModels", () => {
  it("returns one view model per game", async () => {
    const games = [game];
    const vms = await buildAllViewModels(games, cache, async () => snaps12, 7);
    expect(vms).toHaveLength(1);
  });

  it("builds view models for multiple games", async () => {
    const g2: Game = { appid: "570", name: "Dota 2", image: "" };
    const c2 = { ...cache, "570": { current: 100_000, peak24h: 120_000, allTimePeak: 1_000_000, fetchedAt: Date.now() } };
    const vms = await buildAllViewModels([game, g2], c2, async () => snaps12, 7);
    expect(vms).toHaveLength(2);
    expect(vms[0]!.game.appid).toBe("1245620");
    expect(vms[1]!.game.appid).toBe("570");
  });

  it("does not throw when loadSnaps rejects — returns model with empty snaps", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const vms = await buildAllViewModels(
        [game], cache,
        async () => { throw new Error("storage unavailable"); },
        7,
      );
      expect(vms).toHaveLength(1);
      expect(vms[0]!.snaps).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[SteamWatch] Failed to load snapshots"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns empty array for empty games list", async () => {
    const vms = await buildAllViewModels([], cache, async () => snaps12, 7);
    expect(vms).toHaveLength(0);
  });
});
