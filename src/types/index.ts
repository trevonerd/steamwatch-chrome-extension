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
  /** Price in cents, e.g. 2499 = $24.99. Present only for paid games. */
  readonly priceOriginal?: number;
  readonly priceCurrent?: number;
  /** 0–100 sale discount percentage. Absent or 0 = not on sale. */
  readonly discountPct?: number;
  readonly priceFormatted?: string;
  readonly priceOriginalFormatted?: string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface Settings {
  trendEnabled: boolean;
  purgeAfterDays: number;
  notificationsEnabled: boolean;
  spikeDetection: boolean;
  globalThresholdUp: number;    // positive %, e.g. 30
  globalThresholdDown: number;  // negative %, e.g. -25
  crashThreshold: number;       // negative %, e.g. -50
  fetchIntervalMinutes: number;
  // Quiet hours
  quietHoursEnabled: boolean;
  quietStart: string;           // "HH:MM" 24h local time, e.g. "23:00"
  quietEnd: string;             // "HH:MM" 24h local time, e.g. "07:00"
  quietDays: QuietDaysMask;     // bitmask; 0b1111111 = every day
  // Dynamic ranking
  rankByPlayers: boolean;       // sort popup cards by current player count
  // Price drop alerts
  priceAlertsEnabled: boolean;  // notify on Steam sales
  priceDropMinPct: number;      // minimum discount % to trigger alert, e.g. 30
  // Badge favorite
  badgeFavoriteAppid?: string;  // appid of the game whose count shows on the badge
}

/** Per-game overrides. Undefined fields fall back to global Settings. */
export interface GameSettings {
  thresholdUp?: number;
  thresholdDown?: number;
  crashThreshold?: number;
  notifyThresholdPlayers?: number;
  notificationsEnabled?: boolean;
  priceAlertsEnabled?: boolean;  // per-game override for price drop alerts
}

// ── Trend ────────────────────────────────────────────────────────────────────

export type TrendKey =
  | "EXPLOSION"
  | "STRONG_UP"
  | "UP"
  | "STABLE"
  | "DOWN"
  | "STRONG_DOWN"
  | "CRASH";

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

export interface SpikeResult {
  readonly type: "spike_up" | "spike_down";
  readonly pct: number;
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

/** A single Steam news item for a game. */
export interface SteamNewsItem {
  readonly title: string;
  readonly url: string;
  readonly date: number; // Unix timestamp (seconds)
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

export interface SparklineOptions {
  readonly width: number;
  readonly height: number;
  readonly strokeColor: string;
  readonly fillColor: string;
  /** How many most-recent snapshots to include. */
  readonly maxPoints: number;
}

// ── Export ────────────────────────────────────────────────────────────────────

export type ExportFormat = "json" | "csv";

export interface ExportRow {
  appid: string;
  name: string;
  ts: number;
  date: string;
  current: number;
}

// ── Forecast ──────────────────────────────────────────────────────────────────

/** Linear regression forecast for a future time horizon. */
export interface ForecastResult {
  readonly projected: number;
  readonly changePct: number;
  readonly hoursAhead: number;
  readonly r2: number;
  readonly reliable: boolean;
}

// ── Quiet hours ───────────────────────────────────────────────────────────────

/**
 * Bitmask of days of the week on which quiet hours are active.
 * Bit 0 = Sunday, bit 1 = Monday … bit 6 = Saturday (matches Date.getDay()).
 */
export type QuietDaysMask = number;

export type GraphWindowKey = "24h" | "3d" | "retention";

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
  readonly avg24h?: number;
  readonly gain24h?: number;
  readonly retentionAvg?: number;
  readonly retentionGain?: number;
  readonly retentionDays: number;
  readonly availableGraphWindows: readonly GraphWindowOption[];
  readonly defaultGraphWindow: GraphWindowKey | null;
  readonly trend: TrendResult | null;
  readonly trendCls: string;
  readonly latestChangePct: number | null;
  readonly snaps: readonly Snapshot[];
  readonly sparklineStroke: string;
  readonly svgStr: string | null;
  /** Timestamp of the last successful fetch (0 if never). */
  readonly fetchedAt: number;
  readonly twitchViewers?: number;
  /** Price drop / sale fields. Present only for paid games currently on sale. */
  readonly discountPct?: number;
  readonly priceFormatted?: string;
  readonly priceOriginalFormatted?: string;
}
