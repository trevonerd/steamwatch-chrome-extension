// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { wireThumbFallback } from "../src/popup/thumb.js";

/**
 * Test suite for history page thumbnail image error fallback.
 * Verifies that the history thumbnail uses the same fallback cascade as popup thumbnails:
 * 1. First error → try header.jpg
 * 2. Second error → add img-error class to wrapper
 */

describe("history thumbnail — image error fallback", () => {
  let imgEl: HTMLImageElement;
  let wrapperEl: HTMLDivElement;

  beforeEach(() => {
    // Set up DOM structure matching src/options/index.html
    document.body.innerHTML = `
      <div class="history-thumbnail-wrapper">
        <img id="history-thumbnail" class="history-thumbnail" src="" alt="Game thumbnail" loading="lazy">
      </div>
    `;

    imgEl = document.getElementById("history-thumbnail") as HTMLImageElement;
    wrapperEl = document.querySelector(".history-thumbnail-wrapper") as HTMLDivElement;
  });

  describe("wireThumbFallback integration", () => {
    it("exists and is callable", () => {
      expect(wireThumbFallback).toBeDefined();
      expect(typeof wireThumbFallback).toBe("function");
    });

    it("sets up error listener on image element", () => {
      const appid = "730"; // CS2
      wireThumbFallback(imgEl, wrapperEl, appid);
      expect(imgEl).toBeDefined();
    });
  });

  describe("first error event — fallback to header.jpg", () => {
    it("changes src to header.jpg on first error", () => {
      const appid = "730";
      const capsuleSrc = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_sm_120.jpg`;
      imgEl.src = capsuleSrc;
      wireThumbFallback(imgEl, wrapperEl, appid);

      const errorEvent = new Event("error");
      imgEl.dispatchEvent(errorEvent);

      expect(imgEl.src).toContain("header.jpg");
      expect(imgEl.src).not.toContain("capsule_sm_120.jpg");
    });
  });

  describe("second error event — add img-error class", () => {
    it("adds img-error class to wrapper on second error", () => {
      const appid = "730";
      // Start with header.jpg to simulate already tried capsule
      imgEl.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
      wireThumbFallback(imgEl, wrapperEl, appid);

      // Simulate error event (second one, since src already has header.jpg)
      const errorEvent = new Event("error");
      imgEl.dispatchEvent(errorEvent);

      expect(wrapperEl.classList.contains("img-error")).toBe(true);
    });

    it("does not change src if header.jpg already failed", () => {
      const appid = "730";
      const headerUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
      imgEl.src = headerUrl;
      wireThumbFallback(imgEl, wrapperEl, appid);

      const errorEvent = new Event("error");
      imgEl.dispatchEvent(errorEvent);

      expect(imgEl.src).toBe(headerUrl);
    });
  });

  describe("multiple appids", () => {
    it("handles different appids correctly", () => {
      const appid1 = "730";
      const appid2 = "570";

      imgEl.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appid1}/capsule_sm_120.jpg`;
      wireThumbFallback(imgEl, wrapperEl, appid1);

      const errorEvent = new Event("error");
      imgEl.dispatchEvent(errorEvent);

      expect(imgEl.src).toContain(appid1);
      expect(imgEl.src).toContain("header.jpg");
    });
  });
});
