// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/types/index.ts
// Central type definitions. Import from here, never duplicate.
// ─────────────────────────────────────────────────────────────────────────────

// ── Domain models ─────────────────────────────────────────────────────────────

export interface Game {
  readonly appid: string;
  readonly name: string;
  readonly image: string;
}

/** A single player-count sample stored over time. */
export interface Snapshot {
  readonly ts: number;      // Unix ms timestamp
  readonly current: number; // Concurrent players at this moment
}

/** Latest fetched stats kept in cache for immediate popup display. */
export interface CachedData {
  readonly current: number;
  readonly peak24h?: number;
  readonly allTimePeak?: number;
  readonly allTimePeakLabel?: string;
  readonly localAllTimePeak?: number;
  readonly fetchedAt: number;
  readonly twitchViewers?: number;
}

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
  notificationsEnabled?: boolean;
}

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
}

// ── Background ↔ UI messages ──────────────────────────────────────────────────

export type MessageRequest =
  | { readonly type: "FETCH_NOW" }
  | { readonly type: "RESET_ALARM" };

export interface MessageResponse {
  readonly ok: boolean;
  readonly error?: string;
}

// ── API data ──────────────────────────────────────────────────────────────────

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
  readonly twitchViewers?: number;
  /** Minimum within the active graph window: { value, timestamp } or null. */
  readonly recordLow: { value: number; timestamp: number } | null;
  /** Minimum across all snapshots: { value, timestamp } or null. */
  readonly allTimeLow: { value: number; timestamp: number } | null;
}
