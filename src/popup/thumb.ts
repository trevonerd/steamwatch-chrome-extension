import { updateGameImage } from "../utils/storage.js";
import { formatError } from "../utils/log.js";

export function thumbColor(appid: string): string {
  const PALETTE = [
    "#2563eb", "#7c3aed", "#db2777", "#dc2626",
    "#d97706", "#059669", "#0891b2", "#4f46e5",
    "#be185d", "#b45309",
  ];
  const idx = parseInt(appid.slice(-1), 10);
  return PALETTE[Number.isNaN(idx) ? 0 : idx % PALETTE.length]!;
}

export function wireThumbFallback(
  imgEl: HTMLImageElement,
  wrapEl: HTMLElement,
  appid: string,
): void {
  imgEl.addEventListener("error", async () => {
    if (imgEl.dataset.retrying) return;
    imgEl.dataset.retrying = "true";

    try {
      const { fetchAppDetails } = await import("../utils/api.js");
      const details = await fetchAppDetails(appid);
      if (details?.image) {
        imgEl.src = details.image;
        await updateGameImage(appid, details.image);
        return;
      }
    } catch (err) {
      console.warn(`[SteamWatch] Thumbnail fallback failed for appid ${appid}: ${formatError(err)}`);
    }

    wrapEl.classList.add("img-error");
  });

  if (imgEl.complete && imgEl.naturalWidth === 0) {
    imgEl.dispatchEvent(new Event("error"));
  }
}
