import { isQuietNow } from "../utils/quietHours.js";
import { fmtBadge, fmtNumber, computeTrend } from "../utils/trend.js";
import { formatError } from "../utils/log.js";
import { acknowledgeRule, evaluateRule, type RuleKey } from "./notificationRules.js";
import { withNotificationState } from "./notificationState.js";
import { GameSchema } from "../types/index.js";
import type { CachedData, Game, GameSettings, Settings, Snapshot, TrendResult } from "../types/index.js";

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
  const trend = computeTrend(input.snapshots, now);
  const signal = trend && trend.sustained !== false && trend.pct >= 5 ? "rising" : trend && trend.sustained !== false && trend.pct < -5 ? "alerting" : "stable";
  if (!input.settings.notificationsEnabled || input.gameSettings.notificationsEnabled === false) return signal;
  await withNotificationState(input.game.appid, async (state, save) => {
    if (!await isFollowed(input.game.appid)) return;
    const configured = rulesFor(input, trend);
    const enabledKeys = new Set(configured.map((rule) => rule.key));
    for (const key of Object.keys(state)) {
      if (key === "above" || key === "below" || key === "trendUp" || key === "trendDown") {
        if (!enabledKeys.has(key)) delete state[key];
      }
    }
    const events: { readonly key: RuleKey; readonly id: string; readonly threshold: number }[] = [];
    for (const rule of configured) {
      if ((rule.key === "trendUp" || rule.key === "trendDown") && rule.value === null) {
        delete state[rule.key];
        continue;
      }
      const previous = state[rule.key];
      const result = evaluateRule({ ...rule, now, ...(previous ? { previous } : {}) });
      if (result.state) state[rule.key] = result.state;
      if (result.eventId) events.push({ key: rule.key, id: result.eventId, threshold: rule.threshold });
    }
    // Pending IDs must survive a worker restart before native delivery.
    await save(state);
    if (isQuietNow(input.settings)) return;
    for (const event of events) {
      if (!await isFollowed(input.game.appid)) return;
      try {
        await chrome.notifications.create(`sw_${input.game.appid}_${event.id}`, {
          type: "basic", iconUrl: "/icons/logo-128.png",
          title: `${input.game.name} — ${event.key === "above" ? "Player count above threshold" : event.key === "below" ? "Player count below threshold" : "Weekly activity alert"}`,
          message: event.key === "above" || event.key === "below"
            ? `${fmtNumber(input.current)} players; threshold ${fmtNumber(event.threshold)}. Sustained for 5 minutes.`
            : `${trend?.pct ?? 0}% average players: last 7 days vs previous 7 days. At least 5 days agree; threshold held for 5 minutes.`,
          priority: 1,
        });
        const rule = state[event.key];
        if (rule) state[event.key] = acknowledgeRule(rule);
        await save(state);
      } catch (error: unknown) {
        console.warn(`[SteamWatch] Notification delivery failed for ${input.game.appid}: ${formatError(error)}`);
      }
    }
  });
  return signal;
}

function rulesFor(input: PublishInput, trend: TrendResult | null): { key: RuleKey; threshold: number; value: number | null }[] {
  const { gameSettings, settings, current } = input;
  const trendValue = !trend || (trend.sustained === false && (trend.pct >= 5 || trend.pct < -5))
    ? null : Math.abs(trend.delta) >= 10 ? trend.pct : 0;
  return [
    ...(gameSettings.notifyThresholdPlayers !== undefined ? [{ key: "above" as const, threshold: gameSettings.notifyThresholdPlayers, value: current }] : []),
    ...(gameSettings.notifyBelowPlayers !== undefined ? [{ key: "below" as const, threshold: gameSettings.notifyBelowPlayers, value: current }] : []),
    { key: "trendUp", threshold: gameSettings.thresholdUp ?? settings.globalThresholdUp, value: trendValue },
    { key: "trendDown", threshold: gameSettings.thresholdDown ?? settings.globalThresholdDown, value: trendValue },
  ];
}

async function isFollowed(appid: string): Promise<boolean> {
  const raw = await chrome.storage.local.get("sw_games");
  const parsed = GameSchema.array().safeParse(raw["sw_games"]);
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
      const [background, foreground] = signal === "alerting"
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
export function refreshBadgeFromCache(
  favoriteAppid: string | undefined,
  cache: Record<string, CachedData>,
): void {
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
  return cached.fetchedAt <= 0 || cached.fetchedAt > Date.now() || Date.now() - cached.fetchedAt > 10 * 60_000
    || (cached.freshness?.current !== undefined && cached.freshness.current.status !== "ok");
}
