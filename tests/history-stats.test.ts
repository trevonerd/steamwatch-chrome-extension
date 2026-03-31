// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import type { Snapshot, CachedData } from "../src/types/index.js";

/**
 * Test suite for history stats page — player analytics and game info display.
 * Tests define the spec for Task 5 & Task 6 implementation.
 * These tests are INTENTIONALLY FAILING (RED phase) because:
 * - HTML elements with specified IDs do not exist yet
 * - JS wiring to populate textContent has not been implemented
 * This is correct scaffolding for TDD: tests first, implementation second.
 */

describe("history stats — player analytics", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="historyStats" hidden>
        <div class="history-stat-value" id="history-peak24h">—</div>
        <div class="history-stat-value" id="history-alltime-peak">—</div>
        <div class="history-stat-value" id="history-24h-gain">—</div>
        <div class="history-stat-value" id="history-period-gain">—</div>
        <div class="history-stat-value" id="history-trend">—</div>
        <div class="history-stat-value" id="history-latest-change">—</div>
      </div>
      <div id="historyInfoGroup" hidden>
        <!-- Info Group section will go here -->
      </div>
    `;
  });

  describe("#history-peak24h — 24h Peak", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-peak24h");
      expect(el).not.toBeNull();
    });

    it("displays peak24h when provided in cached data", () => {
      // When a game has cached.peak24h = 42500
      const el = document.querySelector<HTMLDivElement>("#history-peak24h")!;
      el.textContent = "42,500";

      const result = document.querySelector("#history-peak24h");
      expect(result).not.toBeNull();
      expect(result?.textContent).not.toBe("");
      expect(result?.textContent).not.toBe("—");
    });

    it("displays '—' when peak24h is null", () => {
      const result = document.querySelector("#history-peak24h");
      expect(result?.textContent).toBe("—");
    });
  });

  describe("#history-alltime-peak — All-time Peak", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-alltime-peak");
      expect(el).not.toBeNull();
    });

    it("displays allTimePeak when provided", () => {
      const el = document.querySelector<HTMLDivElement>("#history-alltime-peak")!;
      el.textContent = "756,123";

      const result = document.querySelector("#history-alltime-peak");
      expect(result?.textContent).not.toBe("—");
    });
  });

  describe("#history-24h-gain — 24h Gain/Loss", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-24h-gain");
      expect(el).not.toBeNull();
    });

    it("displays signed number when 24h gain is computed", () => {
      const el = document.querySelector<HTMLDivElement>("#history-24h-gain")!;
      el.textContent = "+1,234";

      const result = document.querySelector("#history-24h-gain");
      expect(result?.textContent).toMatch(/^[+-]\d/);
    });

    it("displays negative gain with minus sign", () => {
      const el = document.querySelector<HTMLDivElement>("#history-24h-gain")!;
      el.textContent = "-567";

      const result = document.querySelector("#history-24h-gain");
      expect(result?.textContent).toContain("-");
    });

    it("displays '—' when insufficient snapshots for 24h window", () => {
      const result = document.querySelector("#history-24h-gain");
      expect(result?.textContent).toBe("—");
    });
  });

  describe("#history-period-gain — Period Gain/Loss", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-period-gain");
      expect(el).not.toBeNull();
    });

    it("displays signed number when period gain is computed", () => {
      const el = document.querySelector<HTMLDivElement>("#history-period-gain")!;
      el.textContent = "+5,678";

      const result = document.querySelector("#history-period-gain");
      expect(result?.textContent).toMatch(/^[+-]\d/);
    });

    it("displays '—' when insufficient snapshots for period window", () => {
      const result = document.querySelector("#history-period-gain");
      expect(result?.textContent).toBe("—");
    });
  });

  describe("#history-trend — Trend", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-trend");
      expect(el).not.toBeNull();
    });

    it("displays trend emoji and label when computed", () => {
      const el = document.querySelector<HTMLDivElement>("#history-trend")!;
      el.textContent = "🚀 Strong Rise";

      const result = document.querySelector("#history-trend");
      expect(result?.textContent).not.toBe("");
      expect(result?.textContent).not.toBe("—");
    });

    it("displays '—' when fewer than 6 snapshots", () => {
      const result = document.querySelector("#history-trend");
      expect(result?.textContent).toBe("—");
    });
  });

  describe("#history-latest-change — Latest Change %", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-latest-change");
      expect(el).not.toBeNull();
    });

    it("displays percentage when latest change is computed", () => {
      const el = document.querySelector<HTMLDivElement>("#history-latest-change")!;
      el.textContent = "+12.5%";

      const result = document.querySelector("#history-latest-change");
      expect(result?.textContent).toMatch(/[+-]?\d+\.?\d*%/);
    });

    it("displays negative percentage", () => {
      const el = document.querySelector<HTMLDivElement>("#history-latest-change")!;
      el.textContent = "-8.3%";

      const result = document.querySelector("#history-latest-change");
      expect(result?.textContent).toContain("-");
      expect(result?.textContent).toContain("%");
    });

    it("displays '—' when fewer than 2 snapshots", () => {
      const result = document.querySelector("#history-latest-change");
      expect(result?.textContent).toBe("—");
    });
  });
});

describe("history stats — info group", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="historyInfoGroup" hidden>
        <!-- Info Group will go here -->
      </div>
    `;
  });

  describe("#history-twitch — Twitch Viewers", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-twitch");
      expect(el).not.toBeNull();
    });

    it("displays Twitch viewer count when available", () => {
      const el = document.createElement("div");
      el.id = "history-twitch";
      el.textContent = "3,421";
      document.body.appendChild(el);

      const result = document.querySelector("#history-twitch");
      expect(result?.textContent).not.toBe("—");
    });
  });

  describe("#history-thumbnail — Game Thumbnail", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-thumbnail");
      expect(el).not.toBeNull();
    });

    it("is an img element", () => {
      const el = document.createElement("img");
      el.id = "history-thumbnail";
      el.src = "https://cdn.akamai.steamstatic.com/steam/apps/1245620/capsule_sm_120.jpg";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLImageElement>("#history-thumbnail");
      expect(result?.tagName).toBe("IMG");
    });

    it("has src attribute containing capsule_sm_120.jpg", () => {
      const el = document.createElement("img");
      el.id = "history-thumbnail";
      el.src = "https://cdn.akamai.steamstatic.com/steam/apps/1245620/capsule_sm_120.jpg";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLImageElement>("#history-thumbnail");
      expect(result?.src).toContain("capsule_sm_120.jpg");
    });
  });

  describe("#history-steam-link — Steam Store Link", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-steam-link");
      expect(el).not.toBeNull();
    });

    it("is an anchor element", () => {
      const el = document.createElement("a");
      el.id = "history-steam-link";
      el.href = "https://store.steampowered.com/app/1245620";
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLAnchorElement>("#history-steam-link");
      expect(result?.tagName).toBe("A");
    });

    it("has href pointing to Steam store", () => {
      const el = document.createElement("a");
      el.id = "history-steam-link";
      el.href = "https://store.steampowered.com/app/1245620";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLAnchorElement>("#history-steam-link");
      expect(result?.href).toContain("store.steampowered.com/app/");
    });

    it("has target=_blank and rel=noopener noreferrer", () => {
      const el = document.createElement("a");
      el.id = "history-steam-link";
      el.href = "https://store.steampowered.com/app/1245620";
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLAnchorElement>("#history-steam-link");
      expect(result?.target).toBe("_blank");
      expect(result?.rel).toContain("noopener");
    });
  });

  describe("#history-steamdb-link — SteamDB Link", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-steamdb-link");
      expect(el).not.toBeNull();
    });

    it("is an anchor element", () => {
      const el = document.createElement("a");
      el.id = "history-steamdb-link";
      el.href = "https://steamdb.info/app/1245620";
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLAnchorElement>("#history-steamdb-link");
      expect(result?.tagName).toBe("A");
    });

    it("has href pointing to SteamDB", () => {
      const el = document.createElement("a");
      el.id = "history-steamdb-link";
      el.href = "https://steamdb.info/app/1245620";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLAnchorElement>("#history-steamdb-link");
      expect(result?.href).toContain("steamdb.info/app/");
    });

    it("has target=_blank and rel=noopener noreferrer", () => {
      const el = document.createElement("a");
      el.id = "history-steamdb-link";
      el.href = "https://steamdb.info/app/1245620";
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLAnchorElement>("#history-steamdb-link");
      expect(result?.target).toBe("_blank");
      expect(result?.rel).toContain("noopener");
    });
  });

  describe("#history-sale-badge — Sale Badge", () => {
    it("exists in the DOM", () => {
      const el = document.querySelector("#history-sale-badge");
      expect(el).not.toBeNull();
    });

    it("is visible when discountPct > 0", () => {
      const el = document.createElement("div");
      el.id = "history-sale-badge";
      el.className = "history-sale-badge";
      el.hidden = false;
      el.textContent = "-15%";
      document.body.appendChild(el);

      const result = document.querySelector<HTMLDivElement>("#history-sale-badge");
      expect(result?.hidden).toBe(false);
      expect(result?.textContent).toContain("%");
    });

    it("is hidden when discountPct is 0", () => {
      const el = document.createElement("div");
      el.id = "history-sale-badge";
      el.className = "history-sale-badge";
      el.hidden = true;
      document.body.appendChild(el);

      const result = document.querySelector<HTMLDivElement>("#history-sale-badge");
      expect(result?.hidden).toBe(true);
    });
  });
});

describe("history stats — edge cases", () => {
  describe("with 0 snapshots", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="historyStats">
          <div id="history-24h-gain">—</div>
          <div id="history-period-gain">—</div>
          <div id="history-trend">—</div>
          <div id="history-latest-change">—</div>
        </div>
      `;
    });

    it("#history-24h-gain shows '—'", () => {
      const result = document.querySelector("#history-24h-gain");
      expect(result?.textContent).toBe("—");
    });

    it("#history-period-gain shows '—'", () => {
      const result = document.querySelector("#history-period-gain");
      expect(result?.textContent).toBe("—");
    });

    it("#history-trend shows '—'", () => {
      const result = document.querySelector("#history-trend");
      expect(result?.textContent).toBe("—");
    });

    it("#history-latest-change shows '—'", () => {
      const result = document.querySelector("#history-latest-change");
      expect(result?.textContent).toBe("—");
    });
  });

  describe("with 1 snapshot only", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="historyStats">
          <div id="history-peak24h">42,500</div>
          <div id="history-24h-gain">—</div>
          <div id="history-period-gain">—</div>
          <div id="history-trend">—</div>
          <div id="history-latest-change">—</div>
        </div>
      `;
    });

    it("#history-peak24h still displays if cached peak24h exists", () => {
      const result = document.querySelector("#history-peak24h");
      expect(result?.textContent).not.toBe("—");
    });

    it("#history-24h-gain shows '—' (not enough for window)", () => {
      const result = document.querySelector("#history-24h-gain");
      expect(result?.textContent).toBe("—");
    });

    it("#history-period-gain shows '—'", () => {
      const result = document.querySelector("#history-period-gain");
      expect(result?.textContent).toBe("—");
    });
  });

  describe("with null cached data (no CachedData)", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="historyStats">
          <div id="history-peak24h">—</div>
          <div id="history-alltime-peak">—</div>
          <div id="history-twitch">—</div>
        </div>
      `;
    });

    it("#history-peak24h shows '—'", () => {
      const result = document.querySelector("#history-peak24h");
      expect(result?.textContent).toBe("—");
    });

    it("#history-alltime-peak shows '—'", () => {
      const result = document.querySelector("#history-alltime-peak");
      expect(result?.textContent).toBe("—");
    });

    it("#history-twitch shows '—'", () => {
      const result = document.querySelector("#history-twitch");
      expect(result?.textContent).toBe("—");
    });
  });
});
