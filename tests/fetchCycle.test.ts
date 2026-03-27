import { describe, expect, it } from "vitest";
import {
  buildCachedData,
  mergeCycleCache,
} from "../src/background/fetchCycle.js";

describe("buildCachedData", () => {
  it("preserves previous fallback fields when upstream data is missing", () => {
    const cache = buildCachedData({
      currentPlayers: 1200,
      peak24h: 1500,
      allTimePeak: 1800,
      prevCache: {
        current: 1000,
        peak24h: 1400,
        allTimePeak: 1700,
        fetchedAt: 1,
        localAllTimePeak: 1800,
      },
      fetchedAt: 2,
      twitchViewers: null,
    });

    expect(cache.localAllTimePeak).toBe(1800);
    expect(cache.current).toBe(1200);
    expect(cache.peak24h).toBe(1500);
    expect(cache.allTimePeak).toBe(1800);
  });

  it("updates the monotonic local peak from the new current value", () => {
    const cache = buildCachedData({
      currentPlayers: 2200,
      peak24h: 2000,
      allTimePeak: 2100,
      prevCache: { current: 1500, peak24h: 1800, allTimePeak: 2100, fetchedAt: 1, localAllTimePeak: 1900 },
      fetchedAt: 2,
      twitchViewers: null,
    });

    expect(cache.localAllTimePeak).toBe(2200);
    expect(cache.allTimePeak).toBe(2100);
  });
});

describe("buildCachedData — ITAD fields", () => {
  const baseInput = {
    currentPlayers: 500,
    fetchedAt: 100,
    twitchViewers: null,
  };

  it("passes through itadUuid from input to output", () => {
    const result = buildCachedData({ ...baseInput, itadUuid: "abc-123" });
    expect(result.itadUuid).toBe("abc-123");
  });

  it("passes through itadHistoricalLow from input to output", () => {
    const low = { amountInt: 499, cut: 75, timestamp: "2024-01-01T00:00:00Z" };
    const result = buildCachedData({ ...baseInput, itadHistoricalLow: low });
    expect(result.itadHistoricalLow).toEqual(low);
  });

  it("carries forward itadUuid from prevCache when not in input", () => {
    const result = buildCachedData({
      ...baseInput,
      prevCache: { current: 400, fetchedAt: 50, itadUuid: "prev-uuid" },
    });
    expect(result.itadUuid).toBe("prev-uuid");
  });

  it("carries forward itadHistoricalLow from prevCache when not in input", () => {
    const low = { amountInt: 299, cut: 80, timestamp: "2023-06-15T00:00:00Z" };
    const result = buildCachedData({
      ...baseInput,
      prevCache: { current: 400, fetchedAt: 50, itadHistoricalLow: low },
    });
    expect(result.itadHistoricalLow).toEqual(low);
  });

  it("does not crash when neither input nor prevCache have ITAD data", () => {
    const result = buildCachedData({ ...baseInput });
    expect(result.itadUuid).toBeUndefined();
    expect(result.itadHistoricalLow).toBeUndefined();
  });
});

describe("mergeCycleCache", () => {
  const makeGame = (appid: string) => ({
    appid,
    name: `Game ${appid}`,
    image: `https://cdn.example.com/${appid}.jpg`,
  });

  it("preserves cache entries from two games regardless of completion order", () => {
    const prevCache = {};
    const results = [
      { game: makeGame("2"), cacheData: { current: 200, peak24h: 220, allTimePeak: 300, fetchedAt: 2 } },
      { game: makeGame("1"), cacheData: { current: 100, peak24h: 110, allTimePeak: 140, fetchedAt: 2 } },
    ];

    const merged = mergeCycleCache(prevCache, results);

    expect(Object.keys(merged)).toEqual(["1", "2"]);
    expect(merged["1"]?.current).toBe(100);
    expect(merged["2"]?.current).toBe(200);
  });

  it("keeps all five games when cycle results settle in arbitrary order", () => {
    const prevCache = {
      old: { current: 50, peak24h: 80, allTimePeak: 90, fetchedAt: 1 },
    };
    const results = ["5", "2", "4", "1", "3"].map((appid, index) => ({
      game: makeGame(appid),
      cacheData: { current: index + 1, peak24h: index + 10, allTimePeak: index + 20, fetchedAt: 3 },
    }));

    const merged = mergeCycleCache(prevCache, results);

    expect(Object.keys(merged).sort()).toEqual(["1", "2", "3", "4", "5", "old"]);
    expect(merged["old"]?.current).toBe(50);
    expect(merged["5"]?.current).toBe(1);
    expect(merged["3"]?.current).toBe(5);
  });
});
