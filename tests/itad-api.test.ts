import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("fetch", vi.fn());

import {
  fetchHistoricalLow,
  fetchPriceHistory,
  lookupItadGame,
} from "../src/utils/itad-api.js";

describe("lookupItadGame", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ITAD uuid when game is found", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        found: true,
        game: { id: "uuid-abc", slug: "test-game" },
      }),
    } as Response);

    await expect(lookupItadGame("413150")).resolves.toBe("uuid-abc");
  });

  it("returns null when game is not found", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ found: false }),
    } as Response);

    await expect(lookupItadGame("999999")).resolves.toBeNull();
  });

  it("returns null when lookup response fails Zod validation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ invalid: "data" }),
    } as Response);

    await expect(lookupItadGame("413150")).resolves.toBeNull();
  });

  it("returns null when fetch throws (retries exhausted)", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));
    const promise = lookupItadGame("413150");
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("retries on HTTP error then returns uuid on success", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ found: true, game: { id: "uuid-abc", slug: "test-game" } }),
      } as Response);
    const promise = lookupItadGame("413150");
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toBe("uuid-abc");
  });

  it("returns null after all retries exhausted", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValue(new Error("503 Server Error"));
    const promise = lookupItadGame("413150");
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result).toBeNull();
  });
});

describe("fetchPriceHistory", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps valid ITAD history response to PriceRecord[]", async () => {
    const mockHistoryResponse = [
      {
        timestamp: "2024-01-15T12:00:00Z",
        deal: {
          price: { amountInt: 499 },
          regular: { amountInt: 999 },
          cut: 50,
        },
      },
    ];

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockHistoryResponse,
    } as Response);

    await expect(fetchPriceHistory("uuid-abc")).resolves.toEqual([
      {
        appId: "uuid-abc",
        timestamp: new Date("2024-01-15T12:00:00Z").getTime(),
        priceAmountInt: 499,
        regularAmountInt: 999,
        cut: 50,
        shop: "steam",
      },
    ]);
  });

  it("returns empty array for empty history response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await expect(fetchPriceHistory("uuid-abc")).resolves.toEqual([]);
  });

  it("retries on network error then returns price records", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            timestamp: "2024-01-15T12:00:00Z",
            deal: { price: { amountInt: 499 }, regular: { amountInt: 999 }, cut: 50 },
          },
        ],
      } as Response);
    const promise = fetchPriceHistory("uuid-abc");
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0]!.priceAmountInt).toBe(499);
  });
});

describe("fetchHistoricalLow", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns map entries for valid historyLow response", async () => {
    const mockHistoryLowResponse = [
      {
        id: "uuid-abc",
        low: {
          price: { amountInt: 249 },
          cut: 75,
          timestamp: "2023-06-01T00:00:00Z",
        },
      },
    ];

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockHistoryLowResponse,
    } as Response);

    const result = await fetchHistoricalLow(["uuid-abc"]);
    expect(result).toBeInstanceOf(Map);
    expect(result.get("uuid-abc")).toEqual({
      amountInt: 249,
      cut: 75,
      timestamp: "2023-06-01T00:00:00Z",
    });
  });

  it("returns empty map when called with empty array", async () => {
    const result = await fetchHistoricalLow([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
