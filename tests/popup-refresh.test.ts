// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTesting, idbClearAllData, idbSaveSnapshot } from "../src/utils/idb-storage.js";

const html = readFileSync(resolve("src/popup/index.html"), "utf8");
const cached = { current: 100, peak24h: 150, allTimePeak: 200, twitchViewers: 0, fetchedAt: Date.now() };

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing fixture element: ${id}`);
  return found;
}

async function loadPopup(): Promise<void> {
  await import("../src/popup/main.js");
  await vi.waitFor(() => expect(element("loading").hidden).toBe(true));
  await vi.waitFor(() => expect(document.querySelectorAll('[data-history-loading="true"]')).toHaveLength(0));
}

beforeEach(async () => {
  vi.resetModules();
  const markup = html.replace(/<link\b[^>]*>/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(...Array.from(parsed.body.childNodes));
  await idbClearAllData();
  await chrome.storage.local.set({
    sw_games: [{ appid: "570", name: "Dota 2", image: "https://example.com/game.jpg" }],
    sw_cache: { "570": cached }, sw_last_fetch: cached.fetchedAt,
  });
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  window.dispatchEvent(new Event("pagehide"));
  await _resetDbForTesting();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.doUnmock("../src/utils/idb-storage.js");
});

describe("popup refresh", () => {
  it("renders cached counts before IndexedDB history finishes loading", async () => {
    let finish: (value: []) => void = () => undefined;
    const waiting = new Promise<[]>((resolve) => { finish = resolve; });
    vi.doMock("../src/utils/idb-storage.js", async (importOriginal) => ({
      ...await importOriginal<typeof import("../src/utils/idb-storage.js")>(),
      idbGetSnapshots: () => waiting,
    }));
    await import("../src/popup/main.js");
    await vi.waitFor(() => expect(document.querySelector(".stat-current")?.textContent).toBe("100"));
    expect(document.querySelector('[data-history-loading="true"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>(".btn-expand")?.click();
    expect(document.querySelector(".history-notice")?.textContent).toContain("Loading available history");
    finish([]);
    await vi.waitFor(() => expect(document.querySelector('[data-history-loading="true"]')).toBeNull());
  });

  it("explains unavailable periods and requests history recovery on manual refresh", async () => {
    await loadPopup();
    document.querySelector<HTMLButtonElement>(".btn-expand")?.click();
    expect(document.querySelectorAll(".graph-pill:disabled")).toHaveLength(6);
    expect(document.querySelector(".history-notice")?.getAttribute("role")).toBe("status");
    expect(document.querySelector(".graph-pill:disabled")?.getAttribute("title")).toBeTruthy();
    element("refreshBtn").click();
    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "FETCH_NOW", retryHistory: true }));
    await vi.waitFor(() => expect(element("refreshBtn").hasAttribute("disabled")).toBe(false));
  });
  it("shows the beta identity reported by the loaded extension", async () => {
    vi.spyOn(chrome.runtime, "getManifest").mockReturnValue({
      manifest_version: 3, name: "SteamWatch", version: "9.8.7", version_name: "9.8.7-beta.4",
    });
    await loadPopup();
    expect(element("appVersion").textContent).toBe("v9.8.7-beta.4");
  });

  it("shows the numeric version when the loaded extension has no beta label", async () => {
    vi.spyOn(chrome.runtime, "getManifest").mockReturnValue({
      manifest_version: 3, name: "SteamWatch", version: "9.8.7",
    });
    await loadPopup();
    expect(element("appVersion").textContent).toBe("v9.8.7");
  });

  it("keeps the update bar visible when cached games finish loading", async () => {
    await loadPopup();
    expect(element("gamesList").hidden).toBe(false);
    expect(element("fetchBar").hidden).toBe(false);
  });

  it("shows an error when the worker rejects a manual refresh", async () => {
    await loadPopup();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false, error: "Refresh failed" });
    element("refreshBtn").click();
    await vi.waitFor(() => expect(element("errorState").hidden).toBe(false));
    expect(element("refreshBtn").hasAttribute("disabled")).toBe(false);
  });

  it("shows an error when the worker connection fails", async () => {
    await loadPopup();
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(new Error("Disconnected"));
    element("refreshBtn").click();
    await vi.waitFor(() => expect(element("errorState").hidden).toBe(false));
  });

  it("retries the background request and restores the list after a failed refresh", async () => {
    await loadPopup();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: false });
    element("refreshBtn").click();
    await vi.waitFor(() => expect(element("errorState").hidden).toBe(false));
    element("retryBtn").click();
    await vi.waitFor(() => expect(element("gamesList").hidden).toBe(false));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(element("fetchBar").hidden).toBe(false);
  });

  it("keeps cached counts visible and reports a failed automatic update", async () => {
    await chrome.storage.local.set({ sw_cache: { "570": { current: 100, fetchedAt: 1 } } });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false });
    await loadPopup();
    await vi.waitFor(() => expect(element("fetchBar").textContent).toContain("Update failed"));
    expect(element("gamesList").hidden).toBe(false);
  });

  it("uses the new update time when hydration supplies the first successful fetch", async () => {
    await chrome.storage.local.set({
      sw_cache: { "570": { current: 100, fetchedAt: 0 } }, sw_last_fetch: 0,
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async () => {
      await chrome.storage.local.set({ sw_cache: { "570": cached }, sw_last_fetch: cached.fetchedAt });
      return { ok: true };
    });
    await loadPopup();
    await vi.waitFor(() => expect(element("fetchBar").hidden).toBe(false));
  });

  it("shows cached counts while an automatic update remains pending", async () => {
    await chrome.storage.local.set({ sw_cache: { "570": { ...cached, fetchedAt: 1 } } });
    let finish: (response: { ok: boolean }) => void = () => undefined;
    vi.mocked(chrome.runtime.sendMessage).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await loadPopup();
    expect(element("gamesList").hidden).toBe(false);
    expect(document.querySelector(".stat-current")?.textContent).toBe("100");
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await vi.waitFor(() => expect(element("refreshBtn").hasAttribute("disabled")).toBe(false));
  });

  it("does not fetch again merely because a Twitch category is absent", async () => {
    await chrome.storage.local.set({ sw_cache: { "570": { current: 100, fetchedAt: Date.now() } } });
    await loadPopup();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("changes the favorite from cache without starting a network refresh", async () => {
    await loadPopup();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false });
    document.querySelector<HTMLButtonElement>(".btn-star")?.click();
    await vi.waitFor(async () => expect((await chrome.storage.local.get("sw_settings"))["sw_settings"].badgeFavoriteAppid).toBe("570"));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("changes graph and period statistics together using qualified hourly observations", async () => {
    const now = Date.now();
    for (let hour = 0; hour < 73; hour++) {
      await idbSaveSnapshot("570", { ts: now - hour * 3_600_000, current: hour < 24 ? 100 : 200, source: "steamcharts", granularity: "hourly" });
    }
    await loadPopup();
    document.querySelector<HTMLButtonElement>(".btn-expand")?.click();
    expect(document.querySelector(".period-stats")?.textContent).toContain("24h average");
    const before = document.querySelector(".period-stats")?.textContent;
    document.querySelector<HTMLButtonElement>('[data-window="3d"]')?.click();
    expect(document.querySelector(".period-stats")?.textContent).toContain("3d average");
    expect(document.querySelector(".period-stats")?.textContent).not.toBe(before);
    expect(document.querySelector(".panel-sparkline polyline")?.getAttribute("stroke-width")).toBe("1.8");
    expect(document.querySelector(".panel-record-low")?.textContent).toContain("hourly coverage");
  });
});
