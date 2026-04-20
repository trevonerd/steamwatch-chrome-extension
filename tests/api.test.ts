// tests/api.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchCurrentPlayers,
  fetchSteamChartsData,
  fetchSteamSpyData,
  fetchTwitchViewers,
  parseSteamChartsData,
  searchGames,
  STEAM_CAPSULE_URL,
} from "../src/utils/api.js";

// ── Mock fetch ────────────────────────────────────────────────────────────────

function mockFetch(body: unknown, ok = true, status = 200): void {
  globalThis.fetch = vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  } as Response);
}

function mockFetchError(): void {
  globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));
}

function createJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── fetchCurrentPlayers ───────────────────────────────────────────────────────

describe("fetchCurrentPlayers", () => {
  it("returns player count on valid response", async () => {
    mockFetch({ response: { player_count: 85432 } });
    expect(await fetchCurrentPlayers("570")).toBe(85432);
  });

  it("returns null on non-ok HTTP response", async () => {
    mockFetch({}, false, 503);
    expect(await fetchCurrentPlayers("570")).toBeNull();
  });

  it("returns null when response shape is invalid", async () => {
    mockFetch({ response: { wrong_key: 100 } });
    expect(await fetchCurrentPlayers("570")).toBeNull();
  });

  it("returns null when player_count is not a number", async () => {
    mockFetch({ response: { player_count: "lots" } });
    expect(await fetchCurrentPlayers("570")).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetchError();
    expect(await fetchCurrentPlayers("570")).toBeNull();
  });

  it("returns null when response is null", async () => {
    mockFetch(null);
    expect(await fetchCurrentPlayers("570")).toBeNull();
  });
});

// ── fetchSteamSpyData ─────────────────────────────────────────────────────────

describe("fetchSteamSpyData", () => {
  it("returns peak and name on valid response", async () => {
    mockFetch({ peak_ccu: 952061, name: "Elden Ring" });
    const result = await fetchSteamSpyData("1245620");
    expect(result.peak).toBe(952061);
    expect(result.name).toBe("Elden Ring");
  });

  it("returns zeros/empty on non-ok response", async () => {
    mockFetch({}, false, 429);
    const result = await fetchSteamSpyData("1245620");
    expect(result.peak).toBe(0);
    expect(result.name).toBe("");
  });

  it("defaults missing fields to 0 / empty string", async () => {
    mockFetch({ appid: 570 }); // no peak_ccu or name
    const result = await fetchSteamSpyData("570");
    expect(result.peak).toBe(0);
    expect(result.name).toBe("");
  });

  it("returns zeros on network error", async () => {
    mockFetchError();
    const result = await fetchSteamSpyData("570");
    expect(result.peak).toBe(0);
  });
});

describe("parseSteamChartsData", () => {
  it("parses current, 24h peak, and all-time peak", () => {
    const html = `
      <div>11 playing 7 min ago</div>
      <div>23 24-hour peak</div>
      <div>97,249 all-time peak</div>
      <table>
        <tr><td>January 2026</td><td>1,000</td><td>+10</td><td>+1%</td><td>97,249</td></tr>
      </table>
    `;
    const data = parseSteamChartsData(html);
    expect(data.current).toBe(11);
    expect(data.peak24h).toBe(23);
    expect(data.allTimePeak).toBe(97_249);
    expect(data.allTimePeakLabel).toBeTruthy();
  });
});

describe("fetchSteamChartsData", () => {
  it("returns parsed chart data from page HTML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => `
        <div>11 playing 7 min ago</div>
        <div>23 24-hour peak</div>
        <div>97,249 all-time peak</div>
      `,
    })));
    const data = await fetchSteamChartsData("570");
    expect(data.current).toBe(11);
    expect(data.peak24h).toBe(23);
    expect(data.allTimePeak).toBe(97_249);
  });
});

// ── searchGames ───────────────────────────────────────────────────────────────

describe("searchGames", () => {
  const validResponse = {
    items: [
      { id: 1245620, name: "Elden Ring",   small_capsule_image: "https://cdn.example.com/er.jpg" },
      { id: 570,     name: "Dota 2",       small_capsule_image: "https://cdn.example.com/d2.jpg" },
    ],
  };

  it("returns mapped results with correct shape", async () => {
    mockFetch(validResponse);
    const results = await searchGames("elden");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      appid: "1245620",
      name: "Elden Ring",
      image: "https://cdn.example.com/er.jpg",
    });
  });

  it("returns empty array for blank query", async () => {
    expect(await searchGames("   ")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("limits to 8 results", async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1, name: `Game ${i + 1}`,
    }));
    mockFetch({ items });
    const results = await searchGames("game");
    expect(results).toHaveLength(8);
  });

  it("uses CDN fallback when small_capsule_image is missing", async () => {
    mockFetch({ items: [{ id: 570, name: "Dota 2" }] }); // no image
    const results = await searchGames("dota");
    expect(results[0]!.image).toBe(STEAM_CAPSULE_URL("570"));
  });

  it("returns empty array on non-ok response", async () => {
    mockFetch({}, false, 500);
    expect(await searchGames("elden")).toEqual([]);
  });

  it("returns empty array on invalid response shape", async () => {
    mockFetch({ wrong: "data" });
    const results = await searchGames("elden");
    // Zod schema has .default([]) so it gracefully returns empty
    expect(results).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    mockFetchError();
    expect(await searchGames("elden")).toEqual([]);
  });
});

// ── STEAM_CAPSULE_URL ─────────────────────────────────────────────────────────

describe("STEAM_CAPSULE_URL", () => {
  it("generates correct CDN URL", () => {
    expect(STEAM_CAPSULE_URL("1245620")).toBe(
      "https://cdn.akamai.steamstatic.com/steam/apps/1245620/capsule_sm_120.jpg"
    );
  });
});

// ── fetchRecentNews ───────────────────────────────────────────────────────────

import { fetchRecentNews } from "../src/utils/api.js";

describe("fetchRecentNews", () => {
  const validResponse = {
    appnews: {
      newsitems: [
        { title: "Update 1.12", url: "https://store.steampowered.com/news/1", date: Math.floor(Date.now() / 1000) - 3600 },
        { title: "Old patch",   url: "https://store.steampowered.com/news/2", date: 1000 },
      ],
    },
  };

  it("returns recent news items within maxAge window", async () => {
    mockFetch(validResponse);
    const items = await fetchRecentNews("1245620");
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Update 1.12");
  });

  it("filters out items older than maxAge", async () => {
    mockFetch(validResponse);
    // maxAge = 1 second — both items are older
    const items = await fetchRecentNews("1245620", 1);
    expect(items).toHaveLength(0);
  });

  it("returns correct shape", async () => {
    mockFetch(validResponse);
    const [item] = await fetchRecentNews("1245620");
    expect(item).toHaveProperty("title");
    expect(item).toHaveProperty("url");
    expect(item).toHaveProperty("date");
  });

  it("returns empty array on non-ok response", async () => {
    mockFetch({}, false, 429);
    expect(await fetchRecentNews("1245620")).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    mockFetchError();
    expect(await fetchRecentNews("1245620")).toEqual([]);
  });

  it("returns empty array when newsitems is missing", async () => {
    mockFetch({ appnews: {} });
    // Zod default([]) handles missing field
    expect(await fetchRecentNews("1245620")).toEqual([]);
  });
});

describe("fetchTwitchViewers", () => {
  it("returns viewer count on valid GQL response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [{ data: { game: { viewersCount: 233893 } } }],
    })));
    expect(await fetchTwitchViewers("Marathon")).toBe(233893);
  });
});

// ── fetchPriceData ────────────────────────────────────────────────────────────

import { fetchPriceData } from "../src/utils/api.js";

describe("fetchPriceData", () => {
  const saleResponse = (appid: string) => ({
    [appid]: {
      success: true,
      data: {
        price_overview: {
          initial: 2499,
          final: 1249,
          discount_percent: 50,
          initial_formatted: "$24.99",
          final_formatted: "$12.49",
        },
      },
    },
  });

  it("returns price data when game is on sale", async () => {
    mockFetch(saleResponse("570"));
    const result = await fetchPriceData("570");
    expect(result.kind).toBe("priced");
    if (result.kind !== "priced") throw new Error("expected priced result");
    expect(result.data.discountPct).toBe(50);
    expect(result.data.priceOriginal).toBe(2499);
    expect(result.data.priceCurrent).toBe(1249);
    expect(result.data.originalFormatted).toBe("$24.99");
    expect(result.data.currentFormatted).toBe("$12.49");
  });

  it("returns price data when discount is 0 (full-price, not on sale)", async () => {
    mockFetch({ "570": {
      success: true,
      data: { price_overview: { initial: 2499, final: 2499, discount_percent: 0, initial_formatted: "$24.99", final_formatted: "$24.99" } },
    }});
    const result = await fetchPriceData("570");
    expect(result.kind).toBe("priced");
    if (result.kind !== "priced") throw new Error("expected priced result");
    expect(result.data.discountPct).toBe(0);
    expect(result.data.priceOriginal).toBe(2499);
    expect(result.data.priceCurrent).toBe(2499);
    expect(result.data.originalFormatted).toBe("$24.99");
    expect(result.data.currentFormatted).toBe("$24.99");
  });

  it("returns free kind for free game (no price_overview)", async () => {
    mockFetch({ "570": { success: true, data: {} } });
    expect(await fetchPriceData("570")).toEqual({ kind: "free" });
  });

  it("returns error kind on non-ok HTTP response", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = vi.fn().mockResolvedValue(createJsonResponse({}, false, 500));
    const promise = fetchPriceData("570");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toEqual({ kind: "error", reason: "Error: HTTP 500" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns error kind when success is false", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch({ "570": { success: false } });
    globalThis.fetch = vi.fn().mockResolvedValue(createJsonResponse({ "570": { success: false } }));
    const promise = fetchPriceData("570");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toEqual({ kind: "error", reason: "Error: API error" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns error kind on network error", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const promise = fetchPriceData("570");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toEqual({ kind: "error", reason: "Error: Network error" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns error kind when response body is not an object", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch(null);
    globalThis.fetch = vi.fn().mockResolvedValue(createJsonResponse(null));
    const promise = fetchPriceData("570");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toEqual({ kind: "error", reason: "Error: Invalid response" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("uses regionCode parameter in Steam Store URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(createJsonResponse(saleResponse("570")));
    await fetchPriceData("570", "IT");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("cc=IT")
    );
  });

  it("retries on HTTP 429 then succeeds", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({}, false, 429))
      .mockResolvedValueOnce(createJsonResponse({}, false, 429))
      .mockResolvedValueOnce(createJsonResponse(saleResponse("570")));

    const promise = fetchPriceData("570");
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(result.kind).toBe("priced");
    if (result.kind !== "priced") throw new Error("expected priced result");
    expect(result.data.discountPct).toBe(50);
  });

  it("returns error kind after max retries exhausted", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom"));

    const promise = fetchPriceData("570");
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ kind: "error", reason: "Error: boom" });
  });
});
