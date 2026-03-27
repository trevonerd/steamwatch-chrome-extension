# Decisions — steamwatch-polish

## 2026-03-27T14:05:19Z Plan kickoff

### T1: IDB Switchover
- Use `idbGetSnapshots` (top-level import) everywhere in options — including the export function at lines 694-695 where it currently does a dynamic import of `storage.js`
- Keep ALL other `storage.ts` imports: `getGames`, `addGame`, `removeGame`, `getSettings`, `saveSettings`, `getGameSettings`, `saveGameSettings`, `clearAllData`, `MAX_GAMES`

### T2: Tooltip Clamping
- Measure actual tooltip width via `tooltip.offsetWidth` post render
- Use `Math.max(halfPct, Math.min(pctX, 100 - halfPct))` clamping formula
- Add `overflow: hidden` to `.panel-sparkline` as belt-and-suspenders

### T5: History Hover
- Show BOTH player count AND timestamp in tooltip (unlike popup which shows count only)
  - Format: `"1,234 — 3/27 14:30"` using `fmtNumber + fmtTime`
- Hover elements appended to `.history-chart-wrap`, not inside the SVG
- Remove old hover elements before re-appending on each `renderHistory()` call (prevent duplicates on game switch)
- Reuse CSS classes: `.sparkline-tooltip`, `.sparkline-hover-line`, `.sparkline-hover-dot`

### T6: History Stats
- Stats grid: `repeat(3, 1fr)` → balanced 2 rows × 3 columns (was 4 columns for 4 stats)
- Record Low: `computeWindowMin(filtered)` — uses current time-window data
- All-time Low: `computeWindowMin(allSnaps)` — uses all IDB data
- Price section: stats only (Historical Low, Current Price, Discount) — NO sparkline chart
- Price section hidden by default; shown only when `idbGetItadMapping(appid)` returns non-null AND `idbGetPriceHistory(appid)` returns non-empty array
- ITAD credit link required in price section title

### T4: Image Placeholder
- Wrap `<img>` in `<span class="game-row-thumb-wrap">` with sibling `<span class="game-row-placeholder">`
- `game-row-thumb-wrap.img-error` toggles visibility (same pattern as popup `thumb-wrap.img-error`)
- `thumbColor(appid)` already exported from `thumb.ts` — import it alongside `wireThumbFallback`
