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
  imgEl.addEventListener("error", () => {
    const fallback = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
    if (!imgEl.src.includes("header.jpg")) {
      imgEl.src = fallback;
    } else {
      wrapEl.classList.add("img-error");
    }
  });
}
