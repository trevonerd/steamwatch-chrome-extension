import { z } from "zod";
import type { PlayerChange, SteamNewsItem } from "../types/index.js";
import { requestWithPolicy } from "./http.js";

export const NEWS_PREFIX = "sw_news_";
const NEWS_TTL_MS = 3 * 3_600_000;

const SteamNewsSchema = z.object({
  appnews: z.object({
    newsitems: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          date: z.number().int().nonnegative(),
          feed_type: z.number().int().optional(),
        }),
      )
      .default([]),
  }),
});
const CachedNewsSchema = z.object({
  fetchedAt: z.number().finite(),
  items: z.array(z.object({ title: z.string(), url: z.string(), date: z.number().finite() })),
});

/** Official developer announcements (feed_type 1) from the Steam news feed, newest first. */
async function fetchSteamNews(appid: string): Promise<SteamNewsItem[] | null> {
  const result = await requestWithPolicy({
    url: `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appid)}&count=20&maxlength=1&format=json`,
    read: (response) => response.json(),
  });
  if (result.kind !== "response") return null;
  const parsed = SteamNewsSchema.safeParse(result.value);
  if (!parsed.success) return null;
  return parsed.data.appnews.newsitems
    .filter((item) => item.feed_type === 1 && item.title.trim() !== "" && item.url.startsWith("https://"))
    .map((item) => ({ title: item.title, url: item.url, date: item.date * 1000 }));
}

/** Cached for three hours in chrome.storage.local; a failed fetch keeps the previous list. */
export async function getSteamNews(appid: string, now = Date.now()): Promise<readonly SteamNewsItem[]> {
  const key = `${NEWS_PREFIX}${appid}`;
  const cached = CachedNewsSchema.safeParse((await chrome.storage.local.get(key))[key]);
  if (cached.success && now - cached.data.fetchedAt < NEWS_TTL_MS && cached.data.fetchedAt <= now)
    return cached.data.items;
  const items = await fetchSteamNews(appid);
  if (!items) return cached.success ? cached.data.items : [];
  await chrome.storage.local.set({ [key]: { fetchedAt: now, items } });
  return items;
}

/** Announcements published in the 48 hours before a change (or up to 6 hours into it), newest first. */
export function newsForChange(items: readonly SteamNewsItem[], change: PlayerChange): readonly SteamNewsItem[] {
  return items
    .filter((item) => item.date >= change.startTs - 48 * 3_600_000 && item.date <= change.startTs + 6 * 3_600_000)
    .sort((left, right) => right.date - left.date);
}
