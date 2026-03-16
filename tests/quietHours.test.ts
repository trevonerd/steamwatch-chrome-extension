// tests/quietHours.test.ts
import { describe, it, expect } from "vitest";
import {
  isInQuietWindow,
  isQuietNow,
  buildDayMask,
  maskToDays,
  DAY_LABELS,
} from "../src/utils/quietHours.js";
import type { Settings } from "../src/types/index.js";
import { DEFAULT_SETTINGS } from "../src/utils/storage.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a Date for a specific day-of-week, hour, and minute. */
function dateAt(dayOfWeek: number, hour: number, minute = 0): Date {
  const d = new Date();
  const diff = dayOfWeek - d.getDay();
  d.setDate(d.getDate() + diff);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function settingsWithQuiet(
  enabled: boolean,
  start: string,
  end: string,
  days: number[] = [0, 1, 2, 3, 4, 5, 6]
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    quietHoursEnabled: enabled,
    quietStart: start,
    quietEnd: end,
    quietDays: buildDayMask(days),
  };
}

// ── isInQuietWindow — same-day window ─────────────────────────────────────────

describe("isInQuietWindow — same-day (08:00 → 18:00)", () => {
  it("returns true at start boundary", () => {
    expect(isInQuietWindow("08:00", "18:00", 8, 0)).toBe(true);
  });

  it("returns true mid-window", () => {
    expect(isInQuietWindow("08:00", "18:00", 13, 30)).toBe(true);
  });

  it("returns false at end boundary (exclusive)", () => {
    expect(isInQuietWindow("08:00", "18:00", 18, 0)).toBe(false);
  });

  it("returns false before window", () => {
    expect(isInQuietWindow("08:00", "18:00", 7, 59)).toBe(false);
  });

  it("returns false after window", () => {
    expect(isInQuietWindow("08:00", "18:00", 20, 0)).toBe(false);
  });
});

// ── isInQuietWindow — overnight window ───────────────────────────────────────

describe("isInQuietWindow — overnight (23:00 → 07:00)", () => {
  it("returns true just after start (23:01)", () => {
    expect(isInQuietWindow("23:00", "07:00", 23, 1)).toBe(true);
  });

  it("returns true at midnight", () => {
    expect(isInQuietWindow("23:00", "07:00", 0, 0)).toBe(true);
  });

  it("returns true just before end (06:59)", () => {
    expect(isInQuietWindow("23:00", "07:00", 6, 59)).toBe(true);
  });

  it("returns false at end boundary (07:00, exclusive)", () => {
    expect(isInQuietWindow("23:00", "07:00", 7, 0)).toBe(false);
  });

  it("returns false outside the window (12:00)", () => {
    expect(isInQuietWindow("23:00", "07:00", 12, 0)).toBe(false);
  });

  it("returns true at start boundary (23:00)", () => {
    expect(isInQuietWindow("23:00", "07:00", 23, 0)).toBe(true);
  });
});

// ── isQuietNow ────────────────────────────────────────────────────────────────

describe("isQuietNow", () => {
  it("returns false when quietHoursEnabled is false", () => {
    const s = settingsWithQuiet(false, "23:00", "07:00");
    // Simulate 2 AM on a day that's in the mask
    const d = dateAt(1, 2); // Monday 02:00
    expect(isQuietNow(s, d)).toBe(false);
  });

  it("returns true during window on an active day", () => {
    const s = settingsWithQuiet(true, "23:00", "07:00", [1]); // Monday only
    const d = dateAt(1, 2); // Monday 02:00 — inside window
    expect(isQuietNow(s, d)).toBe(true);
  });

  it("returns false on a day not in the mask", () => {
    const s = settingsWithQuiet(true, "23:00", "07:00", [1]); // Monday only
    const d = dateAt(2, 2); // Tuesday 02:00
    expect(isQuietNow(s, d)).toBe(false);
  });

  it("returns false outside window even on active day", () => {
    const s = settingsWithQuiet(true, "23:00", "07:00", [1]);
    const d = dateAt(1, 14); // Monday 14:00 — outside window
    expect(isQuietNow(s, d)).toBe(false);
  });

  it("respects multi-day mask", () => {
    const s = settingsWithQuiet(true, "08:00", "18:00", [1, 3]); // Mon + Wed
    expect(isQuietNow(s, dateAt(1, 12))).toBe(true);  // Monday noon — inside
    expect(isQuietNow(s, dateAt(3, 12))).toBe(true);  // Wednesday noon — inside
    expect(isQuietNow(s, dateAt(2, 12))).toBe(false); // Tuesday noon — not in mask
  });
});

// ── buildDayMask / maskToDays ─────────────────────────────────────────────────

describe("buildDayMask", () => {
  it("returns 0 for empty array", () => {
    expect(buildDayMask([])).toBe(0);
  });

  it("sets correct bit for a single day", () => {
    expect(buildDayMask([0])).toBe(1);  // Sunday = bit 0
    expect(buildDayMask([1])).toBe(2);  // Monday = bit 1
    expect(buildDayMask([6])).toBe(64); // Saturday = bit 6
  });

  it("sets all 7 bits for every day", () => {
    expect(buildDayMask([0,1,2,3,4,5,6])).toBe(0b1111111);
  });
});

describe("maskToDays", () => {
  it("returns empty array for mask 0", () => {
    expect(maskToDays(0)).toEqual([]);
  });

  it("returns all 7 days for full mask", () => {
    expect(maskToDays(0b1111111)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("round-trips through buildDayMask", () => {
    const days = [1, 3, 5];
    expect(maskToDays(buildDayMask(days))).toEqual(days);
  });
});

// ── DAY_LABELS ────────────────────────────────────────────────────────────────

describe("DAY_LABELS", () => {
  it("has 7 entries", () => {
    expect(DAY_LABELS).toHaveLength(7);
  });

  it("starts with Sun and ends with Sat", () => {
    expect(DAY_LABELS[0]).toBe("Sun");
    expect(DAY_LABELS[6]).toBe("Sat");
  });
});
