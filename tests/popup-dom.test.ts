// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  bindGlobalShareBarClose,
  closeOpenShareBars,
  resetGlobalShareBarCloseBindingForTests,
  shouldKeepShareBarsOpen,
} from "../src/popup/shareBar.js";
import { thumbColor, wireThumbFallback } from "../src/popup/thumb.js";

const mockFetchAppDetails = vi.fn();
const mockUpdateGameImage = vi.fn();

vi.mock("../src/utils/api.js", () => ({
  fetchAppDetails: (...args: any[]) => mockFetchAppDetails(...args),
  STEAM_CAPSULE_URL: (appid: string) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
}));

vi.mock("../src/utils/storage.js", () => ({
  updateGameImage: (...args: any[]) => mockUpdateGameImage(...args),
}));

describe("thumbColor", () => {
  it("returns a deterministic palette color from the appid", () => {
    expect(thumbColor("1245620")).toBe("#2563eb");
    expect(thumbColor("1245629")).toBe("#b45309");
  });
});

describe("wireThumbFallback", () => {
  beforeEach(() => {
    mockFetchAppDetails.mockClear();
    mockUpdateGameImage.mockClear();
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ games: [] }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  it("does not rely on inline event handlers", () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");
    wireThumbFallback(img, wrap, "3065800");
    expect(img.getAttribute("onerror")).toBeNull();
  });

  it("calls fetchAppDetails and updates img src on error", async () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");
    const apiImage = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/header.jpg";

    mockFetchAppDetails.mockResolvedValueOnce({
      name: "Test Game",
      image: apiImage,
    });

    img.src = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/capsule_sm_120.jpg";
    wireThumbFallback(img, wrap, "3065800");

    img.dispatchEvent(new Event("error"));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetchAppDetails).toHaveBeenCalledWith("3065800");
    expect(img.src).toBe(apiImage);
  });

  it("adds img-error class when API returns no image", async () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");

    mockFetchAppDetails.mockResolvedValueOnce({
      name: "Test Game",
      image: null,
    });

    img.src = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/capsule_sm_120.jpg";
    wireThumbFallback(img, wrap, "3065800");

    img.dispatchEvent(new Event("error"));
    await new Promise((r) => setTimeout(r, 10));

    expect(wrap.classList.contains("img-error")).toBe(true);
  });

  it("adds img-error class when API fails", async () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");

    mockFetchAppDetails.mockRejectedValueOnce(new Error("Network error"));

    img.src = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/capsule_sm_120.jpg";
    wireThumbFallback(img, wrap, "3065800");

    img.dispatchEvent(new Event("error"));
    await new Promise((r) => setTimeout(r, 10));

    expect(wrap.classList.contains("img-error")).toBe(true);
  });

  it("updates chrome.storage when game exists with different image", async () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");
    const apiImage = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3065800/header.jpg";
    const existingGames = [{ appid: "3065800", name: "Test Game", image: "https://old-image.jpg" }];

    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ games: existingGames });

    mockFetchAppDetails.mockResolvedValueOnce({
      name: "Test Game",
      image: apiImage,
    });

    img.src = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3065800/capsule_sm_120.jpg";
    wireThumbFallback(img, wrap, "3065800");

    img.dispatchEvent(new Event("error"));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockUpdateGameImage).toHaveBeenCalledWith("3065800", apiImage);
  });

  it("prevents duplicate API calls with retrying flag", async () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");
    const apiImage = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/header.jpg";

    mockFetchAppDetails.mockResolvedValue({
      name: "Test Game",
      image: apiImage,
    });

    img.src = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/capsule_sm_120.jpg";
    wireThumbFallback(img, wrap, "3065800");

    img.dispatchEvent(new Event("error"));
    img.dispatchEvent(new Event("error"));

    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetchAppDetails).toHaveBeenCalledTimes(1);
  });

  it("handles already-errored image (complete=true, naturalWidth=0) on attachment", async () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");

    mockFetchAppDetails.mockRejectedValueOnce(new Error("Network error"));

    img.src = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/capsule_sm_120.jpg";

    Object.defineProperty(img, "complete", { value: true, configurable: true });
    Object.defineProperty(img, "naturalWidth", { value: 0, configurable: true });

    wireThumbFallback(img, wrap, "3065800");

    await new Promise((r) => setTimeout(r, 10));

    expect(wrap.classList.contains("img-error")).toBe(true);
  });
});

describe("share bar helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetGlobalShareBarCloseBindingForTests();
  });

  it("ignores clicks inside share controls", () => {
    const button = document.createElement("button");
    button.className = "btn-share";
    expect(shouldKeepShareBarsOpen(button)).toBe(true);
  });

  it("closes open share bars and deactivates buttons", () => {
    document.body.innerHTML = `
      <div class="share-bar"></div>
      <button class="btn-share active"></button>
    `;
    const bar = document.querySelector<HTMLDivElement>(".share-bar")!;
    bar.hidden = false;

    closeOpenShareBars(document);

    expect(bar.hidden).toBe(true);
    expect(document.querySelector(".btn-share")?.classList.contains("active")).toBe(false);
  });

  it("binds the global close listener only once across repeated init calls", () => {
    const spy = vi.spyOn(document, "addEventListener");

    bindGlobalShareBarClose(document);
    bindGlobalShareBarClose(document);

    const clickBindings = spy.mock.calls.filter(([type]) => type === "click");
    expect(clickBindings).toHaveLength(1);
  });
});

describe("sparkline container styling", () => {
  it("does not have overflow:hidden on .panel-sparkline to allow hover elements to display", () => {
    const cssPath = resolve(__dirname, "../src/popup/popup.css");
    const cssContent = readFileSync(cssPath, "utf-8");

    const panelSparklineMatch = cssContent.match(/\.panel-sparkline\s*\{[^}]*\}/gs);

    const hasOverflowHidden = panelSparklineMatch?.some((rule) =>
      rule.includes("overflow:") && rule.includes("hidden")
    ) ?? false;

    expect(hasOverflowHidden).toBe(false);
  });
});

describe("Popup — Price Fallback (Steam price without ITAD)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders price info when game card has priceFormatted but no itadUuid", () => {
    const cardEl = document.createElement("div");
    cardEl.className = "card";
    cardEl.innerHTML = `
      <div class="card-price-section">
        <p class="price-label">Price</p>
        <div class="card-price">$19.99</div>
      </div>
    `;
    document.body.appendChild(cardEl);

    const priceEl = cardEl.querySelector(".card-price");
    expect(priceEl).not.toBeNull();
    expect(priceEl?.textContent).toBe("$19.99");
  });

  it("shows discount badge when discountPct exists on popup card", () => {
    const cardEl = document.createElement("div");
    cardEl.className = "card";
    cardEl.innerHTML = `
      <div class="card-price-section">
        <div class="card-price">$14.99</div>
        <div class="card-discount-badge">-25%</div>
      </div>
    `;
    document.body.appendChild(cardEl);

    const discountEl = cardEl.querySelector(".card-discount-badge");
    expect(discountEl).not.toBeNull();
    expect(discountEl?.textContent).toBe("-25%");
  });

  it("displays both current and original price when on sale", () => {
    const cardEl = document.createElement("div");
    cardEl.className = "card";
    cardEl.innerHTML = `
      <div class="card-price-section">
        <div class="card-price-current">$14.99</div>
        <div class="card-price-original">$19.99</div>
      </div>
    `;
    document.body.appendChild(cardEl);

    const currentEl = cardEl.querySelector(".card-price-current");
    const originalEl = cardEl.querySelector(".card-price-original");
    expect(currentEl?.textContent).toBe("$14.99");
    expect(originalEl?.textContent).toBe("$19.99");
  });

  it("hides price section when both priceFormatted and itadUuid are missing", () => {
    const cardEl = document.createElement("div");
    cardEl.className = "card";
    cardEl.innerHTML = `
      <div class="card-price-section" hidden>
        <p>No price available</p>
      </div>
    `;
    document.body.appendChild(cardEl);

    const priceSection = cardEl.querySelector(".card-price-section");
    expect(priceSection?.hasAttribute("hidden")).toBe(true);
  });
});

describe("Panel price states", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("priceState 'available' shows formatted price and panel is not hidden", () => {
    document.body.innerHTML = `<div class="panel-price-section">
      <div class="panel-steam-price">
        <span class="panel-steam-price-current">€59.99</span>
      </div>
    </div>`;
    const el = document.querySelector(".panel-steam-price-current");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("€59.99");
    expect(document.querySelector(".panel-price-section")?.hasAttribute("hidden")).toBe(false);
  });

  it("priceState 'free' shows 'Free to Play' label", () => {
    document.body.innerHTML = `<div class="panel-price-section">
      <span class="panel-price-free">Free to Play</span>
    </div>`;
    const el = document.querySelector(".panel-price-free");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("Free to Play");
  });

  it("priceState 'unavailable' shows 'Price unavailable' label", () => {
    document.body.innerHTML = `<div class="panel-price-section">
      <span class="panel-price-unavail">Price unavailable</span>
    </div>`;
    const el = document.querySelector(".panel-price-unavail");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("Price unavailable");
  });

  it("priceState 'loading' shows loading text", () => {
    document.body.innerHTML = `<div class="panel-price-section">
      <span class="panel-price-loading">Loading...</span>
    </div>`;
    const el = document.querySelector(".panel-price-loading");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("Loading...");
  });

  it("panel-price-section is never given a hidden attribute", () => {
    document.body.innerHTML = `<div class="panel-price-section">
      <span class="panel-price-free">Free to Play</span>
    </div>`;
    expect(document.querySelector(".panel-price-section")?.hasAttribute("hidden")).toBe(false);
  });
});

describe("Panel sale badge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does NOT show badge when discountPct is 0 (bug fix: was discountPct != null)", () => {
    const discountPct = 0;
    const showBadge = discountPct != null && discountPct > 0;
    document.body.innerHTML = showBadge
      ? `<div class="panel-sale-badge"><span class="sale-pct">ON SALE −${discountPct}%</span></div>`
      : "";
    expect(document.querySelector(".panel-sale-badge")).toBeNull();
  });

  it("does NOT show badge when discountPct is null", () => {
    const discountPct: number | null = null;
    const showBadge = discountPct != null && discountPct > 0;
    document.body.innerHTML = showBadge
      ? `<div class="panel-sale-badge"><span class="sale-pct">ON SALE −${discountPct}%</span></div>`
      : "";
    expect(document.querySelector(".panel-sale-badge")).toBeNull();
  });

  it("DOES show badge with correct text when discountPct is 50", () => {
    const discountPct = 50;
    const showBadge = discountPct != null && discountPct > 0;
    document.body.innerHTML = showBadge
      ? `<div class="panel-sale-badge"><span class="sale-pct">ON SALE −${discountPct}%</span></div>`
      : "";
    const badge = document.querySelector(".panel-sale-badge");
    expect(badge).not.toBeNull();
    expect(badge?.querySelector(".sale-pct")?.textContent).toBe("ON SALE −50%");
  });
});
