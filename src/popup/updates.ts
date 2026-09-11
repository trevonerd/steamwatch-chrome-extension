import type { CachedData, Game } from "../types/index.js";
import { formatError } from "../utils/log.js";

export function shouldRefreshGames(games: readonly Game[], cache: Record<string, CachedData>, now = Date.now()): boolean {
  return games.some((game) => {
    const timestamp = cache[game.appid]?.fetchedAt ?? 0;
    return timestamp <= 0 || timestamp > now || now - timestamp >= 60_000;
  });
}

/** Storage events publish background progress without waiting for every provider. */
export function startPopupUpdates(refresh: () => Promise<void>, render: () => Promise<void>): () => void {
  const controller = new AbortController();
  let pendingRender: number | undefined;
  const run = (operation: () => Promise<void>): void => {
    void operation().catch((error: unknown) => {
      console.error(`[SteamWatch popup] Update failed: ${formatError(error)}`);
    });
  };
  const poll = (): void => { if (document.visibilityState === "visible") run(refresh); };
  const timer = window.setInterval(poll, 60_000);
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== "local" || !["sw_cache", "sw_games", "sw_settings", "sw_last_fetch", "sw_history_revision"].some((key) => key in changes)) return;
    window.clearTimeout(pendingRender);
    pendingRender = window.setTimeout(() => run(render), 50);
  };
  chrome.storage.onChanged?.addListener(changed);
  document.addEventListener("visibilitychange", poll, { signal: controller.signal });
  const stop = (): void => {
    window.clearInterval(timer);
    window.clearTimeout(pendingRender);
    chrome.storage.onChanged?.removeListener(changed);
    window.removeEventListener("pagehide", stop);
    controller.abort();
  };
  window.addEventListener("pagehide", stop, { once: true });
  return stop;
}
