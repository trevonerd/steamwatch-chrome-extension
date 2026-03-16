// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/share.ts
// Card sharing: formatted text (clipboard) and PNG image (canvas → ClipboardItem).
//
// `buildShareText`   — pure function, fully unit-testable.
// `renderShareCanvas` — DOM function (uses HTMLCanvasElement + Image), not testable
//                       in Node but tested visually / integration.
// ─────────────────────────────────────────────────────────────────────────────

import type { CardViewModel } from "../types/index.js";
import { fmtNumber, fmtPct, fmtTimeAgo } from "./trend.js";
import { mapToPoints } from "./sparkline.js";

// ── Text share ────────────────────────────────────────────────────────────────

/**
 * Build a human-readable, copy-paste-friendly summary card for a game.
 *
 * Pure function — takes only serialisable inputs, returns a string.
 * The output is intentionally terminal/Discord/Slack-friendly:
 * Unicode box-drawing characters for structure, no Markdown that might
 * render oddly in plain-text contexts.
 *
 * @param vm  CardViewModel for the game to share.
 */
export function buildShareText(vm: CardViewModel): string {
  const { game, current, peak24h, allTimePeak, allTimePeakLabel, trend, latestChangePct, fetchedAt } = vm;

  const line  = "─".repeat(32);
  const name  = game.name;
  const parts: string[] = [];

  parts.push(`🎮 ${name} — SteamWatch`);
  parts.push(line);

  // Current players
  parts.push(`👥 Current:  ${fmtNumber(current)}`);

  // Trend
  if (trend) {
    parts.push(`${trend.level.icon} Trend:    ${fmtPct(trend.pct)} (${trend.level.label})`);
  }

  if (latestChangePct != null) {
    parts.push(`↕ Latest change: ${fmtPct(latestChangePct)}`);
  }

  // Peaks
  if (peak24h || allTimePeak) {
    const peak24hStr = peak24h ? `24h peak: ${fmtNumber(peak24h)}` : "";
    const allTimePeakStr = allTimePeak
      ? `All-time peak: ${fmtNumber(allTimePeak)}${allTimePeakLabel ? ` (${allTimePeakLabel})` : ""}`
      : "";
    const statLine = [peak24hStr, allTimePeakStr].filter(Boolean).join("  ·  ");
    parts.push(`📊 ${statLine}`);
  }

  // Updated
  if (fetchedAt > 0) {
    parts.push(`🕐 Updated: ${fmtTimeAgo(fetchedAt)}`);
  }

  parts.push(line);
  parts.push(`steamdb.info/app/${game.appid}`);
  parts.push(`SteamWatch by TREVISOFT · github.com/trevonerd`);

  return parts.join("\n");
}

// ── Canvas / PNG share ────────────────────────────────────────────────────────

/** Card dimensions for the exported PNG. */
const CANVAS_W = 440;
const CANVAS_H = 128;

/**
 * Render a game card to a PNG Blob using Canvas 2D.
 *
 * Draws: dark background, game thumbnail, game name + stats, sparkline
 * path, trend badge colour strip, TREVISOFT watermark.
 *
 * Uses system fonts only (no Google Fonts) to ensure they're available
 * synchronously — Google Fonts are async CSS loads that may not be ready
 * when the canvas renders.
 *
 * @param vm  CardViewModel for the game to render.
 * @returns   PNG Blob ready for `navigator.clipboard.write()`.
 */
export async function renderShareCanvas(vm: CardViewModel): Promise<Blob> {
  const { game, current, peak24h, allTimePeak, trend, snaps, sparklineStroke } = vm;

  const canvas = document.createElement("canvas");
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx     = canvas.getContext("2d")!;

  // ── Background ─────────────────────────────────────────────────────────────
  ctx.fillStyle = "#080c15";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ── Left accent strip (trend colour) ──────────────────────────────────────
  ctx.fillStyle = trendStripColor(vm.trendCls);
  ctx.fillRect(0, 0, 3, CANVAS_H);

  // ── Thumbnail (async load, fail silently) ──────────────────────────────────
  const THUMB_X = 12;
  const THUMB_Y = 18;
  const THUMB_W = 60;
  const THUMB_H = 44;

  try {
    const img = await loadImage(game.image);
    // Rounded-rect clip
    ctx.save();
    roundRect(ctx, THUMB_X, THUMB_Y, THUMB_W, THUMB_H, 4);
    ctx.clip();
    ctx.drawImage(img, THUMB_X, THUMB_Y, THUMB_W, THUMB_H);
    ctx.restore();
  } catch {
    // Draw placeholder rectangle
    ctx.fillStyle = "#131f35";
    roundRect(ctx, THUMB_X, THUMB_Y, THUMB_W, THUMB_H, 4);
    ctx.fill();
  }

  // ── Game name ──────────────────────────────────────────────────────────────
  const TEXT_X = THUMB_X + THUMB_W + 12;

  ctx.fillStyle = "#dde4ee";
  ctx.font      = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.fillText(truncate(ctx, game.name, CANVAS_W - TEXT_X - 20), TEXT_X, 32);

  // ── Stats row ──────────────────────────────────────────────────────────────
  ctx.font      = "600 20px 'Courier New', Courier, monospace";
  ctx.fillStyle = "#00c8ff";
  ctx.fillText(fmtNumber(current), TEXT_X, 56);

  ctx.font      = "11px 'Courier New', Courier, monospace";
  ctx.fillStyle = "#7a90aa";
  const statsStr = [
    peak24h ? `24H ${fmtNumber(peak24h)}` : "",
    allTimePeak ? `ATH ${fmtNumber(allTimePeak)}` : "",
  ].filter(Boolean).join("  ");
  if (statsStr) ctx.fillText(statsStr, TEXT_X + 2, 72);

  // ── Trend badge ────────────────────────────────────────────────────────────
  if (trend) {
    const badgeColor = trendBadgeColor(vm.trendCls);
    const badgeText  = `${trend.level.icon} ${fmtPct(trend.pct)}`;
    ctx.font = "11px 'Courier New', Courier, monospace";
    const bw = ctx.measureText(badgeText).width + 14;
    const bx = CANVAS_W - bw - 12;
    const by = 12;
    const bh = 20;

    ctx.fillStyle = badgeColor.bg;
    roundRect(ctx, bx, by, bw, bh, 4);
    ctx.fill();

    ctx.fillStyle = badgeColor.text;
    ctx.fillText(badgeText, bx + 7, by + 13);
  }

  // ── Sparkline ──────────────────────────────────────────────────────────────
  const SPK_X = TEXT_X;
  const SPK_Y = 80;
  const SPK_W = CANVAS_W - TEXT_X - 16;
  const SPK_H = 36;

  if (snaps.length >= 2) {
    const recent = snaps.slice(-48);
    const values = recent.map((s) => s.current);
    const pts    = mapToPoints(values, SPK_W, SPK_H);

    // Fill
    ctx.beginPath();
    ctx.moveTo(SPK_X + pts[0]!.x, SPK_Y + pts[0]!.y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(SPK_X + pts[i]!.x, SPK_Y + pts[i]!.y);
    }
    ctx.lineTo(SPK_X + pts[pts.length - 1]!.x, SPK_Y + SPK_H);
    ctx.lineTo(SPK_X + pts[0]!.x,               SPK_Y + SPK_H);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(sparklineStroke, 0.08);
    ctx.fill();

    // Stroke
    ctx.beginPath();
    ctx.moveTo(SPK_X + pts[0]!.x, SPK_Y + pts[0]!.y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(SPK_X + pts[i]!.x, SPK_Y + pts[i]!.y);
    }
    ctx.strokeStyle   = sparklineStroke;
    ctx.lineWidth     = 1.5;
    ctx.lineCap       = "round";
    ctx.lineJoin      = "round";
    ctx.stroke();
  }

  // ── Watermark ──────────────────────────────────────────────────────────────
  ctx.font      = "10px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#3d5068";
  ctx.textAlign = "right";
  ctx.fillText("SteamWatch · TREVISOFT", CANVAS_W - 8, CANVAS_H - 6);
  ctx.textAlign = "left";

  // ── To Blob ────────────────────────────────────────────────────────────────
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null")),
      "image/png",
    );
  });
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Load an image by URL. Rejects on load error. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${src}`));
    img.src = src;
  });
}

/** Draw a rounded rectangle path (without stroking/filling). */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x,     y + h, x,     y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x,     y,     x + r, y);
  ctx.closePath();
}

/** Truncate text so it fits within `maxPx` pixels. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxPx: number): string {
  if (ctx.measureText(text).width <= maxPx) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxPx) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/** Convert a hex colour to rgba() string with given opacity. */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Left-border accent colour per trend class. */
function trendStripColor(cls: string): string {
  if (["explosion", "strong-up", "up"].includes(cls)) return "#22c55e";
  if (["down", "strong-down"].includes(cls))           return "#ef4444";
  if (cls === "crash")                                  return "#ff3366";
  return "#1e3a5f";
}

/** Badge background + text colours per trend class. */
function trendBadgeColor(cls: string): { bg: string; text: string } {
  if (["explosion", "strong-up", "up"].includes(cls))
    return { bg: "rgba(34,197,94,0.15)",  text: "#22c55e" };
  if (cls === "crash")
    return { bg: "rgba(255,51,102,0.15)", text: "#ff3366" };
  if (["down", "strong-down"].includes(cls))
    return { bg: "rgba(239,68,68,0.15)",  text: "#ef4444" };
  return { bg: "rgba(100,116,139,0.15)", text: "#64748b" };
}
