// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/sparkline.ts
// Generates an inline SVG sparkline from snapshot data.
// Pure function — no side effects, no DOM dependency, fully testable.
// ─────────────────────────────────────────────────────────────────────────────

import type { Snapshot, SparklineOptions } from "../types/index.js";

// ── Coordinate mapper (shared by SVG and Canvas renderers) ───────────────────

/**
 * Convert an array of player-count values to normalised {x, y} canvas/SVG
 * coordinates. Pure function — no side effects.
 *
 * @param values  Data series (must have ≥ 2 entries to be meaningful)
 * @param width   Total drawing width in pixels
 * @param height  Total drawing height in pixels
 * @param padX    Horizontal inset so strokes aren't clipped (default 2)
 * @param padY    Vertical inset so strokes aren't clipped (default 3)
 */
export function mapToPoints(
  values: readonly number[],
  width: number,
  height: number,
  padX = 2,
  padY = 3,
): Array<{ x: number; y: number }> {
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return values.map((v, i) => ({
    x: padX + (i / (values.length - 1)) * (width - padX * 2),
    y: range === 0
      ? height / 2
      : padY + ((max - v) / range) * (height - padY * 2),
  }));
}

export const DEFAULT_SPARKLINE_OPTIONS: SparklineOptions = {
  width:       160,
  height:       36,
  strokeColor: "#00c8ff",
  fillColor:   "rgba(0,200,255,0.08)",
  maxPoints:   48, // ~12h at 15min intervals
};

/**
 * Build an SVG sparkline string from an array of snapshots.
 *
 * Returns null when there are fewer than 2 data points — nothing
 * meaningful to draw.
 */
export function buildSparklineSVG(
  snapshots: readonly Snapshot[],
  opts: Partial<SparklineOptions> = {}
): string | null {
  const o: SparklineOptions = { ...DEFAULT_SPARKLINE_OPTIONS, ...opts };

  // Take the N most recent, maintain chronological order
  const points = snapshots.slice(-o.maxPoints);
  if (points.length < 2) return null;

  const { width: W, height: H } = o;
  const values = points.map((s) => s.current);

  // Shared coordinate mapper — same logic used by the canvas renderer
  const pts = mapToPoints(values, W, H);

  const coords     = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fillCoords = [
    ...pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${pts[pts.length - 1]!.x.toFixed(1)},${H}`,
    `${pts[0]!.x.toFixed(1)},${H}`,
  ].join(" ");
  const segments = pts.slice(1).map((point, index) => {
    const prevPoint = pts[index]!;
    const prevValue = values[index]!;
    const value = values[index + 1]!;
    const color = segmentColor(prevValue, value);
    return `  <line x1="${prevPoint.x.toFixed(1)}" y1="${prevPoint.y.toFixed(1)}" x2="${point.x.toFixed(1)}" y2="${point.y.toFixed(1)}" stroke="${color}" stroke-width="1.8" stroke-linecap="round" />`;
  }).join("\n");

  return [
    `<svg`,
    `  xmlns="http://www.w3.org/2000/svg"`,
    `  viewBox="0 0 ${W} ${H}"`,
    `  preserveAspectRatio="none"`,
    `  aria-hidden="true"`,
    `  role="img"`,
    `>`,
    `  <polygon points="${fillCoords}" fill="${o.fillColor}" />`,
    `  <polyline points="${coords}" fill="none" stroke="${o.strokeColor}" stroke-width="0.01" stroke-linecap="round" stroke-linejoin="round" opacity="0" />`,
    segments,
    `</svg>`,
  ].join("\n");
}

/**
 * Determine the stroke colour based on the overall direction of the sparkline.
 * Rising → green, falling → red, flat → accent blue.
 */
export function sparklineColor(snapshots: readonly Snapshot[]): string {
  if (snapshots.length < 2) return "#00c8ff";
  const first = snapshots[0]!.current;
  const last  = snapshots[snapshots.length - 1]!.current;
  if (last > first * 1.02) return "#22c55e";   // up
  if (last < first * 0.98) return "#ef4444";   // down
  return "#00c8ff";                             // flat
}

function segmentColor(prev: number, next: number): string {
  if (prev <= 0) return "#00c8ff";
  const pct = ((next - prev) / prev) * 100;
  if (pct >= 8) return "#16a34a";
  if (pct >= 2) return "#22c55e";
  if (pct <= -8) return "#dc2626";
  if (pct <= -2) return "#ef4444";
  return "#00c8ff";
}
