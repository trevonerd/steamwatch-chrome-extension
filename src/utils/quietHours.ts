// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/quietHours.ts
// Pure functions for quiet-hours enforcement.
// No side effects, no I/O — every function takes a Date and returns a value.
// ─────────────────────────────────────────────────────────────────────────────

import type { Settings, QuietDaysMask } from "../types/index.js";

// ── Core check ────────────────────────────────────────────────────────────────

/**
 * Return true if notifications should be suppressed right now.
 *
 * The logic handles overnight windows correctly:
 *   - "23:00" → "07:00" spans midnight and is treated as a continuous block.
 *   - "08:00" → "18:00" is a same-day daytime window.
 *
 * @param settings  Global settings object (reads quietHoursEnabled, quietStart,
 *                  quietEnd, quietDays).
 * @param now       The current time to evaluate. Defaults to `new Date()`.
 *                  Injectable for testing.
 */
export function isQuietNow(settings: Settings, now: Date = new Date()): boolean {
  if (!settings.quietHoursEnabled) return false;

  const dayBit = 1 << now.getDay(); // Sunday = bit 0, Saturday = bit 6
  if ((settings.quietDays & dayBit) === 0) return false;

  return isInQuietWindow(
    settings.quietStart,
    settings.quietEnd,
    now.getHours(),
    now.getMinutes()
  );
}

/**
 * Core window check — separated for isolated unit testing.
 *
 * @param start   "HH:MM" string (24h)
 * @param end     "HH:MM" string (24h)
 * @param h       Current hour (0–23)
 * @param m       Current minute (0–59)
 */
export function isInQuietWindow(
  start: string,
  end: string,
  h: number,
  m: number
): boolean {
  const startMins = parseHHMM(start);
  const endMins   = parseHHMM(end);
  const nowMins   = h * 60 + m;

  if (startMins <= endMins) {
    // Same-day window: e.g. 08:00 → 18:00
    return nowMins >= startMins && nowMins < endMins;
  } else {
    // Overnight window: e.g. 23:00 → 07:00
    return nowMins >= startMins || nowMins < endMins;
  }
}

// ── Day helpers ───────────────────────────────────────────────────────────────

/** Build a bitmask from an array of day indices (0 = Sun … 6 = Sat). */
export function buildDayMask(days: number[]): QuietDaysMask {
  return days.reduce((mask, d) => mask | (1 << d), 0);
}

/** Return an array of active day indices from a bitmask. */
export function maskToDays(mask: QuietDaysMask): number[] {
  return Array.from({ length: 7 }, (_, i) => i).filter((i) => (mask & (1 << i)) !== 0);
}

/** Human-readable label for a day index (short, always English). */
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ── Private helpers ───────────────────────────────────────────────────────────

/** Parse "HH:MM" to total minutes since midnight. */
function parseHHMM(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}
