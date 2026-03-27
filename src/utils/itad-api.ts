import { z } from "zod";
import type { PriceRecord } from "../types/index.js";

const ITAD_BASE = "https://api.isthereanydeal.com";
const ITAD_KEY = import.meta.env.VITE_ITAD_KEY as string;

const ItadLookupSchema = z.object({
  found: z.boolean(),
  game: z
    .object({
      id: z.string(),
      slug: z.string(),
    })
    .optional(),
});

const ItadPriceHistoryItemSchema = z.object({
  timestamp: z.string(),
  deal: z.object({
    price: z.object({ amountInt: z.number() }),
    regular: z.object({ amountInt: z.number() }),
    cut: z.number(),
  }),
});
const ItadPriceHistorySchema = z.array(ItadPriceHistoryItemSchema);

const ItadHistoryLowItemSchema = z.object({
  id: z.string(),
  low: z.object({
    price: z.object({ amountInt: z.number() }),
    cut: z.number(),
    timestamp: z.string(),
  }),
});
const ItadHistoryLowSchema = z.array(ItadHistoryLowItemSchema);

export async function lookupItadGame(steamAppId: string): Promise<string | null> {
  try {
    const url = `${ITAD_BASE}/games/lookup/v1?appid=${steamAppId}&key=${ITAD_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data: unknown = await resp.json();
    const parsed = ItadLookupSchema.safeParse(data);
    if (!parsed.success || !parsed.data.found) return null;
    return parsed.data.game?.id ?? null;
  } catch {
    return null;
  }
}

export async function fetchPriceHistory(
  itadUuid: string,
  shops: number[] = [61]
): Promise<PriceRecord[]> {
  try {
    const shopsParam = shops.map((shopId) => `shops[]=${shopId}`).join("&");
    const url = `${ITAD_BASE}/games/prices/history/v2?id=${itadUuid}&${shopsParam}&key=${ITAD_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data: unknown = await resp.json();
    const parsed = ItadPriceHistorySchema.safeParse(data);
    if (!parsed.success) return [];

    return parsed.data.map((item) => ({
      appId: itadUuid,
      timestamp: new Date(item.timestamp).getTime(),
      priceAmountInt: item.deal.price.amountInt,
      regularAmountInt: item.deal.regular.amountInt,
      cut: item.deal.cut,
      shop: "steam",
    }));
  } catch {
    return [];
  }
}

export async function fetchHistoricalLow(
  itadUuids: string[]
): Promise<Map<string, { amountInt: number; cut: number; timestamp: string }>> {
  const result = new Map<string, { amountInt: number; cut: number; timestamp: string }>();
  if (itadUuids.length === 0) return result;

  try {
    const url = `${ITAD_BASE}/games/prices/historyLow/v1?key=${ITAD_KEY}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(itadUuids),
    });
    if (!resp.ok) return result;

    const data: unknown = await resp.json();
    const parsed = ItadHistoryLowSchema.safeParse(data);
    if (!parsed.success) return result;

    for (const item of parsed.data) {
      result.set(item.id, {
        amountInt: item.low.price.amountInt,
        cut: item.low.cut,
        timestamp: item.low.timestamp,
      });
    }

    return result;
  } catch {
    return result;
  }
}
