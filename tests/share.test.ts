// tests/share.test.ts
import { describe, it, expect } from "vitest";
import { buildShareGraphSeries, buildShareText } from "../src/utils/share.js";
import type { CardViewModel, Game, CachedData, Snapshot } from "../src/types/index.js";
import { buildCardViewModel } from "../src/utils/card.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const game: Game = {
  appid: "1245620",
  name:  "Elden Ring",
  image: "https://cdn.akamai.steamstatic.com/steam/apps/1245620/capsule_sm_120.jpg",
};

function makeSnaps(values: number[], intervalMs = 60 * 60_000): Snapshot[] {
  const base = Date.now() - values.length * intervalMs;
  return values.map((current, i) => ({
    ts: base + i * intervalMs,
    current,
    source: "steamcharts",
    granularity: "hourly",
  }));
}

function makeVM(overrides: Partial<{ snaps: Snapshot[]; allTimePeak: number; peak24h: number; fetchedAt: number }>): CardViewModel {
  const snaps = overrides.snaps ?? makeSnaps([30000,31000,32000,33000,34000,35000,36000,37000,38000,39000,40000,41000]);
  const fetchedAt = overrides.fetchedAt ?? Date.now() - 60_000;
  const allTimePeak = overrides.allTimePeak ?? 953_271;
  const peak24h = overrides.peak24h ?? 40_000;
  const cache: Record<string, CachedData> = {
    [game.appid]: {
      current: 35_000,
      peak24h,
      allTimePeak,
      allTimePeakLabel: "2 months ago",
      fetchedAt,
      freshness: { allTimePeak: { source: "steamcharts", status: "ok", acquiredAt: fetchedAt, attemptedAt: fetchedAt } },
    },
  };
  return buildCardViewModel(game, cache, snaps, 7);
}

// ── Structure ─────────────────────────────────────────────────────────────────

describe("buildShareText — structure", () => {
  it("starts with the game name", () => {
    const text = buildShareText(makeVM({}));
    expect(text.startsWith("🎮 Elden Ring")).toBe(true);
  });

  it("includes 'SteamWatch' in the first line", () => {
    const lines = buildShareText(makeVM({})).split("\n");
    expect(lines[0]).toContain("SteamWatch");
  });

  it("ends with the GitHub URL", () => {
    const text = buildShareText(makeVM({}));
    expect(text).toContain("github.com/trevonerd");
  });

  it("includes SteamDB URL with the correct appid", () => {
    const text = buildShareText(makeVM({}));
    expect(text).toContain("steamdb.info/app/1245620");
  });

  it("includes a separator line", () => {
    const text = buildShareText(makeVM({}));
    expect(text).toContain("─────");
  });

  it("does not contain the literal string 'null' or 'undefined'", () => {
    const text = buildShareText(makeVM({}));
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });

  it("produces a multi-line string", () => {
    const lines = buildShareText(makeVM({})).split("\n");
    expect(lines.length).toBeGreaterThan(4);
  });
});

// ── Players ───────────────────────────────────────────────────────────────────

describe("buildShareText — players", () => {
  it("includes the current player count", () => {
    const text = buildShareText(makeVM({}));
    expect(text).toContain("35");   // formatted as "35k"
  });

  it("includes the all-time peak count", () => {
    const text = buildShareText(makeVM({}));
    expect(text).toContain("953"); // formatted as "953.3k" or similar
  });

  it("includes the 24h peak count", () => {
    const text = buildShareText(makeVM({}));
    expect(text).toContain("40");
  });
});

// ── Trend ─────────────────────────────────────────────────────────────────────

describe("buildShareText — trend", () => {
  it("includes trend percentage when trend is available", () => {
    const vm = makeVM({});
    const text = buildShareText(vm);
    if (vm.trend) {
      // Should contain the trend label
      expect(text).toContain(vm.trend.level.label);
    }
  });

  it("includes the reason when a seasonal trend is unavailable", () => {
    const vm = makeVM({ snaps: makeSnaps([1000, 2000, 3000]) });
    const text = buildShareText(vm);
    expect(vm.trend).toBeNull();
    expect(text).toContain("Trend unavailable:");
    expect(text).toContain(vm.seasonalAnalysis?.reason);
  });
});

// ── Latest change ─────────────────────────────────────────────────────────────

describe("buildShareText — latest change", () => {
  it("includes the latest change line when at least 2 snapshots exist", () => {
    const vm = makeVM({});
    const text = buildShareText(vm);
    expect(text).toContain("Latest change:");
  });

  it("omits the latest change line when only one snapshot exists", () => {
    const vm = makeVM({ snaps: makeSnaps([1000]) });
    const text = buildShareText(vm);
    expect(text).not.toContain("Latest change:");
  });
});

// ── Updated timestamp ─────────────────────────────────────────────────────────

describe("buildShareText — timestamp", () => {
  it("includes updated time when fetchedAt > 0", () => {
    const vm = makeVM({ fetchedAt: Date.now() - 3 * 60_000 });
    const text = buildShareText(vm);
    expect(text).toContain("Updated:");
  });

  it("omits updated line when fetchedAt is 0", () => {
    const vm = makeVM({ fetchedAt: 0 });
    const text = buildShareText(vm);
    expect(text).not.toContain("Updated:");
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("buildShareText — edge cases", () => {
  it("handles a game name with special characters without throwing", () => {
    const specialGame: Game = { appid: "1", name: "Tom & Jerry: The <Chase>", image: "" };
    const now = Date.now();
    const cache = {
      "1": {
        current: 100,
        peak24h: 200,
        allTimePeak: 1000,
        fetchedAt: now,
        freshness: { allTimePeak: { source: "steamcharts" as const, status: "ok" as const, acquiredAt: now, attemptedAt: now } },
      },
    };
    const vm = buildCardViewModel(specialGame, cache, makeSnaps([100, 200, 300]), 7);
    expect(() => buildShareText(vm)).not.toThrow();
    const text = buildShareText(vm);
    expect(text).toContain("Tom & Jerry");
  });

  it("is a pure function — same input always produces same output", () => {
    const vm = makeVM({});
    expect(buildShareText(vm)).toBe(buildShareText(vm));
  });

  it("labels provider ATH and observed peak separately, including zero values", () => {
    const now = Date.now();
    const vm = buildCardViewModel(game, {
      [game.appid]: {
        current: 0,
        peak24h: 0,
        allTimePeak: 0,
        fetchedAt: now,
        freshness: { allTimePeak: { source: "steamcharts", status: "ok", acquiredAt: now, attemptedAt: now } },
      },
    }, makeSnaps([0, 0]), 7, now);
    const text = buildShareText(vm);
    expect(text).toContain("24h peak: 0");
    expect(text).toContain("Provider ATH: 0");
    expect(text).toContain("Observed peak: 0");
  });
});

describe("buildShareGraphSeries", () => {
  it("uses only qualified 24-hour observations and preserves gaps as segments", () => {
    const now = 1_700_000_000_000;
    const series = buildShareGraphSeries({
      snaps: [
        { ts: now - 23 * 60 * 60_000, current: 10, source: "legacy", granularity: "unknown" },
        { ts: now - 8 * 60 * 60_000, current: 20, source: "steamcharts", granularity: "hourly" },
        { ts: now - 7 * 60 * 60_000, current: 30, source: "steamcharts", granularity: "hourly" },
        { ts: now - 3 * 60 * 60_000, current: 40, source: "steamcharts", granularity: "hourly" },
        { ts: now - 2 * 60 * 60_000, current: 50, source: "steamcharts", granularity: "hourly" },
      ],
    }, now, 340, 36);
    expect(series.segments).toHaveLength(2);
    expect(series.segments.map((segment) => segment.points.map((point) => point.current))).toEqual([[20, 30], [40, 50]]);
  });
});
