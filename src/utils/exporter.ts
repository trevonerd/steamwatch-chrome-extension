// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/exporter.ts
// Builds and triggers a file download from snapshot data.
// Pure builder functions + one DOM-side trigger (kept separate for testability).
// ─────────────────────────────────────────────────────────────────────────────

import type { Game, Snapshot, ExportRow } from "../types/index.js";

// ── Row builders ──────────────────────────────────────────────────────────────

/**
 * Flatten all snapshots for all games into a list of export rows,
 * sorted chronologically across all games.
 */
export function buildExportRows(
  games: Game[],
  snapshotsByAppid: Record<string, Snapshot[]>
): ExportRow[] {
  const rows: ExportRow[] = [];

  for (const game of games) {
    const snaps = snapshotsByAppid[game.appid] ?? [];
    for (const snap of snaps) {
      rows.push({
        appid:   game.appid,
        name:    game.name,
        ts:      snap.ts,
        date:    new Date(snap.ts).toISOString(),
        current: snap.current,
      });
    }
  }

  return rows.sort((a, b) => a.ts - b.ts);
}

// ── Serialisers ───────────────────────────────────────────────────────────────

/** Serialise rows to a pretty-printed JSON string. */
export function rowsToJSON(rows: ExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

/**
 * Serialise rows to RFC 4180-compliant CSV.
 * Values containing commas or quotes are quoted and internal quotes escaped.
 */
export function rowsToCSV(rows: ExportRow[]): string {
  const HEADERS: (keyof ExportRow)[] = ["appid", "name", "date", "current", "ts"];

  const escape = (v: string | number): string => {
    const s = String(v);
    // Quote if contains comma, double-quote, or newline
    if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = HEADERS.join(",");
  const body = rows.map((row) =>
    HEADERS.map((h) => escape(row[h])).join(",")
  );

  return [header, ...body].join("\r\n");
}

// ── Download trigger ──────────────────────────────────────────────────────────

/**
 * Trigger a browser file download.
 * Kept in a separate function so the pure builders above stay testable
 * without a DOM environment.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  // Small delay before revoke to let the browser initiate the download
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/** Build a timestamped filename. */
export function exportFilename(format: "json" | "csv"): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `steamwatch-export-${date}.${format}`;
}
