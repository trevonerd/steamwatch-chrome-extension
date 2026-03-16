// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/api.ts  (v0.10.0)
// All external HTTP calls go through here.
// Every response is validated with Zod before use.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import type { SearchResult, SteamChartsData, SteamSpyData } from "../types/index.js";

export const STEAM_CAPSULE_URL = (appid: string): string =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_sm_120.jpg`;

// ── Schemas ───────────────────────────────────────────────────────────────────

const PlayerCountSchema = z.object({
  response: z.object({
    player_count: z.number().int().nonnegative(),
  }),
});

const StoreSearchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        small_capsule_image: z.string().optional(),
      })
    )
    .default([]),
});

const SteamSpySchema = z.object({
  peak_ccu: z.number().default(0),
  name:     z.string().default(""),
});

const TwitchGqlSchema = z.array(
  z.object({
    data: z.object({
      game: z.object({
        viewersCount: z.number().int().nonnegative(),
      }).nullable(),
    }).optional(),
  })
);

// ── Fetchers ──────────────────────────────────────────────────────────────────

/**
 * Fetch current concurrent player count from the Steam Web API.
 */
export async function fetchCurrentPlayers(appid: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${encodeURIComponent(appid)}`
    );
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = PlayerCountSchema.safeParse(json);
    return parsed.success ? parsed.data.response.player_count : null;
  } catch {
    return null;
  }
}

/**
 * Fetch all-time peak and game name from SteamSpy.
 */
export async function fetchSteamSpyData(appid: string): Promise<SteamSpyData> {
  const fallback: SteamSpyData = { peak: 0, name: "" };
  try {
    const res = await fetch(
      `https://steamspy.com/api.php?request=appdetails&appid=${encodeURIComponent(appid)}`
    );
    if (!res.ok) return fallback;
    const json: unknown = await res.json();
    const parsed = SteamSpySchema.safeParse(json);
    if (!parsed.success) return fallback;
    return {
      peak:      parsed.data.peak_ccu,
      name:      parsed.data.name,
    };
  } catch {
    return fallback;
  }
}

export function parseSteamChartsData(html: string): SteamChartsData {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const current = matchStat(text, /([\d,]+)\s+playing\b/i);
  const peak24h = matchStat(text, /([\d,]+)\s+24-hour peak\b/i);
  const allTimePeak = matchStat(text, /([\d,]+)\s+all-time peak\b/i);
  const allTimePeakLabel = allTimePeak != null ? parseAllTimePeakLabel(html, allTimePeak) : undefined;

  return {
    ...(current != null ? { current } : {}),
    ...(peak24h != null ? { peak24h } : {}),
    ...(allTimePeak != null ? { allTimePeak } : {}),
    ...(allTimePeakLabel ? { allTimePeakLabel } : {}),
  };
}

export async function fetchSteamChartsData(appid: string): Promise<SteamChartsData> {
  try {
    const res = await fetch(`https://steamcharts.com/app/${encodeURIComponent(appid)}`);
    if (!res.ok) return {};
    const html = await res.text();
    return parseSteamChartsData(html);
  } catch {
    return {};
  }
}

export async function fetchTwitchViewers(gameName: string): Promise<number | null> {
  for (const candidate of buildTwitchNameCandidates(gameName)) {
    try {
      const body = JSON.stringify([{
        query: "query($name:String!){game(name:$name){viewersCount}}",
        variables: { name: candidate },
      }]);
      const res = await fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        },
        body,
      });
      if (!res.ok) continue;
      const json: unknown = await res.json();
      const parsed = TwitchGqlSchema.safeParse(json);
      if (!parsed.success) continue;
      const viewers = parsed.data[0]?.data?.game?.viewersCount;
      if (viewers != null) return viewers;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Search Steam Store for games matching a query.
 */
export async function searchGames(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US&f=games`
    );
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const parsed = StoreSearchSchema.safeParse(json);
    if (!parsed.success) return [];
    return parsed.data.items.slice(0, 8).map((item) => ({
      appid: String(item.id),
      name:  item.name,
      image: item.small_capsule_image ?? STEAM_CAPSULE_URL(String(item.id)),
    }));
  } catch {
    return [];
  }
}

// ── Steam News ────────────────────────────────────────────────────────────────

import type { SteamNewsItem } from "../types/index.js";

const SteamNewsSchema = z.object({
  appnews: z.object({
    newsitems: z.array(
      z.object({ title: z.string(), url: z.string(), date: z.number() })
    ).default([]),
  }),
});

export async function fetchRecentNews(
  appid: string,
  maxAge = 48 * 3600
): Promise<SteamNewsItem[]> {
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appid)}&count=2&maxlength=0`
    );
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const parsed = SteamNewsSchema.safeParse(json);
    if (!parsed.success) return [];
    const cutoff = Math.floor(Date.now() / 1000) - maxAge;
    return parsed.data.appnews.newsitems
      .filter((item) => item.date >= cutoff)
      .map((item) => ({ title: item.title, url: item.url, date: item.date }));
  } catch {
    return [];
  }
}

function matchStat(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  if (!match?.[1]) return undefined;
  return Number(match[1].replace(/,/g, ""));
}

function parseAllTimePeakLabel(html: string, allTimePeak: number): string | undefined {
  const rowText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/ +/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const row of rowText) {
    const cols = row.split("\t").map((part) => part.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    const monthLabel = cols[0]!;
    if (/last 30 days/i.test(monthLabel)) continue;
    const peakValue = Number((cols.at(-1) ?? "").replace(/[^\d]/g, ""));
    if (peakValue === allTimePeak) {
      return formatMonthDistance(monthLabel) ?? monthLabel;
    }
  }
  return undefined;
}

function formatMonthDistance(label: string): string | undefined {
  const parsed = new Date(`${label} 1`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const now = new Date();
  const months = (now.getFullYear() - parsed.getFullYear()) * 12 + (now.getMonth() - parsed.getMonth());
  if (months <= 0) return label;
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

function buildTwitchNameCandidates(gameName: string): string[] {
  const trimmed = gameName.trim();
  const normalized = trimmed
    .replace(/[®™©]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const withoutSubtitle = normalized
    .replace(/\s*[:\-–|].*$/, "")
    .trim();
  const alnumOnly = normalized
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [...new Set([trimmed, normalized, withoutSubtitle, alnumOnly].filter(Boolean))];
}
