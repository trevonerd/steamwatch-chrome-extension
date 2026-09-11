// tests/api.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchCurrentPlayers,
  fetchAppDetails,
  fetchSteamChartsData,
  fetchSteamSpyData,
  fetchSteamSpyResult,
  fetchSteamChartsResult,
  fetchTwitchResult,
  fetchTwitchViewers,
  parseSteamChartsData,
  searchGames,
  STEAM_CAPSULE_URL,
  fetchSteamChartsBootstrap,
  ChartDataSchema,
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

describe("fetchAppDetails", () => {
  it("returns details for the requested app and prefers the capsule when the response is valid", async () => {
    mockFetch({ "570": { success: true, data: {
      name: "Dota 2", header_image: "https://example.com/header.jpg",
      capsule_image: "https://example.com/capsule.jpg",
    } } });
    expect(await fetchAppDetails("570")).toEqual({ name: "Dota 2", image: "https://example.com/capsule.jpg" });
  });

  it("uses the header when the capsule is missing", async () => {
    mockFetch({ "570": { success: true, data: { name: "Dota 2", header_image: "https://example.com/header.jpg" } } });
    expect(await fetchAppDetails("570")).toEqual({ name: "Dota 2", image: "https://example.com/header.jpg" });
  });

  it("retains the name when both images are missing", async () => {
    mockFetch({ "570": { success: true, data: { name: "Dota 2" } } });
    expect(await fetchAppDetails("570")).toEqual({ name: "Dota 2", image: null });
  });

  it.each([
    null, {}, { "730": { success: true, data: { name: "Counter-Strike" } } },
    { "570": { success: false } }, { "570": { success: true } },
    { "570": { success: true, data: { name: 42 } } },
  ])("returns null when details are unavailable or malformed: %j", async (body) => {
    mockFetch(body);
    expect(await fetchAppDetails("570")).toBeNull();
  });

  it("returns null when the request fails", async () => {
    mockFetchError();
    expect(await fetchAppDetails("570")).toBeNull();
  });
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

describe("provider result adapters", () => {
  it("reports malformed SteamSpy data as an error without another request", async () => {
    mockFetch({ peak_ccu: "unknown", name: "Game" });

    const result = await fetchSteamSpyResult("570");

    expect(result.status).toBe("error");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("reports an empty SteamCharts page as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "<main />" })));

    expect(await fetchSteamChartsResult("570")).toEqual({ status: "unavailable" });
  });

  it("reports a missing Twitch game as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ data: { game: null } }],
    })));

    expect(await fetchTwitchResult("Marathon")).toEqual({ status: "unavailable" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("reports SteamSpy server failures as errors instead of missing data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({}, false, 503)));

    await expect(fetchSteamSpyResult("570")).resolves.toMatchObject({ status: "error", error: "SteamSpy HTTP 503" });
  });

  it("reports SteamCharts rate limits as errors instead of missing data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({}, false, 429)));

    await expect(fetchSteamChartsResult("570")).resolves.toMatchObject({ status: "error", error: "SteamCharts HTTP 429" });
  });

  it("reports Twitch rate limits as errors instead of an absent category", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({}, false, 429)));

    await expect(fetchTwitchResult("Marathon")).resolves.toMatchObject({ status: "error", error: "Twitch HTTP 429" });
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
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg"
    );
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

// ── fetchSteamChartsBootstrap ─────────────────────────────────────────────────

describe("ChartDataSchema", () => {
  it("validates array of [timestamp, players] tuples", () => {
    const valid = [[1341100800000, 25123.4], [1343779200000, 0]];
    const result = ChartDataSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects non-array input", () => {
    const result = ChartDataSchema.safeParse({ data: [] });
    expect(result.success).toBe(false);
  });

  it("rejects array with non-tuple elements", () => {
    const result = ChartDataSchema.safeParse([{ ts: 123, players: 456 }]);
    expect(result.success).toBe(false);
  });
});

describe("fetchSteamChartsBootstrap", () => {
  const silenceWarn = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const silenceError = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
  let warnSpy: ReturnType<typeof silenceWarn>;
  let errorSpy: ReturnType<typeof silenceError>;

  beforeEach(() => {
    warnSpy = silenceWarn();
    errorSpy = silenceError();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("converts valid response to Snapshot[] with rounding", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [[1341100800000, 25123.4], [1343779200000, 0]],
    } as Response);
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ ts: 1341100800000, current: 25123 });
    expect(result[1]).toMatchObject({ ts: 1343779200000, current: 0 });
  });

  it("filters out entries where timestamp <= 0", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [[0, 100], [1341100800000, 200], [-1, 300]],
    } as Response);
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ts: 1341100800000, current: 200 });
  });

  it("sorts snapshots by timestamp ascending", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [[1343779200000, 100], [1341100800000, 200]],
    } as Response);
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result[0]!.ts).toBe(1341100800000);
    expect(result[1]!.ts).toBe(1343779200000);
  });

  it("returns empty array on non-ok HTTP response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result).toEqual([]);
  });

  it("returns empty array on network error and logs console.warn", async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[SteamWatch] History failed for 570"));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns empty array on malformed JSON and logs console.warn", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new Error("Invalid JSON"); },
    } as unknown as Response);
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns empty array on validation failure and logs console.warn", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ invalid: "shape" }],
    } as Response);
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns empty array for empty response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result).toEqual([]);
  });

  it("rejects negative counts instead of manufacturing a zero sample", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [[1341100800000, -50.5]],
    } as Response);
    
    const result = await fetchSteamChartsBootstrap("570");
    
    expect(result).toEqual([]);
  });

  it("rejects future timestamps and deduplicates observations", async () => {
    const ts = Date.now() - 3_600_000;
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [[ts, 100], [ts, 100], [Date.now() + 86_400_000, 200]],
    });
    const result = await fetchSteamChartsBootstrap("570");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ts, current: 100, source: "steamcharts" });
  });

  it("distinguishes calendar-month peaks from nearby hourly observations", async () => {
    const monthly = Date.UTC(2026, 0, 1);
    const hourly = Date.UTC(2026, 0, 15, 9, 1);
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [[monthly, 900], [hourly, 150], [hourly + 3_600_000, 200]],
    });
    const result = await fetchSteamChartsBootstrap("570");
    expect(result[0]).toMatchObject({ current: 900, granularity: "monthly-peak" });
    expect(result[1]).toMatchObject({ current: 150, granularity: "hourly" });
  });
});


describe("Twitch Steam title normalization", () => {
  it.each([
    ["Assassin’s Creed® IV Black Flag™", "Assassin's Creed IV Black Flag"],
    ["Sid Meier’s Civilization® VI", "Sid Meier's Civilization VI"],
  ])("resolves the actual Twitch category for %s", async (steamName, twitchName) => {
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const matched = typeof init?.body === "string" && init.body.includes(JSON.stringify(twitchName));
      return new Response(JSON.stringify([{ data: { game: matched ? { viewersCount: 171 } : null } }]), { status: 200 });
    });
    expect(await fetchTwitchResult(steamName)).toEqual({ status: "ok", value: 171 });
  });
});
