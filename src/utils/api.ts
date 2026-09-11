// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/api.ts  (v0.10.0)
// All external HTTP calls go through here.
// Every response is validated with Zod before use.
// ─────────────────────────────────────────────────────────────────────────────

import {
  AppDetailsSchema,
  ChartDataSchema,
  GamesPopularityHistorySchema,
  PlayerCountSchema,
  SteamSpySchema,
  StoreSearchSchema,
  TwitchGqlSchema,
} from "../types/index.js";
import type { ProviderResult, SearchResult, SteamChartsData, SteamSpyData, Snapshot } from "../types/index.js";
import { formatError } from "./log.js";
import { requestWithPolicy } from "./http.js";

export const STEAM_CAPSULE_URL = (appid: string): string =>
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;

export { ChartDataSchema } from "../types/index.js";

// ── Fetchers ──────────────────────────────────────────────────────────────────

/**
 * Fetch current concurrent player count from the Steam Web API.
 */
export async function fetchCurrentPlayers(appid: string): Promise<number | null> {
  const result = await requestWithPolicy({
    url: `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${encodeURIComponent(appid)}`,
    read: (response) => response.json(),
  });
  if (result.kind !== "response") return null;
  const parsed = PlayerCountSchema.safeParse(result.value);
  return parsed.success ? parsed.data.response.player_count : null;
}

/**
 * Fetch all-time peak and game name from SteamSpy.
 */
export async function fetchSteamSpyData(appid: string): Promise<SteamSpyData> {
  const fallback: SteamSpyData = { peak: 0, name: "" };
  const result = await fetchSteamSpyResult(appid);
  return result.status === "ok" ? result.value : fallback;
}

export async function fetchSteamSpyResult(appid: string): Promise<ProviderResult<SteamSpyData>> {
  const result = await requestWithPolicy({
    url: `https://steamspy.com/api.php?request=appdetails&appid=${encodeURIComponent(appid)}`,
    read: (response) => response.json(),
  });
  if (result.kind === "http-error") {
    return result.status === 404
      ? { status: "unavailable" }
      : { status: "error", error: `SteamSpy HTTP ${result.status}` };
  }
  if (result.kind === "error") return { status: "error", error: result.error };
  const parsed = SteamSpySchema.safeParse(result.value);
  if (!parsed.success) return { status: "error", error: "invalid SteamSpy response" };
  return { status: "ok", value: { peak: parsed.data.peak_ccu, name: parsed.data.name } };
}

export async function fetchAppDetails(appid: string): Promise<{ name: string; image: string | null } | null> {
  const result = await requestWithPolicy({
    url: `https://store.steampowered.com/api/appdetails?appids=${appid}`,
    read: (response) => response.json(),
  });
  if (result.kind !== "response") return null;
  const parsed = AppDetailsSchema.safeParse(result.value);
  if (!parsed.success) return null;
  const appData = parsed.data[appid];
  if (!appData?.success || !appData.data) return null;
  const image = appData.data.capsule_image ?? appData.data.header_image ?? null;
  return { name: appData.data.name, image };
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
  const result = await fetchSteamChartsResult(appid);
  return result.status === "ok" ? result.value : {};
}

export async function fetchSteamChartsResult(appid: string): Promise<ProviderResult<SteamChartsData>> {
  const result = await requestWithPolicy({
    url: `https://steamcharts.com/app/${encodeURIComponent(appid)}`,
    read: (response) => response.text(),
  });
  if (result.kind === "http-error") {
    return result.status === 404
      ? { status: "unavailable" }
      : { status: "error", error: `SteamCharts HTTP ${result.status}` };
  }
  if (result.kind === "error") return { status: "error", error: result.error };
  const data = parseSteamChartsData(result.value);
  return Object.keys(data).length === 0 ? { status: "unavailable" } : { status: "ok", value: data };
}

/**
 * Fetch historical player count data from SteamCharts JSON endpoint.
 * Returns array of snapshots with timestamp and player count.
 * On any error, returns empty array and logs warning.
 */
export async function fetchSteamChartsBootstrap(appid: string): Promise<Snapshot[]> {
  const result = await fetchSteamChartsHistoryResult(appid);
  if (result.status === "error") console.warn(`[SteamWatch] History failed for ${appid}: ${result.error}`);
  return result.status === "ok" ? result.value : [];
}

export async function fetchSteamChartsHistoryResult(appid: string): Promise<ProviderResult<Snapshot[]>> {
  const result = await requestWithPolicy({
    url: `https://steamcharts.com/app/${encodeURIComponent(appid)}/chart-data.json`,
    timeoutMs: 15_000,
    read: (response) => response.json(),
  });
  if (result.kind === "http-error") {
    return result.status === 404 ? { status: "unavailable" } : { status: "error", error: `SteamCharts HTTP ${result.status}` };
  }
  if (result.kind === "error") {
    return { status: "error", error: result.error };
  }
  const parsed = ChartDataSchema.safeParse(result.value);
  if (!parsed.success) {
    return { status: "error", error: `Invalid SteamCharts history: ${formatError(parsed.error)}` };
  }
  if (parsed.data.length === 0) return { status: "unavailable" };
  const now = Date.now();
  const entries = [...new Map(parsed.data
    .filter(([ts, players]) => Number.isSafeInteger(ts) && ts > 0 && ts <= now && players >= 0)
    .map(([ts, players]) => [ts, players] as const)).entries()]
    .sort(([left], [right]) => left - right);
  const snapshots: Snapshot[] = entries.map(([ts, players], index) => {
    const previous = entries[index - 1]?.[0];
    const next = entries[index + 1]?.[0];
    const hourly = (previous !== undefined && ts - previous <= 2 * 3_600_000)
      || (next !== undefined && next - ts <= 2 * 3_600_000);
    const date = new Date(ts);
    const monthBoundary = date.getUTCDate() === 1
      && ts === Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return {
      ts,
      current: Math.round(players),
      source: "steamcharts",
      granularity: hourly ? "hourly" : monthBoundary ? "monthly-peak" : "unknown",
    };
  });
  return snapshots.length > 0 ? { status: "ok", value: snapshots } : { status: "error", error: "No valid historical observations" };
}

const HISTORY_RETENTION_MS = 60 * 86_400_000;
const GAMES_POPULARITY_MAX_PAGES = 2;

/**
 * Fetch recent hourly history from Games Popularity for games SteamCharts lacks.
 * The provider serves newest-first pages, so retain only the local 60-day window.
 */
export async function fetchGamesPopularityHistoryResult(appid: string): Promise<ProviderResult<Snapshot[]>> {
  const now = Date.now();
  const cutoff = now - HISTORY_RETENTION_MS;
  const rows: { readonly ts: number; readonly current: number }[] = [];
  const seenCursors = new Set<string>();
  let oldestValidTimestamp: number | undefined;
  let cursor: string | undefined;

  for (let page = 0; page < GAMES_POPULARITY_MAX_PAGES; page += 1) {
    if (cursor !== undefined && (cursor.length === 0 || seenCursors.has(cursor))) {
      return { status: "error", error: "GamesPopularity history cursor repeated" };
    }
    if (cursor !== undefined) seenCursors.add(cursor);
    const result = await requestWithPolicy({
      url: `https://games-popularity.com/swagger/api/game/players/${encodeURIComponent(appid)}${cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
      timeoutMs: 15_000,
      read: (response) => response.json(),
    });
    if (result.kind === "http-error") {
      return result.status === 404 && page === 0
        ? { status: "unavailable" }
        : { status: "error", error: `GamesPopularity HTTP ${result.status}` };
    }
    if (result.kind === "error") return { status: "error", error: result.error };
    const parsed = GamesPopularityHistorySchema.safeParse(result.value);
    if (!parsed.success) return { status: "error", error: "Invalid GamesPopularity history" };
    if (parsed.data.steamId !== appid) return { status: "error", error: "GamesPopularity Steam ID mismatch" };

    for (const record of parsed.data.history) {
      const ts = parseGamesPopularityTimestamp(record.added);
      if (ts === null || ts > now || !Number.isFinite(record.players) || record.players < 0) continue;
      oldestValidTimestamp = oldestValidTimestamp === undefined || ts < oldestValidTimestamp ? ts : oldestValidTimestamp;
      if (ts < cutoff) continue;
      rows.push({ ts, current: Math.round(record.players) });
    }

    if (parsed.data.history.length > 0 && rows.length === 0) {
      return { status: "error", error: "No valid GamesPopularity observations" };
    }
    const nextCursor = parsed.data.nextCursor ?? undefined;
    if (cursor !== undefined && nextCursor === cursor) {
      return { status: "error", error: "GamesPopularity history cursor repeated" };
    }
    const needsAnotherPage = oldestValidTimestamp === undefined || oldestValidTimestamp > cutoff;
    if (!needsAnotherPage || nextCursor === undefined || page === GAMES_POPULARITY_MAX_PAGES - 1) break;
    cursor = nextCursor;
  }

  const snapshots = [...new Map(rows.map((row) => [row.ts, row.current])).entries()]
    .sort(([left], [right]) => left - right)
    .map(([ts, current]): Snapshot => ({ ts, current, source: "games-popularity", granularity: "hourly" }));
  return snapshots.length > 0
    ? { status: "ok", value: snapshots }
    : { status: "unavailable" };
}

/** Prefer SteamCharts where available and use Games Popularity only as history fallback. */
export async function fetchPlayerHistoryResult(appid: string): Promise<ProviderResult<Snapshot[]>> {
  const primary = await fetchSteamChartsHistoryResult(appid);
  if (primary.status === "ok") return primary;
  const fallback = await fetchGamesPopularityHistoryResult(appid);
  if (fallback.status === "ok") return fallback;
  if (fallback.status === "error") return fallback;
  return primary.status === "error" ? primary : { status: "unavailable" };
}

function parseGamesPopularityTimestamp(value: string): number | null {
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const timestamp = Date.parse(withZone);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

export async function fetchTwitchViewers(gameName: string): Promise<number | null> {
  const result = await fetchTwitchResult(gameName);
  return result.status === "ok" ? result.value : null;
}

export async function fetchTwitchResult(gameName: string): Promise<ProviderResult<number>> {
  let error: string | undefined;
  for (const candidate of buildTwitchNameCandidates(gameName)) {
    const body = JSON.stringify([{
      query: "query($name:String!){game(name:$name){viewersCount}}",
      variables: { name: candidate },
    }]);
    const result = await requestWithPolicy({
      url: "https://gql.twitch.tv/gql",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        },
        body,
      },
      read: (response) => response.json(),
    });
    if (result.kind === "error") {
      error = result.error;
      continue;
    }
    if (result.kind === "http-error") {
      error = `Twitch HTTP ${result.status}`;
      continue;
    }
    const parsed = TwitchGqlSchema.safeParse(result.value);
    if (!parsed.success) return { status: "error", error: "invalid Twitch response" };
    const viewers = parsed.data[0]?.data?.game?.viewersCount;
    if (viewers !== undefined) return { status: "ok", value: viewers };
  }
  return error === undefined ? { status: "unavailable" } : { status: "error", error };
}

/**
 * Search Steam Store for games matching a query.
 */
export async function searchGames(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const result = await requestWithPolicy({
    url: `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US&f=games`,
    read: (response) => response.json(),
  });
  if (result.kind !== "response") return [];
  const parsed = StoreSearchSchema.safeParse(result.value);
  if (!parsed.success) return [];
  return parsed.data.items.slice(0, 8).map((item) => ({
    appid: String(item.id),
    name: item.name,
    image: item.tiny_image || item.small_capsule_image || STEAM_CAPSULE_URL(String(item.id)),
  }));
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
    .replace(/[‘’]/g, "'")
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
