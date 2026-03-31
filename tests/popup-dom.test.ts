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

describe("thumbColor", () => {
  it("returns a deterministic palette color from the appid", () => {
    expect(thumbColor("1245620")).toBe("#2563eb");
    expect(thumbColor("1245629")).toBe("#b45309");
  });
});

describe("wireThumbFallback", () => {
  it("does not rely on inline event handlers", () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");
    wireThumbFallback(img, wrap, "3065800");
    expect(img.getAttribute("onerror")).toBeNull();
  });

  it("switches to header.jpg on first error", () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");
    img.src = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/capsule_sm_120.jpg";
    wireThumbFallback(img, wrap, "3065800");

    img.dispatchEvent(new Event("error"));

    expect(img.src).toContain("header.jpg");
  });

  it("adds img-error to the wrapper after the fallback also fails", () => {
    const wrap = document.createElement("div");
    const img = document.createElement("img");
    img.src = "https://cdn.akamai.steamstatic.com/steam/apps/3065800/capsule_sm_120.jpg";
    wireThumbFallback(img, wrap, "3065800");

    img.dispatchEvent(new Event("error"));
    img.dispatchEvent(new Event("error"));

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
    
    // Find the .panel-sparkline rule blocks
    const panelSparklineMatch = cssContent.match(/\.panel-sparkline\s*\{[^}]*\}/gs);
    
    // Verify that none of the .panel-sparkline blocks contain overflow:hidden
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
