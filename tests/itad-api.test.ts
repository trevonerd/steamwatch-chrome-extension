import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("returns null when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    await expect(lookupItadGame("413150")).resolves.toBeNull();
  });
});

describe("fetchPriceHistory", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
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
});

describe("fetchHistoricalLow", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
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
