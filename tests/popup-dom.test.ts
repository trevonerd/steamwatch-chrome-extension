// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  fetchAppDetails: (appid: string) => mockFetchAppDetails(appid),
  STEAM_CAPSULE_URL: (appid: string) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
}));

vi.mock("../src/utils/storage.js", () => ({
  updateGameImage: (appid: string, imageUrl: string) => mockUpdateGameImage(appid, imageUrl),
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
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    document.body.replaceChildren();
    resetGlobalShareBarCloseBindingForTests();
  });

  it("ignores clicks inside share controls", () => {
    const button = document.createElement("button");
    button.className = "btn-share";
    expect(shouldKeepShareBarsOpen(button)).toBe(true);
  });

  it("closes open share bars and deactivates buttons", () => {
    const bar = document.createElement("div");
    bar.className = "share-bar";
    const button = document.createElement("button");
    button.className = "btn-share active";
    document.body.append(bar, button);
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

  it("sets a nonzero line-height on .sparkline-tooltip", () => {
    const cssPath = resolve(__dirname, "../src/popup/popup.css");
    const cssContent = readFileSync(cssPath, "utf-8");

    const tooltipMatch = cssContent.match(/\.sparkline-tooltip\s*\{[^}]*\}/s);
    const lineHeightMatch = tooltipMatch?.[0].match(/line-height:\s*([^;]+);/);

    expect(lineHeightMatch?.[1]?.trim()).toBe("1.2");
  });
});
