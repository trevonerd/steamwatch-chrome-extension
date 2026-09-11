import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGamesPopularityHistoryResult, fetchPlayerHistoryResult } from "../src/utils/api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function history(appid: string, rows: readonly { readonly players: number; readonly added: string }[], nextCursor?: string): object {
  return { steamId: appid, history: rows, ...(nextCursor === undefined ? {} : { nextCursor }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchGamesPopularityHistoryResult", () => {
  it("normalizes UTC timestamps, deduplicates, and marks hourly fallback observations", async () => {
    const now = Date.now();
    const first = now - 60 * 86_400_000 + 60_000;
    const last = now - 60 * 60_000;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(history("3751950", [
      { players: 20, added: new Date(last).toISOString().replace("Z", "") },
      { players: 10, added: new Date(first).toISOString() },
      { players: 11, added: new Date(first).toISOString() },
    ]))));

    await expect(fetchGamesPopularityHistoryResult("3751950")).resolves.toEqual({
      status: "ok",
      value: [
        { ts: first, current: 11, source: "games-popularity", granularity: "hourly" },
        { ts: last, current: 20, source: "games-popularity", granularity: "hourly" },
      ],
    });
  });

  it("requests a second page when the first page does not reach retention and returns both pages", async () => {
    const now = Date.now();
    const first = now - 2 * 60 * 60_000;
    const older = now - 59 * 86_400_000;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(history("3751950", [{ players: 20, added: new Date(first).toISOString() }], "cursor-1")))
      .mockResolvedValueOnce(jsonResponse(history("3751950", [{ players: 10, added: new Date(older).toISOString() }])));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGamesPopularityHistoryResult("3751950");

    expect(result).toMatchObject({ status: "ok", value: [{ ts: older }, { ts: first }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=cursor-1");
  });

  it("stops after one page when it already contains a valid observation older than retention", async () => {
    const now = Date.now();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(history("3751950", [
      { players: 20, added: new Date(now - 60 * 60_000).toISOString() },
      { players: 10, added: new Date(now - 61 * 86_400_000).toISOString() },
    ], "unused-cursor")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGamesPopularityHistoryResult("3751950")).resolves.toMatchObject({ status: "ok", value: [{ current: 20 }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an error rather than partial history when a required second page is malformed", async () => {
    const now = Date.now();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(history("3751950", [{ players: 20, added: new Date(now - 60 * 60_000).toISOString() }], "cursor-1")))
      .mockResolvedValueOnce(jsonResponse({ invalid: true })));

    await expect(fetchGamesPopularityHistoryResult("3751950")).resolves.toMatchObject({ status: "error" });
  });

  it("returns an error rather than unavailable when a required continuation is missing", async () => {
    const now = Date.now();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(history("3751950", [{ players: 20, added: new Date(now - 60 * 60_000).toISOString() }], "cursor-1")))
      .mockResolvedValueOnce(jsonResponse({}, 404)));

    await expect(fetchGamesPopularityHistoryResult("3751950")).resolves.toMatchObject({ status: "error", error: "GamesPopularity HTTP 404" });
  });

  it("rejects a response whose Steam identity does not match the requested app", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(history("570", []))));

    await expect(fetchGamesPopularityHistoryResult("3751950")).resolves.toMatchObject({ status: "error" });
  });

  it("rejects future and negative provider observations", async () => {
    const now = Date.now();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(history("3751950", [{ players: 10, added: new Date(now + 60 * 60_000).toISOString() }])))
      .mockResolvedValueOnce(jsonResponse(history("3751950", [{ players: -1, added: new Date(now - 60 * 60_000).toISOString() }]))));

    await expect(fetchGamesPopularityHistoryResult("3751950")).resolves.toMatchObject({ status: "error" });
    await expect(fetchGamesPopularityHistoryResult("3751950")).resolves.toMatchObject({ status: "error" });
  });
});

describe("fetchPlayerHistoryResult", () => {
  it("returns the primary SteamCharts history without querying the fallback", async () => {
    const now = Date.now();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([[now - 60 * 60_000, 42]]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPlayerHistoryResult("3751950")).resolves.toMatchObject({ status: "ok", value: [{ source: "steamcharts" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back when SteamCharts is unavailable and preserves fallback failures as errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ invalid: true })));

    await expect(fetchPlayerHistoryResult("3751950")).resolves.toMatchObject({ status: "error" });
  });

  it("reports unavailable only when both history providers are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({}, 404)));

    await expect(fetchPlayerHistoryResult("3751950")).resolves.toEqual({ status: "unavailable" });
  });
});
