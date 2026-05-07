// @vitest-environment happy-dom

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addGame } from "../src/utils/storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function waitForHistoryOptions(expectedCount: number): Promise<void> {
  const selectEl = document.getElementById("historyGameSelect") as HTMLSelectElement | null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (selectEl && selectEl.options.length === expectedCount) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

describe("options history synchronization", () => {
  beforeEach(async () => {
    vi.resetModules();
    await chrome.storage.local.clear();

    const htmlPath = join(__dirname, "../src/options/index.html");
    const html = readFileSync(htmlPath, "utf-8");
    const bodyHtml = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? html;
    document.body.innerHTML = bodyHtml.replace(/<script[\s\S]*?<\/script>/g, "");

    chrome.runtime.getManifest = vi.fn(() => ({
      manifest_version: 3,
      name: "SteamWatch",
      version: "0.0.0",
    })) as unknown as typeof chrome.runtime.getManifest;
    chrome.runtime.sendMessage = vi.fn(() => Promise.resolve({ ok: true })) as unknown as typeof chrome.runtime.sendMessage;
  });

  it("refreshes #historyGameSelect when tracked games change without reloading", async () => {
    await import("../src/options/main.js");
    await waitForHistoryOptions(0);

    const selectEl = document.getElementById("historyGameSelect") as HTMLSelectElement;
    expect(selectEl.options.length).toBe(0);

    await addGame({ appid: "730", name: "Counter-Strike 2", image: "https://cdn.example.test/730.jpg" });
    window.dispatchEvent(new CustomEvent("steamwatch:games-changed", { detail: { appid: "730" } }));
    await waitForHistoryOptions(1);

    expect(Array.from(selectEl.options).map((option) => option.value)).toEqual(["730"]);
    expect(selectEl.value).toBe("730");
  });
});
