// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldRefreshGames, startPopupUpdates } from "../src/popup/updates.js";

afterEach(() => { window.dispatchEvent(new Event("pagehide")); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("popup live updates", () => {
  const game = { appid: "570", name: "Dota 2", image: "" };
  it("refreshes missing, old or future-dated current values", () => {
    expect(shouldRefreshGames([game], {}, 100_000)).toBe(true);
    expect(shouldRefreshGames([game], { "570": { current: 0, fetchedAt: 20_000 } }, 100_000)).toBe(true);
    expect(shouldRefreshGames([game], { "570": { current: 0, fetchedAt: 200_000 } }, 100_000)).toBe(true);
  });
  it("does not refresh recent current counts just because Twitch or peaks are absent", () => {
    expect(shouldRefreshGames([game], { "570": { current: 0, fetchedAt: 90_000 } }, 100_000)).toBe(false);
    expect(shouldRefreshGames([], {}, 100_000)).toBe(false);
  });
  it("polls only while visible and stops when the popup closes", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const refresh = vi.fn(async () => undefined);
    startPopupUpdates(refresh, async () => undefined);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pagehide"));
    visibility.mockReturnValue("visible");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("coalesces cache and imported-history events and removes listeners on close", async () => {
    vi.useFakeTimers();
    let listener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | undefined;
    const removeListener = vi.fn();
    Object.defineProperty(chrome.storage, "onChanged", { configurable: true, value: {
      addListener: (callback: typeof listener) => { listener = callback; }, removeListener,
    } });
    const render = vi.fn(async () => undefined);
    const stop = startPopupUpdates(async () => undefined, render);
    listener?.({ sw_cache: { newValue: {} } }, "sync");
    await vi.advanceTimersByTimeAsync(50);
    expect(render).not.toHaveBeenCalled();
    listener?.({ sw_cache: { newValue: {} } }, "local");
    listener?.({ sw_history_revision: { newValue: 123 } }, "local");
    await vi.advanceTimersByTimeAsync(50);
    expect(render).toHaveBeenCalledTimes(1);
    stop();
    expect(removeListener).toHaveBeenCalledWith(listener);
    Reflect.deleteProperty(chrome.storage, "onChanged");
  });
});
