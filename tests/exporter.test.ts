// tests/exporter.test.ts
import { describe, it, expect } from "vitest";
import {
  buildExportRows,
  rowsToJSON,
  rowsToCSV,
  exportFilename,
} from "../src/utils/exporter.js";
import type { Game, Snapshot } from "../src/types/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const gameA: Game = { appid: "570",     name: "Dota 2",     image: "https://x.com/d2.jpg" };
const gameB: Game = { appid: "1245620", name: "Elden Ring", image: "https://x.com/er.jpg" };

function snap(current: number, ts: number): Snapshot {
  return { ts, current };
}

// ── buildExportRows ───────────────────────────────────────────────────────────

describe("buildExportRows", () => {
  it("returns empty array when no games", () => {
    expect(buildExportRows([], {})).toEqual([]);
  });

  it("returns empty array when games have no snapshots", () => {
    expect(buildExportRows([gameA], {})).toEqual([]);
  });

  it("maps snapshots to rows with correct fields", () => {
    const ts = 1_700_000_000_000;
    const rows = buildExportRows([gameA], { "570": [snap(5000, ts)] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      appid:   "570",
      name:    "Dota 2",
      ts,
      current: 5000,
    });
    // date should be a valid ISO string
    expect(() => new Date(rows[0]!.date).toISOString()).not.toThrow();
  });

  it("flattens multiple games into one sorted list", () => {
    const rows = buildExportRows(
      [gameA, gameB],
      {
        "570":     [snap(1000, 1000), snap(2000, 3000)],
        "1245620": [snap(5000, 2000)],
      }
    );
    expect(rows).toHaveLength(3);
    // Sorted by ts
    expect(rows.map((r) => r.ts)).toEqual([1000, 2000, 3000]);
    expect(rows[1]!.appid).toBe("1245620");
  });

  it("includes all snapshots for a game", () => {
    const snaps = Array.from({ length: 10 }, (_, i) => snap(i * 100, i * 1000));
    const rows = buildExportRows([gameA], { "570": snaps });
    expect(rows).toHaveLength(10);
  });
});

// ── rowsToJSON ────────────────────────────────────────────────────────────────

describe("rowsToJSON", () => {
  it("produces valid JSON that parses back correctly", () => {
    const rows = buildExportRows(
      [gameA],
      { "570": [snap(5000, 1_700_000_000_000)] }
    );
    const json = rowsToJSON(rows);
    const parsed = JSON.parse(json) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("is pretty-printed (contains newlines)", () => {
    const rows = buildExportRows([gameA], { "570": [snap(1, 1)] });
    expect(rowsToJSON(rows)).toContain("\n");
  });

  it("produces empty JSON array for zero rows", () => {
    expect(rowsToJSON([])).toBe("[]");
  });
});

// ── rowsToCSV ─────────────────────────────────────────────────────────────────

describe("rowsToCSV", () => {
  it("includes a header row", () => {
    const csv = rowsToCSV([]);
    const firstLine = csv.split("\r\n")[0]!;
    expect(firstLine).toContain("appid");
    expect(firstLine).toContain("name");
    expect(firstLine).toContain("current");
    expect(firstLine).toContain("date");
    expect(firstLine).toContain("ts");
  });

  it("produces N+1 lines for N rows (header + data)", () => {
    const rows = buildExportRows(
      [gameA],
      { "570": [snap(1000, 1), snap(2000, 2)] }
    );
    const lines = rowsToCSV(rows).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3); // 1 header + 2 data
  });

  it("quotes values that contain commas", () => {
    const gameWithComma: Game = { appid: "1", name: "Game, With Comma", image: "" };
    const rows = buildExportRows([gameWithComma], { "1": [snap(100, 1)] });
    const csv  = rowsToCSV(rows);
    expect(csv).toContain('"Game, With Comma"');
  });

  it("escapes internal double quotes", () => {
    const gameWithQuote: Game = { appid: "1", name: 'He said "hi"', image: "" };
    const rows = buildExportRows([gameWithQuote], { "1": [snap(100, 1)] });
    const csv  = rowsToCSV(rows);
    // RFC 4180: internal " → ""
    expect(csv).toContain('"He said ""hi"""');
  });

  it("does not quote plain values", () => {
    const rows = buildExportRows([gameA], { "570": [snap(5000, 1)] });
    const dataLine = rowsToCSV(rows).split("\r\n")[1]!;
    expect(dataLine).toContain("Dota 2");
    expect(dataLine).not.toMatch(/^"Dota 2"/); // no quoting needed
  });

  it("uses CRLF line endings (RFC 4180)", () => {
    const rows = buildExportRows([gameA], { "570": [snap(1, 1)] });
    expect(rowsToCSV(rows)).toContain("\r\n");
  });
});

// ── exportFilename ────────────────────────────────────────────────────────────

describe("exportFilename", () => {
  it("starts with steamwatch-export-", () => {
    expect(exportFilename("json")).toMatch(/^steamwatch-export-/);
    expect(exportFilename("csv")).toMatch(/^steamwatch-export-/);
  });

  it("ends with the correct extension", () => {
    expect(exportFilename("json")).toMatch(/\.json$/);
    expect(exportFilename("csv")).toMatch(/\.csv$/);
  });

  it("includes a YYYY-MM-DD date segment", () => {
    expect(exportFilename("json")).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
