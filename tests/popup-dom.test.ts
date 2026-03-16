// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
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
