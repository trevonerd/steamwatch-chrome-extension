// tests/card.test.ts
import { describe, it, expect } from "vitest";
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
  },
};

function makeSnaps(values: number[], intervalMs = 15 * 60_000): Snapshot[] {
  const base = Date.now() - values.length * intervalMs;
  return values.map((current, i) => ({ ts: base + i * intervalMs, current }));
}

// snaps12 spans 12 × 15min = 3h → enough for 24h median (span ≥ 30min, count ≥ 3)
const snaps12 = makeSnaps([30000,31000,32000,33000,34000,35000,36000,37000,38000,39000,40000,41000]);
const snaps5  = makeSnaps([1000, 2000, 3000, 4000, 5000]);
const daySnaps: Snapshot[] = [
  { ts: Date.now() - 23.5 * 3_600_000, current: 28_000 },
  { ts: Date.now() - 20 * 3_600_000, current: 29_000 },
  { ts: Date.now() - 16 * 3_600_000, current: 30_000 },
  { ts: Date.now() - 12 * 3_600_000, current: 31_000 },
  { ts: Date.now() - 8 * 3_600_000, current: 32_000 },
  { ts: Date.now() - 5 * 60_000, current: 33_000 },
];
const retentionSnaps: Snapshot[] = [
  { ts: Date.now() - 2.95 * 86_400_000, current: 26_000 },
  { ts: Date.now() - 2.4 * 86_400_000, current: 27_000 },
  { ts: Date.now() - 1.8 * 86_400_000, current: 28_000 },
  { ts: Date.now() - 1.2 * 86_400_000, current: 29_000 },
  { ts: Date.now() - 0.6 * 86_400_000, current: 30_000 },
  { ts: Date.now() - 5 * 60_000, current: 31_000 },
];
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

  it("allTimePeak is max of fetched peak, localAllTimePeak and snapshot peak", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.allTimePeak).toBe(953_271);
  });

  it("allTimePeak uses localAllTimePeak when fetched all-time peak is 0", () => {
    const cacheLocalPeak = { "1245620": { ...cache["1245620"]!, allTimePeak: 0, localAllTimePeak: 80_000 } };
    const vm = buildCardViewModel(game, cacheLocalPeak, snaps12, 7);
    expect(vm.allTimePeak).toBe(80_000);
  });

  it("allTimePeak falls back to local snapshot max when all peak sources are 0", () => {
    const cacheNoPeak = { "1245620": { ...cache["1245620"]!, allTimePeak: 0, localAllTimePeak: 0 } };
    const vm = buildCardViewModel(game, cacheNoPeak, snaps12, 7);
    expect(vm.allTimePeak).toBe(41_000);
  });

  it("allTimePeak is null when both cache peak and snaps are empty", () => {
    const vm = buildCardViewModel(game, {}, emptySnaps, 7);
    expect(vm.allTimePeak).toBeNull();
  });

  it("reads the 24h peak from cache", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.peak24h).toBe(45_000);
  });

  it("computes displayTrendPct from smoothed trend when available", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.displayTrendPct).not.toBeNull();
    expect(vm.displayTrendIcon).not.toBeNull();
    expect(vm.displayTrendCls).toBe(vm.trend?.level.cls ?? "stable");
  });

  it("falls back to latest interval change when smoothed trend is unavailable", () => {
    const vm = buildCardViewModel(game, cache, snaps5, 7);
    expect(vm.trend).toBeNull();
    expect(vm.latestChangePct).not.toBeNull();
    expect(vm.displayTrendPct).toBe(vm.latestChangePct);
    expect(vm.displayTrendIcon).toBe("↕");
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

  it("computes trend for 6+ snapshots", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
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

  it("computes latest change for 2+ snapshots", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.latestChangePct).not.toBeNull();
  });

  it("returns null latest change for fewer than 2 snapshots", () => {
    const vm = buildCardViewModel(game, cache, [snaps5[0]!], 7);
    expect(vm.latestChangePct).toBeNull();
  });

  it("svgStr is non-null for 2+ snapshots", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.svgStr).not.toBeNull();
    expect(vm.svgStr).toContain("<svg");
  });

  it("svgStr is null for empty snapshots", () => {
    const vm = buildCardViewModel(game, cache, emptySnaps, 7);
    expect(vm.svgStr).toBeNull();
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

  it("snaps reference is unchanged", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.snaps).toBe(snaps12);
  });

  it("keeps fetched supplementary metrics on the view model", () => {
    const vm = buildCardViewModel(game, cache, snaps12, 7);
    expect(vm.twitchViewers).toBe(12_345);
    expect(vm.retentionDays).toBe(7);
    expect(vm.availableGraphWindows).toEqual([]);
    expect(vm.defaultGraphWindow).toBeNull();
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
  });

  it("exposes available graph windows and picks 24h as default when possible", () => {
    const graphSnaps: Snapshot[] = [
      { ts: Date.now() - 2.95 * 86_400_000, current: 20_000 },
      { ts: Date.now() - 2.4 * 86_400_000, current: 21_000 },
      { ts: Date.now() - 1.9 * 86_400_000, current: 22_000 },
      { ts: Date.now() - 23 * 3_600_000, current: 23_000 },
      { ts: Date.now() - 18 * 3_600_000, current: 24_000 },
      { ts: Date.now() - 12 * 3_600_000, current: 25_000 },
      { ts: Date.now() - 6 * 3_600_000, current: 26_000 },
      { ts: Date.now() - 2 * 3_600_000, current: 27_000 },
      { ts: Date.now() - 10 * 60_000, current: 28_000 },
    ];
    const vm = buildCardViewModel(game, cache, graphSnaps, 7);
    expect(vm.availableGraphWindows.map((window) => window.key)).toEqual(["24h", "3d"]);
    expect(vm.defaultGraphWindow).toBe("24h");
  });

  it("includes the retention window when there is enough long-range coverage", () => {
    const retentionGraphSnaps: Snapshot[] = [
      { ts: Date.now() - 6.9 * 86_400_000, current: 19_000 },
      { ts: Date.now() - 6.1 * 86_400_000, current: 20_000 },
      { ts: Date.now() - 5.2 * 86_400_000, current: 21_000 },
      { ts: Date.now() - 4.1 * 86_400_000, current: 22_000 },
      { ts: Date.now() - 2.95 * 86_400_000, current: 23_000 },
      { ts: Date.now() - 2.1 * 86_400_000, current: 24_000 },
      { ts: Date.now() - 23 * 3_600_000, current: 24_200 },
      { ts: Date.now() - 18 * 3_600_000, current: 24_300 },
      { ts: Date.now() - 12 * 3_600_000, current: 24_400 },
      { ts: Date.now() - 8 * 3_600_000, current: 24_450 },
      { ts: Date.now() - 2.8 * 3_600_000, current: 24_500 },
      { ts: Date.now() - 2.2 * 3_600_000, current: 24_700 },
      { ts: Date.now() - 1.8 * 3_600_000, current: 24_900 },
      { ts: Date.now() - 1.2 * 3_600_000, current: 25_100 },
      { ts: Date.now() - 45 * 60_000, current: 25_300 },
      { ts: Date.now() - 20 * 60_000, current: 25_600 },
      { ts: Date.now() - 1.1 * 86_400_000, current: 25_000 },
      { ts: Date.now() - 10 * 60_000, current: 26_000 },
    ];
    const vm = buildCardViewModel(game, cache, retentionGraphSnaps, 7);
    expect(vm.availableGraphWindows.map((window) => window.key)).toEqual(["24h", "3d", "retention"]);
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
    const vms = await buildAllViewModels(
      [game], cache,
      async () => { throw new Error("storage unavailable"); },
      7,
    );
    expect(vms).toHaveLength(1);
    expect(vms[0]!.snaps).toHaveLength(0);
  });

  it("returns empty array for empty games list", async () => {
    const vms = await buildAllViewModels([], cache, async () => snaps12, 7);
    expect(vms).toHaveLength(0);
  });
});
