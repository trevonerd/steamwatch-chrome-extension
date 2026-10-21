import type { CachedData, Game, GameSettings, PlayerChange, Settings, Snapshot, TrendResult } from "../types/index.js";
import { GameSchema } from "../types/index.js";
import { formatError } from "../utils/log.js";
import { getSteamNews, newsForChange } from "../utils/news.js";
import { isQuietNow } from "../utils/quietHours.js";
import { analyzeSeasonalTrendFromHourly, detectPlayerChanges } from "../utils/seasonal.js";
import { HOUR_MS, type HourlyPoint, normalizeHourly } from "../utils/series.js";
import { fmtBadge, fmtNumber, fmtPct } from "../utils/trend.js";
import { acknowledgeRule, evaluateRule, type RuleKey } from "./notificationRules.js";
import { withNotificationState } from "./notificationState.js";

type Signal = "rising" | "alerting" | "stable";
interface PublishInput {
  readonly game: Game;
  readonly current: number;
  readonly snapshots: readonly Snapshot[];
  readonly settings: Settings;
  readonly gameSettings: GameSettings;
  readonly cache: Record<string, CachedData>;
}

export async function publishLiveResult(input: PublishInput): Promise<Signal> {
  const now = input.cache[input.game.appid]?.fetchedAt ?? Date.now();
  const hourly = normalizeHourly(input.snapshots, now);
  const trend = trendAt(hourly, now);
  const signal = trend && trend.pct >= 10 ? "rising" : trend && trend.pct <= -10 ? "alerting" : "stable";
  if (!input.settings.notificationsEnabled || input.gameSettings.notificationsEnabled === false) return signal;
  await withNotificationState(input.game.appid, async (state, save) => {
    if (!(await isFollowed(input.game.appid))) return;
    const configured = rulesFor(input, hourly, now);
    const enabledKeys = new Set(configured.map((rule) => rule.key));
    for (const key of Object.keys(state)) {
      if (key === "above" || key === "below" || key === "trendUp" || key === "trendDown") {
        if (!enabledKeys.has(key)) delete state[key];
      }
    }
    const events: { readonly key: RuleKey | "change"; readonly id: string; readonly threshold: number }[] = [];
    for (const rule of configured) {
      if ((rule.key === "trendUp" || rule.key === "trendDown") && rule.value === null) {
        // No usable momentum value: drop any pending crossing but keep arming, so a later held crossing still alerts.
        const previous = state[rule.key];
        if (previous) state[rule.key] = { ...acknowledgeRule(previous), armed: previous.armed };
        continue;
      }
      const previous = state[rule.key];
      const result = evaluateRule({ ...rule, now, ...(previous ? { previous } : {}) });
      if (result.state) state[rule.key] = result.state;
      if (result.eventId) events.push({ key: rule.key, id: result.eventId, threshold: rule.threshold });
    }
    const change = newChange(hourly, now, state.changeAt);
    if (change) events.push({ key: "change", id: `change_${change.startTs}`, threshold: 0 });
    // Pending IDs must survive a worker restart before native delivery.
    await save(state);
    if (isQuietNow(input.settings)) return;
    for (const event of events) {
      if (!(await isFollowed(input.game.appid))) return;
      try {
        await chrome.notifications.create(`sw_${input.game.appid}_${event.id}`, {
          type: "basic",
          iconUrl: "/icons/logo-128.png",
          title: `${input.game.name} — ${notificationTitle(event.key, change)}`,
          message:
            event.key === "above" || event.key === "below"
              ? `${fmtNumber(input.current)} players; threshold ${fmtNumber(event.threshold)}. Sustained for 5 minutes.`
              : event.key === "change" && change
                ? await changeMessage(input.game.appid, change, now)
                : `${fmtPct(trend?.pct ?? 0)} average players: last 24 hours vs the same hours a week earlier. Held for 3 hours.`,
          priority: 1,
        });
        if (event.key === "change") {
          if (change) state.changeAt = change.startTs;
        } else {
          const rule = state[event.key];
          if (rule) state[event.key] = acknowledgeRule(rule);
        }
        await save(state);
      } catch (error: unknown) {
        console.warn(`[SteamWatch] Notification delivery failed for ${input.game.appid}: ${formatError(error)}`);
      }
    }
  });
  return signal;
}

function rulesFor(
  input: PublishInput,
  hourly: readonly HourlyPoint[],
  now: number,
): { key: RuleKey; threshold: number; value: number | null }[] {
  const { gameSettings, settings, current } = input;
  // The crossing must hold for the last 3 completed hours: the weakest of the three decides.
  const held = [0, 1, 2].map((hours) => trendAt(hourly, now - hours * HOUR_MS)?.pct ?? null);
  const complete = held.every((value) => value !== null) ? (held as number[]) : null;
  return [
    ...(gameSettings.notifyThresholdPlayers !== undefined
      ? [{ key: "above" as const, threshold: gameSettings.notifyThresholdPlayers, value: current }]
      : []),
    ...(gameSettings.notifyBelowPlayers !== undefined
      ? [{ key: "below" as const, threshold: gameSettings.notifyBelowPlayers, value: current }]
      : []),
    {
      key: "trendUp",
      threshold: gameSettings.thresholdUp ?? settings.globalThresholdUp,
      value: complete ? Math.min(...complete) : null,
    },
    {
      key: "trendDown",
      threshold: gameSettings.thresholdDown ?? settings.globalThresholdDown,
      value: complete ? Math.max(...complete) : null,
    },
  ];
}

function trendAt(hourly: readonly HourlyPoint[], at: number): TrendResult | null {
  const analysis = analyzeSeasonalTrendFromHourly(hourly, at);
  return analysis.status === "ready" ? analysis.trend : null;
}

/** An ongoing change that started in the last 24 hours and has not been announced yet. */
function newChange(hourly: readonly HourlyPoint[], now: number, announcedAt: number | undefined): PlayerChange | null {
  const change = detectPlayerChanges(hourly, now).at(-1);
  return change?.ongoing && now - change.startTs <= 24 * HOUR_MS && change.startTs > (announcedAt ?? 0) ? change : null;
}

function notificationTitle(key: RuleKey | "change", change: PlayerChange | null): string {
  if (key === "above") return "Player count above threshold";
  if (key === "below") return "Player count below threshold";
  if (key === "change") return change?.direction === "rise" ? "Sudden rise" : "Sudden drop";
  return "24h activity alert";
}

async function changeMessage(appid: string, change: PlayerChange, now: number): Promise<string> {
  const base = `${fmtPct(change.pct)} players vs the same hours last week, for ${change.hours} hours.`;
  try {
    const [news] = newsForChange(await getSteamNews(appid, now), change);
    return news ? `${base} Latest news: ${news.title}` : base;
  } catch (error: unknown) {
    console.warn(`[SteamWatch] News lookup failed for ${appid}: ${formatError(error)}`);
    return base;
  }
}

async function isFollowed(appid: string): Promise<boolean> {
  const raw = await chrome.storage.local.get("sw_games");
  const parsed = GameSchema.array().safeParse(raw.sw_games);
  return parsed.success && parsed.data.some((game) => game.appid === appid);
}

export function updateBadge(
  rising: number,
  alerting: number,
  favoriteAppid: string | undefined,
  cache: Record<string, CachedData>,
  gameSignals: ReadonlyMap<string, Signal>,
): void {
  if (favoriteAppid) {
    const cached = cache[favoriteAppid];
    refreshBadgeFromCache(favoriteAppid, cache);
    if (!cached || isStale(cached)) return;
    if (cached) {
      const signal = gameSignals.get(favoriteAppid) ?? "stable";
      const [background, foreground] =
        signal === "alerting"
          ? ["#ff3366", "#ffffff"]
          : signal === "rising"
            ? ["#22c55e", "#000000"]
            : ["#334155", "#94a3b8"];
      chrome.action.setBadgeText({ text: fmtBadge(cached.current) });
      chrome.action.setBadgeBackgroundColor({ color: background });
      chrome.action.setBadgeTextColor?.({ color: foreground });
      return;
    }
  }
  if (alerting > 0) {
    chrome.action.setBadgeText({ text: String(alerting) });
    chrome.action.setBadgeBackgroundColor({ color: "#ff3366" });
    chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
    return;
  }
  if (rising > 0) {
    chrome.action.setBadgeText({ text: String(rising) });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    chrome.action.setBadgeTextColor?.({ color: "#000000" });
    return;
  }
  chrome.action.setBadgeText({ text: "" });
}

/** Refresh a favorite badge immediately after settings/cache changes. */
export function refreshBadgeFromCache(favoriteAppid: string | undefined, cache: Record<string, CachedData>): void {
  if (!favoriteAppid) {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle?.({ title: "SteamWatch" });
    return;
  }
  const cached = cache[favoriteAppid];
  if (!cached) {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle?.({ title: "SteamWatch — favorite unavailable" });
    return;
  }
  if (isStale(cached)) {
    chrome.action.setBadgeText({ text: "?" });
    chrome.action.setBadgeBackgroundColor({ color: "#64748b" });
    chrome.action.setTitle?.({ title: "SteamWatch — favorite data is stale" });
    return;
  }
  chrome.action.setBadgeText({ text: fmtBadge(cached.current) });
  chrome.action.setBadgeBackgroundColor({ color: "#334155" });
  chrome.action.setTitle?.({ title: "SteamWatch" });
}

function isStale(cached: CachedData): boolean {
  return (
    cached.fetchedAt <= 0 ||
    cached.fetchedAt > Date.now() ||
    Date.now() - cached.fetchedAt > 10 * 60_000 ||
    (cached.freshness?.current !== undefined && cached.freshness.current.status !== "ok")
  );
}
