// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/types/index.ts
// Central type definitions. Import from here, never duplicate.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

export const ChartDataSchema = z.array(z.tuple([z.number().finite(), z.number().finite()]));

// ── Domain models ─────────────────────────────────────────────────────────────

export const GameSchema = z.object({
  appid: z.string(),
  name: z.string(),
  image: z.string(),
});

export interface Game {
  readonly appid: string;
  readonly name: string;
  readonly image: string;
}

/** Origin of a persisted player-count value. */
export type SnapshotSource = "steam" | "steamcharts" | "games-popularity" | "legacy";

/** Resolution of a persisted player-count value. */
export type SnapshotGranularity =
  | "instant"
  | "hourly"
  | "monthly-peak"
  | "daily"
  | "weekly"
  | "unknown";

export const SnapshotSourceSchema = z.enum(["steam", "steamcharts", "games-popularity", "legacy"]);

export const GamesPopularityHistorySchema = z.object({
  steamId: z.string(),
  history: z.array(z.object({ players: z.number().finite().nonnegative(), added: z.string() })).max(1000),
  nextCursor: z.string().nullable().optional(),
});
export const SnapshotGranularitySchema = z.enum([
  "instant",
  "hourly",
  "monthly-peak",
  "daily",
  "weekly",
  "unknown",
]);

/** Statistics retained when multiple observations are compacted into one row. */
export interface SnapshotAggregate {
  readonly startTs: number;
  readonly endTs: number;
  readonly sampleCount: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly minTs: number;
  readonly maxTs: number;
  readonly observedDurationMs: number;
}

export const SnapshotAggregateSchema = z.object({
  startTs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  endTs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sampleCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sum: z.number().finite().nonnegative(),
  min: z.number().finite().nonnegative(),
  max: z.number().finite().nonnegative(),
  minTs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxTs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  observedDurationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).refine((aggregate) => aggregate.startTs <= aggregate.endTs, {
  message: "aggregate start must not be after end",
});

/** A single player-count sample stored over time. */
export interface Snapshot {
  readonly ts: number;      // Unix ms timestamp
  readonly current: number; // Concurrent players at this moment
  /** Absent only before a legacy row is normalized on read. */
  readonly source?: SnapshotSource;
  /** Absent only before a legacy row is normalized on read. */
  readonly granularity?: SnapshotGranularity;
  /** Present for compacted observations; raw samples remain unaggregated. */
  readonly aggregate?: SnapshotAggregate;
}

export const SnapshotSchema = z.object({
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  current: z.number().finite().nonnegative(),
  source: SnapshotSourceSchema.optional(),
  granularity: SnapshotGranularitySchema.optional(),
  aggregate: SnapshotAggregateSchema.optional(),
});

export type BootstrapState = "leased" | "retry" | "unavailable" | "completed";

/** A time-bounded, single-writer claim for one game's historical import. */
export interface BootstrapLease {
  readonly appId: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly attempt: number;
}

/** Durable import status, deliberately separate from notification cooldowns. */
export interface BootstrapStatus {
  readonly appId: string;
  readonly state: BootstrapState;
  readonly attempt: number;
  readonly retryAt?: number;
  readonly completedAt?: number;
  readonly importedCount?: number;
  readonly startTs?: number;
  readonly endTs?: number;
}

export type ProviderResult<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "unavailable" }
  | { readonly status: "error"; readonly error: string };

export const FieldFreshnessSchema = z.object({
  source: z.enum(["steam", "steamcharts", "steamspy", "twitch", "legacy"]),
  status: z.enum(["ok", "error", "unavailable"]),
  acquiredAt: z.number().finite().nonnegative().optional(),
  attemptedAt: z.number().finite().nonnegative(),
});

export type FieldFreshness = z.infer<typeof FieldFreshnessSchema>;
export type MetricKey = "current" | "peak24h" | "allTimePeak" | "twitchViewers";
export type MetricFreshness = z.infer<typeof MetricFreshnessSchema>;

export const MetricFreshnessSchema = z.object({
  current: FieldFreshnessSchema.optional(),
  peak24h: FieldFreshnessSchema.optional(),
  allTimePeak: FieldFreshnessSchema.optional(),
  twitchViewers: FieldFreshnessSchema.optional(),
});

/** Latest fetched stats kept in cache for immediate popup display. */
export interface CachedData {
  readonly current: number;
  readonly peak24h?: number;
  readonly allTimePeak?: number;
  readonly allTimePeakLabel?: string;
  readonly localAllTimePeak?: number;
  readonly fetchedAt: number;
  readonly twitchViewers?: number;
  readonly freshness?: MetricFreshness;
}

/** Validates cache entries restored from chrome.storage.local. */
export const CachedDataSchema = z.object({
  current: z.number().finite().nonnegative(),
  peak: z.number().finite().nonnegative().optional(),
  peak24h: z.number().finite().nonnegative().optional(),
  allTimePeak: z.number().finite().nonnegative().optional(),
  allTimePeakLabel: z.string().optional(),
  localAllTimePeak: z.number().finite().nonnegative().optional(),
  fetchedAt: z.number().finite().nonnegative(),
  twitchViewers: z.number().finite().nonnegative().optional(),
  freshness: MetricFreshnessSchema.catch({}).optional(),
}).passthrough();

// ── Settings ─────────────────────────────────────────────────────────────────

export interface Settings {
  notificationsEnabled: boolean;
  globalThresholdUp: number;    // positive %, e.g. 30
  globalThresholdDown: number;  // negative %, e.g. -25
  // Quiet hours
  quietHoursEnabled: boolean;
  quietStart: string;           // "HH:MM" 24h local time, e.g. "23:00"
  quietEnd: string;             // "HH:MM" 24h local time, e.g. "07:00"
  quietDays: QuietDaysMask;     // bitmask; 0b1111111 = every day
  // Badge favorite
  badgeFavoriteAppid?: string;  // appid of the game whose count shows on the badge
}

/** Per-game overrides. Undefined fields fall back to global Settings. */
export interface GameSettings {
  thresholdUp?: number;
  thresholdDown?: number;
  notifyThresholdPlayers?: number;
  notifyBelowPlayers?: number;
  notificationsEnabled?: boolean;
}

/** Validates individual per-game notification overrides from local storage. */
export const GameSettingsSchema = z.object({
  thresholdUp: z.number().finite().positive().optional(),
  thresholdDown: z.number().finite().negative().optional(),
  notifyThresholdPlayers: z.number().finite().nonnegative().optional(),
  notifyBelowPlayers: z.number().finite().nonnegative().optional(),
  notificationsEnabled: z.boolean().optional(),
}).strip();

export const QuietTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

/** Parses stored global settings field by field during controlled recovery. */
export const SettingsSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  globalThresholdUp: z.number().finite().optional(),
  globalThresholdDown: z.number().finite().optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietStart: QuietTimeSchema.optional(),
  quietEnd: QuietTimeSchema.optional(),
  quietDays: z.number().int().optional(),
  badgeFavoriteAppid: z.string().min(1).optional(),
}).strip();

// ── Trend ────────────────────────────────────────────────────────────────────

export type TrendKey =
  | "EXPLOSION"
  | "STRONG_UP"
  | "UP"
  | "STABLE"
  | "DOWN"
  | "STRONG_DOWN";

export interface TrendLevel {
  readonly key: TrendKey;
  readonly label: string;
  readonly icon: string;
  readonly cls: string;
  /** Minimum % to qualify for this level (descending order). */
  readonly minPct: number;
}

export interface TrendResult {
  readonly level: TrendLevel;
  readonly pct: number;   // rounded to 1 decimal
  readonly delta: number; // absolute player count delta
  readonly sustained?: boolean;
}

// ── Background ↔ UI messages ──────────────────────────────────────────────────

export type MessageRequest =
  | { readonly type: "FETCH_NOW"; readonly retryHistory?: boolean }
  | { readonly type: "RESET_ALARM" };

export interface MessageResponse {
  readonly ok: boolean;
  readonly error?: string;
}

export const MessageResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

// ── API data ──────────────────────────────────────────────────────────────────

export const AppDetailsSchema = z.record(z.string(), z.object({
  success: z.boolean(),
  data: z.object({
    name: z.string(),
    header_image: z.string().optional(),
    capsule_image: z.string().optional(),
  }).optional(),
}));

export interface SearchResult {
  readonly appid: string;
  readonly name: string;
  readonly image: string;
}

export interface SteamSpyData {
  readonly peak: number;
  readonly name: string;
}

export interface SteamChartsData {
  readonly current?: number;
  readonly peak24h?: number;
  readonly allTimePeak?: number;
  readonly allTimePeakLabel?: string;
}

// ── Quiet hours ───────────────────────────────────────────────────────────────

/**
 * Bitmask of days of the week on which quiet hours are active.
 * Bit 0 = Sunday, bit 1 = Monday … bit 6 = Saturday (matches Date.getDay()).
 */
export type QuietDaysMask = number;

export type GraphWindowKey = "24h" | "3d" | "7d" | "15d" | "1m" | "all";

export interface GraphWindowOption {
  readonly key: GraphWindowKey;
  readonly label: string;
  readonly windowMs: number;
}

// ── Card view model ───────────────────────────────────────────────────────────

/**
 * All derived display values for a single game card.
 * Computed once by `buildCardViewModel` and reused by the popup renderer,
 * the share-text builder, and the canvas renderer — no duplication.
 */
export interface CardViewModel {
  readonly game: Game;
  readonly current: number | null;
  readonly peak24h: number | null;
  /** Best available all-time peak from fetched stats and local fallback. */
  readonly allTimePeak: number | null;
  readonly allTimePeakLabel?: string;
  /**
   * Primary % shown in the popup list.
   *
   * This represents the *trend* signal (smoothed change), not a ratio vs peak.
   * Null when there isn't enough local history.
   */
  readonly displayTrendPct: number | null;
  /** Icon paired with `displayTrendPct` (e.g. 📈/📉/➡️). Null when pct is null. */
  readonly displayTrendIcon: string | null;
  /** CSS class for the badge colour (e.g. up/down/stable/strong-up/strong-down). */
  readonly displayTrendCls: string;
  readonly avg24h?: number;
  readonly gain24h?: number;
  readonly retentionAvg?: number;
  readonly retentionGain?: number;
  readonly retentionDays: number;
  readonly retentionWindowLabel: string;
  readonly availableGraphWindows: readonly GraphWindowOption[];
  readonly defaultGraphWindow: GraphWindowKey | null;
  readonly trend: TrendResult | null;
  readonly trendCls: string;
  readonly latestChangePct: number | null;
  readonly snaps: readonly Snapshot[];
  readonly sparklineStroke: string;
  /** Timestamp of the last successful fetch (0 if never). */
  readonly fetchedAt: number;
  readonly freshness?: MetricFreshness;
  readonly twitchViewers?: number;
  readonly historyStatus?: BootstrapStatus;
  readonly historyLoading?: boolean;
  readonly seasonalAnalysis?: SeasonalTrendAnalysis;
  readonly observedPeak?: number;
  readonly evaluatedAt?: number;
  /** Minimum within the active graph window: { value, timestamp } or null. */
  readonly recordLow: { value: number; timestamp: number } | null;
  /** Minimum across all snapshots: { value, timestamp } or null. */
  readonly allTimeLow: { value: number; timestamp: number } | null;
}

// ── External API schemas ──────────────────────────────────────────────────────

export const PlayerCountSchema = z.object({
  response: z.object({ player_count: z.number().int().nonnegative() }),
});

export const StoreSearchSchema = z.object({
  items: z.array(z.object({
    id: z.number(),
    name: z.string(),
    tiny_image: z.string().optional(),
    small_capsule_image: z.string().optional(),
  })).default([]),
});

export const SteamSpySchema = z.object({
  peak_ccu: z.number().finite().nonnegative().default(0),
  name: z.string().default(""),
});

export const TwitchGqlSchema = z.array(z.object({
  data: z.object({
    game: z.object({ viewersCount: z.number().int().nonnegative() }).nullable(),
  }).optional(),
}));

export interface WeeklyComparison {
  readonly startTs: number;
  readonly endTs: number;
  readonly baselineStartTs: number;
  readonly recentMean: number;
  readonly baselineMean: number;
  readonly matchedHours: number;
  readonly risingDays: number;
  readonly fallingDays: number;
}

export type SeasonalTrendAnalysis =
  | { readonly status: "ready"; readonly trend: TrendResult; readonly coverage: number; readonly reason: string; readonly comparison?: WeeklyComparison }
  | { readonly status: "insufficient" | "stale" | "low-baseline"; readonly coverage: number; readonly reason: string };
