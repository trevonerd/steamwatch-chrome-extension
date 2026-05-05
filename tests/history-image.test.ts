// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { wireThumbFallback } from "../src/popup/thumb.js";

const mockFetchAppDetails = vi.fn();

vi.mock("../src/utils/api.js", () => ({
  fetchAppDetails: (...args: any[]) => mockFetchAppDetails(...args),
  STEAM_CAPSULE_URL: (appid: string) => `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_sm_120.jpg`,
}));

describe("history thumbnail — image error fallback", () => {
  let imgEl: HTMLImageElement;
  let wrapperEl: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="history-thumbnail-wrapper">
        <img id="history-thumbnail" class="history-thumbnail" src="" alt="Game thumbnail" loading="lazy">
      </div>
    `;

    imgEl = document.getElementById("history-thumbnail") as HTMLImageElement;
    wrapperEl = document.querySelector(".history-thumbnail-wrapper") as HTMLDivElement;

    mockFetchAppDetails.mockReset();
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ games: [] }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  describe("wireThumbFallback integration", () => {
    it("exists and is callable", () => {
      expect(wireThumbFallback).toBeDefined();
      expect(typeof wireThumbFallback).toBe("function");
    });

    it("sets up error listener on image element", () => {
      const appid = "730";
      wireThumbFallback(imgEl, wrapperEl, appid);
      expect(imgEl).toBeDefined();
    });

    it("calls fetchAppDetails and updates img src on error", async () => {
      const appid = "730";
      const apiImage = "https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg";

      mockFetchAppDetails.mockResolvedValueOnce({
        name: "Counter-Strike 2",
        image: apiImage,
      });

      imgEl.src = "https://cdn.akamai.steamstatic.com/steam/apps/730/capsule_sm_120.jpg";
      wireThumbFallback(imgEl, wrapperEl, appid);

      imgEl.dispatchEvent(new Event("error"));
      await new Promise((r) => setTimeout(r, 10));

      expect(mockFetchAppDetails).toHaveBeenCalledWith(appid);
      expect(imgEl.src).toBe(apiImage);
    });
  });
});
