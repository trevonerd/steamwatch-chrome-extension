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

describe("buildCachedData — price fields", () => {
  // T2-A: Full-price game (discountPct=0) with price data → caches all price fields
  it("caches price fields for full-price game (discountPct === 0)", () => {
    const result = buildCachedData({
      currentPlayers: 500,
      fetchedAt: 100,
      twitchViewers: null,
      discountPct: 0,
      priceOriginal: 2499,
      priceCurrent: 2499,
      priceFormatted: "$24.99",
      priceOriginalFormatted: "$24.99",
    });
    expect(result.priceFormatted).toBe("$24.99");
    expect(result.priceOriginalFormatted).toBe("$24.99");
    expect(result.discountPct).toBe(0);
    expect(result.priceOriginal).toBe(2499);
    expect(result.priceCurrent).toBe(2499);
  });

  // T2-B: Sale game (discountPct > 0) → caches all price + discount fields (regression check)
  it("caches all price fields for sale game (discountPct > 0)", () => {
    const result = buildCachedData({
      currentPlayers: 500,
      fetchedAt: 100,
      twitchViewers: null,
      discountPct: 50,
      priceOriginal: 2999,
      priceCurrent: 1499,
      priceFormatted: "$14.99",
      priceOriginalFormatted: "$29.99",
    });
    expect(result.discountPct).toBe(50);
    expect(result.priceFormatted).toBe("$14.99");
    expect(result.priceOriginalFormatted).toBe("$29.99");
  });

  // T2-C: No price data + prevCache has price → carries forward from prevCache
  it("carries forward price fields from prevCache when no fresh price data", () => {
    const result = buildCachedData({
      currentPlayers: 500,
      fetchedAt: 100,
      twitchViewers: null,
      // No price fields passed at all
      prevCache: {
        current: 400,
        fetchedAt: 50,
        localAllTimePeak: 400,
        priceFormatted: "$19.99",
        priceOriginalFormatted: "$19.99",
        discountPct: 0,
      },
    });
    expect(result.priceFormatted).toBe("$19.99");
    expect(result.priceOriginalFormatted).toBe("$19.99");
    expect(result.discountPct).toBe(0);
  });

  it("sets priceError when fetch errored and no prevCache price", () => {
    const result = buildCachedData({
      currentPlayers: 500,
      fetchedAt: 100,
      twitchViewers: null,
      priceError: true,
    });
    expect(result.priceError).toBe(true);
    expect(result.priceFormatted).toBeUndefined();
  });

  it("carries forward price AND sets priceError when fetch errored with prevCache price", () => {
    const result = buildCachedData({
      currentPlayers: 500,
      fetchedAt: 100,
      twitchViewers: null,
      priceError: true,
      prevCache: {
        current: 400,
        fetchedAt: 50,
        priceFormatted: "$29.99",
        priceOriginalFormatted: "$29.99",
        discountPct: 0,
      },
    });
    expect(result.priceError).toBe(true);
    expect(result.priceFormatted).toBe("$29.99");
    expect(result.discountPct).toBe(0);
  });

  it("does not set priceError when priceError is false", () => {
    const result = buildCachedData({
      currentPlayers: 500,
      fetchedAt: 100,
      twitchViewers: null,
      priceError: false,
    });
    expect(result.priceError).toBeUndefined();
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
