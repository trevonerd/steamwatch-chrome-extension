# SteamWatch Post-Evolution Polish & Fixes

## TL;DR

> **Quick Summary**: Fix 6 issues discovered during manual testing after completing the Evolution plan (T1–T15). Includes an F3 verification reject (options/main.ts still reads from chrome.storage.local instead of IndexedDB), tooltip overflow bug, Options History panel major upgrade (hover, dynamic colors, price stats, record low), missing game images in options, and misleading data retention label.
>
> **Deliverables**:
> - Options page reads snapshots from IndexedDB (F3 fix)
> - Popup tooltip properly clamped within container bounds
> - Options History panel with interactive hover tooltips, price stats section, record low stats
> - Options game list shows letter placeholder when images fail
> - Data retention label accurately describes compaction behavior
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: T1 (IDB switch) → T5 (History hover) → T6 (History stats + price)

---

## Context

### Original Request
User loaded the SteamWatch extension after the Evolution plan was fully implemented (T1–T15, 390 tests passing) and found 5 UI issues during manual testing. Additionally, the F3 Scope Fidelity verification rejected T7 because `src/options/main.ts` was never switched from chrome.storage.local to IndexedDB for snapshot reads.

### Interview Summary
**Key Discussions**:
- User verbatim: "pls make the container of the value on hover bigger, now the text is bigger then the container"
- User verbatim: "i cant find any info about the prices. u have to update also the history pannel under the options because i need dinamic colors, hover etc… and all the information needed!"
- User verbatim: "in the game list under options some games dont have the img!"
- Data retention label says "purged" but compaction preserves data as aggregates

**Research Findings**:
- Tooltip CSS: `.sparkline-tooltip` has `white-space: nowrap`, NO max-width, position clamping only shifts 6% at right edge
- Options History panel: Basic SVG polyline (600×160), 4 stats, NO hover/price/interactivity, reads from `getSnapshotsForGame` (chrome.storage.local)
- Game images: `game.image` stored at add-time, fallback `header.jpg` → hide. Options hides entirely vs popup which shows letter placeholder
- Data retention: `purgeAfterDays` feeds `compactSnapshots()` as `fullResolutionDays`. Word "purged" is factually incorrect

### Metis Review
**Identified Gaps** (addressed):
- Export function at lines 694-695 also needs IDB switch (included in T1)
- History hover must account for 600×160 viewBox + padding (padX=52, padY=16) — different from popup's 372×56
- Stats grid needs layout adjustment for 6 items (changing to `repeat(3, 1fr)` for balanced 2×3)
- Games without ITAD data must hide price section gracefully
- Empty IDB edge case for freshly tracked games needs handling
- Options game images should show letter placeholder matching popup pattern, not hide

---

## Work Objectives

### Core Objective
Fix the F3 verification reject and all 5 user-reported UI issues to bring SteamWatch to a polished, release-ready state.

### Concrete Deliverables
- `src/options/main.ts` — snapshot reads switched to `idbGetSnapshots` from `idb-storage.ts`
- `src/popup/popup.css` + `src/popup/main.ts` — tooltip overflow fixed with proper edge clamping
- `src/options/index.html` + `src/options/main.ts` + `src/options/options.css` — History panel with hover tooltips, 6 stats (adds Record Low + All-time Low), price stats section
- `src/options/main.ts` — game image letter placeholder on double failure
- `src/options/index.html` — data retention description text updated

### Definition of Done
- [ ] `pnpm vitest run` → ALL tests pass (390+ existing + new tests, 0 failures)
- [ ] `pnpm build` → succeeds with no errors
- [ ] Options History panel renders chart data from IndexedDB
- [ ] Popup tooltip stays within sparkline container at all edge positions
- [ ] Options History panel has working hover tooltip with player count + timestamp
- [ ] Options History panel shows Record Low and All-time Low stats
- [ ] Options History panel shows price stats for games with ITAD data
- [ ] Options game list shows letter placeholder when image fails
- [ ] Data retention description does not contain the word "purged"

### Must Have
- IDB switchover for all snapshot reads in `options/main.ts` (F3 fix)
- Tooltip clamping at both left and right edges
- History panel hover interaction matching popup pattern (tooltip + vertical line + dot)
- Record Low and All-time Low stats in History panel
- Price stats section in History panel (Historical Low, Current Price) — visible only when ITAD data exists
- Letter placeholder for failed game images in options
- Updated data retention label text

### Must NOT Have (Guardrails)
- **No external chart library** — continue using hand-built SVG
- **No React/Vue/Svelte** — vanilla TS only
- **No `as any` / `@ts-ignore` / empty catch / `console.log`** in production code
- **No `await fetch()` inside IDB transactions**
- **No new npm dependencies** — use only existing deps (idb, fake-indexeddb)
- **No ITAD fetch from Options page** — background worker owns fetching; options reads from IDB/cache only
- **No changes to `compactSnapshots()` algorithm** — only label text changes
- **No modification to popup sparkline rendering** — changes are isolated to options and tooltip positioning
- **No changes to SVG viewBox dimensions** — 600×160 for options chart, 372×56 for popup panel sparkline
- **No `<canvas>` elements** — entire project uses SVG
- **No click-to-pin tooltip, zoom, pan, or crosshair** — hover-only interaction
- **No per-segment coloring** on History chart — single `sparklineColor()` for the polyline is correct for the larger chart
- **No new CSS custom properties** — use existing `--accent`, `--bg-card`, `--border-hover`, etc.
- **No changes to data retention slider range (3–30)** — only the description text
- **No price chart/sparkline in History** — price info as stats only (Historical Low, Current Price/Discount)
- Pre-existing LSP errors in `src/background/index.ts:204`, `src/popup/main.ts:628`, `src/background/fetchCycle.ts:63` are NOT our bugs — do not fix

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Vitest, 390 tests passing)
- **Automated tests**: TDD (RED → GREEN → REFACTOR) for new modules/functions; tests-after for CSS/HTML-only changes
- **Framework**: vitest + fake-indexeddb + happy-dom
- **Test command**: `pnpm vitest run`

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Library/Module**: Use Bash (`pnpm vitest run`) — Run tests, assert pass count
- **Build**: Use Bash (`pnpm build`) — Assert zero errors

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — independent fixes):
├── Task 1: Options IDB switchover (F3 fix) [quick]
├── Task 2: Popup tooltip overflow fix [quick]
├── Task 3: Data retention label update [quick]
└── Task 4: Options game image placeholder [quick]

Wave 2 (After Task 1 — History panel reads from IDB now):
├── Task 5: History panel hover interaction [unspecified-high]
└── Task 6: History panel stats expansion + price section [unspecified-high]

Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 5 → Task 6 → F1-F4 → user okay
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| T1 | — | T5, T6 |
| T2 | — | — |
| T3 | — | — |
| T4 | — | — |
| T5 | T1 | T6 |
| T6 | T1, T5 | — |
| F1-F4 | T1-T6 | — |

### Agent Dispatch Summary

- **Wave 1**: **4 tasks** — T1 → `quick`, T2 → `quick`, T3 → `quick`, T4 → `quick`
- **Wave 2**: **2 tasks** — T5 → `unspecified-high`, T6 → `unspecified-high`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Switch Options snapshot reads to IndexedDB (F3 fix)

  **What to do**:
  - Replace `getSnapshotsForGame` import at line 10 of `src/options/main.ts` with `idbGetSnapshots` from `../utils/idb-storage.js`
  - At line 577: change `await getSnapshotsForGame(appid)` → `await idbGetSnapshots(appid)`
  - At lines 694-695: change the dynamic `import("../utils/storage.js")` + `getSnapshotsForGame` → use top-level `idbGetSnapshots` import instead of dynamic import
  - Remove `getSnapshotsForGame` from the `storage.ts` import at line 10 (keep `getGames`, `addGame`, `removeGame`, `getSettings`, `saveSettings`, `getGameSettings`, `saveGameSettings`, `clearAllData`, `MAX_GAMES` — these remain on chrome.storage.local)
  - Verify `getSnapshotsForGame` is NOT imported anywhere in `options/main.ts` after the change
  - Write test: mock IDB with known snapshots via `idbSaveSnapshot()`, call `idbGetSnapshots()`, assert correct `Snapshot[]` returned for the options flow
  - Handle empty IDB gracefully — if IDB returns `[]` for a game, the existing `downsampled.length < 2` guard at line 581 handles it

  **Must NOT do**:
  - Do NOT change `getGames`, `getSettings`, `saveSettings`, etc. — those stay on chrome.storage.local
  - Do NOT modify `src/utils/idb-storage.ts` — it already exports what we need
  - Do NOT change `src/utils/storage.ts` — just stop importing `getSnapshotsForGame` from it in options

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: This is a surgical import swap — 3 lines change, no new logic
  - **Skills**: []
    - No special skills needed — straightforward refactor

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 5, 6 (History panel reads data from IDB after this)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/popup/main.ts:68` — Popup already uses `idbGetSnapshots` as the canonical snapshot source: `buildAllViewModels(games, cache, idbGetSnapshots, ...)`
  - `src/popup/main.ts:6-8` — Popup's import pattern for `idbGetSnapshots`: `import { idbGetSnapshots } from "../utils/idb-storage.js"`

  **API/Type References** (contracts to implement against):
  - `src/utils/idb-storage.ts:132-136` — `idbGetSnapshots(appId: string): Promise<Snapshot[]>` — returns snapshots sorted by `ts` ascending, exact same shape as `getSnapshotsForGame`
  - `src/utils/storage.ts:getSnapshotsForGame` — the function being replaced; returns `Promise<Snapshot[]>` — same type, drop-in replacement

  **Test References** (testing patterns to follow):
  - `tests/idb-storage.test.ts` — existing IDB tests using `fake-indexeddb`, shows how to save and retrieve snapshots
  - `tests/setup.ts` — imports `fake-indexeddb/auto` for IDB test environment

  **WHY Each Reference Matters**:
  - `popup/main.ts:68` shows the exact import + call pattern that already works in production — copy this approach
  - `idb-storage.ts:132-136` confirms the function signature is identical to `getSnapshotsForGame` — no adapter needed
  - `idb-storage.test.ts` shows how to set up fake IDB for testing the options flow

  **Acceptance Criteria**:

  - [ ] `getSnapshotsForGame` does NOT appear in `src/options/main.ts`
  - [ ] `idbGetSnapshots` IS imported from `../utils/idb-storage.js` in `src/options/main.ts`
  - [ ] `pnpm vitest run` → ALL tests pass, 0 failures
  - [ ] `pnpm build` → succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: History chart renders data from IDB
    Tool: Bash (pnpm vitest run)
    Preconditions: All existing tests pass
    Steps:
      1. Run `pnpm vitest run` — all 390+ tests pass
      2. Run `pnpm build` — build succeeds
      3. Grep `src/options/main.ts` for "getSnapshotsForGame" — expect 0 matches
      4. Grep `src/options/main.ts` for "idbGetSnapshots" — expect 2+ matches (import + usage)
    Expected Result: Zero references to `getSnapshotsForGame` in options, IDB function used instead
    Failure Indicators: Any reference to `getSnapshotsForGame` remains; build fails; tests fail
    Evidence: .sisyphus/evidence/task-1-idb-switch.txt

  Scenario: Export function reads from IDB
    Tool: Bash (grep)
    Preconditions: Task complete
    Steps:
      1. Grep `src/options/main.ts` lines 690-700 for "storage.js" — expect 0 matches
      2. Verify `idbGetSnapshots` is used in the export `Promise.all` block
    Expected Result: Export no longer dynamically imports from storage.ts
    Failure Indicators: Dynamic import of storage.ts remains in export section
    Evidence: .sisyphus/evidence/task-1-export-idb.txt
  ```

  **Commit**: YES
  - Message: `fix(options): switch snapshot reads to IndexedDB`
  - Files: `src/options/main.ts`
  - Pre-commit: `pnpm vitest run`

- [ ] 2. Fix popup tooltip overflow

  **What to do**:
  - In `src/popup/popup.css`, add `overflow: hidden` to `.panel-sparkline` container to prevent tooltip escaping
  - In `src/popup/main.ts` function `attachSparklineHover` (lines 507-567), improve tooltip positioning:
    - Current logic (line 555): `const tooltipPctX = pctX > 70 ? pctX - 6 : pctX;` — insufficient
    - New logic: Clamp tooltip `left` so it stays within [0%, 100%] accounting for tooltip width. After setting `tooltip.textContent`, measure tooltip width via `tooltip.offsetWidth`, compare to `container.offsetWidth`, and compute clamped position:
      ```
      const tooltipW = tooltip.offsetWidth;
      const containerW = container.offsetWidth;
      const halfTooltipPct = (tooltipW / 2 / containerW) * 100;
      const clampedLeft = Math.max(halfTooltipPct, Math.min(pctX, 100 - halfTooltipPct));
      tooltip.style.left = `${clampedLeft}%`;
      ```
    - Keep `transform: translateX(-50%)` in CSS — it centers the tooltip on the clamped position
  - Write test for the clamping logic: given container width 372px and tooltip width ~60px, verify tooltip stays in bounds at `pctX=0`, `pctX=50`, `pctX=98`

  **Must NOT do**:
  - Do NOT remove `white-space: nowrap` — the tooltip should be single-line
  - Do NOT change tooltip font-size or padding — the content is just a formatted number, it fits fine
  - Do NOT add animation/transitions to tooltip
  - Do NOT change the tooltip content (still `fmtNumber(snap.current)`)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small CSS + JS positioning fix, ~10 lines of change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: None
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/popup/main.ts:507-567` — Current `attachSparklineHover()` implementation — the function to modify
  - `src/popup/main.ts:531-556` — The `onMouseMove` handler with the broken positioning logic at line 555

  **API/Type References**:
  - `src/utils/sparkline.ts:findNearestPointIndex` — used at line 538 to find the nearest data point to cursor; no changes needed here
  - `src/utils/trend.ts:fmtNumber` — formats the tooltip text; no changes needed

  **External References**:
  - CSS `transform: translateX(-50%)` — centers element on its `left` position. Combined with clamping, this keeps tooltip fully visible

  **WHY Each Reference Matters**:
  - `main.ts:555` is the exact line to replace — the `pctX > 70 ? pctX - 6 : pctX` logic
  - `popup.css:454-471` is the `.sparkline-tooltip` class to verify after fix (no width changes needed, just clamped position)

  **Acceptance Criteria**:

  - [ ] Tooltip at left edge (pctX ≈ 0%) does not clip left of container
  - [ ] Tooltip at right edge (pctX ≈ 98%) does not clip right of container
  - [ ] Tooltip at center (pctX ≈ 50%) remains centered on the data point
  - [ ] `.panel-sparkline` has `overflow: hidden` in CSS
  - [ ] `pnpm vitest run` → ALL tests pass, 0 failures
  - [ ] `pnpm build` → succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Tooltip stays within container at right edge
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, popup open, at least one game tracked with sparkline data
    Steps:
      1. Open popup, find a `.panel-sparkline` container
      2. Move mouse to rightmost 5% of the sparkline container
      3. Assert `.sparkline-tooltip` is visible (hidden=false)
      4. Get tooltip bounding rect and container bounding rect
      5. Assert tooltip.right <= container.right
    Expected Result: Tooltip right edge does not exceed container right edge
    Failure Indicators: tooltip.right > container.right (overflow to the right)
    Evidence: .sisyphus/evidence/task-2-tooltip-right-edge.png

  Scenario: Tooltip stays within container at left edge
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, popup open
    Steps:
      1. Move mouse to leftmost 5% of the sparkline container
      2. Assert `.sparkline-tooltip` is visible
      3. Get tooltip bounding rect and container bounding rect
      4. Assert tooltip.left >= container.left
    Expected Result: Tooltip left edge does not go below container left edge
    Failure Indicators: tooltip.left < container.left (overflow to the left)
    Evidence: .sisyphus/evidence/task-2-tooltip-left-edge.png
  ```

  **Commit**: YES
  - Message: `fix(popup): clamp tooltip within sparkline container bounds`
  - Files: `src/popup/main.ts`, `src/popup/popup.css`
  - Pre-commit: `pnpm vitest run`

- [ ] 3. Update data retention label to reflect compaction

  **What to do**:
  - In `src/options/index.html` line 181, replace the `<div class="slider-desc">` content:
    - **Old text**: `"Snapshots older than this are automatically purged. The long-range popup stats use this full retention window, so 10 days means 10d average and 10d gain/loss."`
    - **New text**: `"Full-resolution data window. Snapshots within this period are kept at original detail; older data is preserved as daily and weekly summaries. The popup's long-range stats (e.g. 10d average, 10d gain/loss) use this window."`
  - That's it — one string replacement. No JS or CSS changes.

  **Must NOT do**:
  - Do NOT change the slider range (3–30)
  - Do NOT change the slider `id` or `value` attributes
  - Do NOT change the `purgeAfterDays` variable name in JS (it's an internal name, not user-facing)
  - Do NOT change `compactSnapshots()` behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single line text replacement in HTML
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: None
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/options/index.html:178-187` — The `<div class="slider-row">` containing the Data retention slider with the description to change at line 181

  **API/Type References**:
  - `src/utils/compaction.ts` — The `compactSnapshots()` function that the label now accurately describes: keeps full-resolution within `fullResolutionDays`, compacts to daily summaries 7–90 days, weekly summaries 90+ days

  **WHY Each Reference Matters**:
  - Line 181 is the exact element to edit — the `slider-desc` div
  - `compaction.ts` documents the actual behavior the label should describe (daily + weekly aggregates, not purge)

  **Acceptance Criteria**:

  - [ ] The word "purged" does NOT appear in `src/options/index.html`
  - [ ] New description mentions "daily and weekly summaries"
  - [ ] `pnpm build` → succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Data retention label accurately describes compaction
    Tool: Bash (grep)
    Preconditions: Task complete
    Steps:
      1. Grep `src/options/index.html` for "purged" — expect 0 matches
      2. Grep `src/options/index.html` for "daily and weekly summaries" — expect 1 match
      3. Run `pnpm build` — succeeds
    Expected Result: Old misleading text replaced, new text describes compaction
    Failure Indicators: "purged" still present, or "daily and weekly summaries" not found
    Evidence: .sisyphus/evidence/task-3-label-update.txt
  ```

  **Commit**: YES
  - Message: `fix(options): update data retention label to reflect compaction`
  - Files: `src/options/index.html`
  - Pre-commit: `pnpm vitest run`

- [ ] 4. Show letter placeholder for failed game images in options

  **What to do**:
  - In `src/options/main.ts` function `buildGameRow()` (lines 89-106), modify the `<img>` HTML to wrap it in a container with a placeholder fallback — matching the popup's pattern:
    - Current (line 96): `<img class="game-row-thumb" src="${esc(game.image)}" ...>`
    - New structure:
      ```html
      <span class="game-row-thumb-wrap">
        <img class="game-row-thumb" src="${esc(game.image)}" alt="${esc(game.name)}" loading="lazy">
        <span class="game-row-placeholder" style="--thumb-color:${thumbColor(game.appid)}">${esc(game.name.charAt(0).toUpperCase())}</span>
      </span>
      ```
  - Import `thumbColor` from `../popup/thumb.js` (already imported: `wireThumbFallback` — add `thumbColor` to that import)
  - Modify the existing `wireThumbFallback` call to work with the new structure — currently at line 127 (approx), the code wires fallback to each game row's img. Update so on double failure, instead of hiding the image, it adds `img-error` class to the `.game-row-thumb-wrap` which shows the placeholder
  - Add CSS in `src/options/options.css`:
    ```css
    .game-row-thumb-wrap { position: relative; width: 38px; height: 28px; flex-shrink: 0; border-radius: 4px; overflow: hidden; }
    .game-row-thumb-wrap .game-row-thumb { width: 100%; height: 100%; object-fit: cover; }
    .game-row-placeholder { display: none; position: absolute; inset: 0; background: var(--thumb-color, #2563eb); align-items: center; justify-content: center; font-family: var(--ff-head); font-size: 13px; font-weight: 700; color: rgba(255 255 255 / .95); }
    .game-row-thumb-wrap.img-error .game-row-thumb { display: none; }
    .game-row-thumb-wrap.img-error .game-row-placeholder { display: flex; }
    ```
  - Write test: simulate image double-error, assert placeholder becomes visible with correct letter and background color

  **Must NOT do**:
  - Do NOT add new API calls for images (no SteamGridDB, no external image search)
  - Do NOT modify `src/popup/thumb.ts` — it already exports what we need
  - Do NOT change the image dimensions (38×28px)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small HTML template change + CSS addition + import addition
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: None
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/popup/popup.css:195-209` — Popup's placeholder pattern: `.thumb-wrap.img-error .game-thumb { display: none; }` / `.thumb-wrap.img-error .thumb-placeholder { display: flex; }` — replicate this exact pattern for options
  - `src/popup/main.ts:143-154` — How popup creates the placeholder span with `--thumb-color` CSS variable

  **API/Type References**:
  - `src/popup/thumb.ts:1-9` — `thumbColor(appid: string): string` — deterministic color from 10-color palette based on last digit of appid
  - `src/popup/thumb.ts:11-24` — `wireThumbFallback(imgEl, wrapEl, appid)` — sets `img-error` class on double failure

  **Test References**:
  - `tests/popup-dom.test.ts:38-47` — Existing test: "adds img-error to the wrapper after the fallback also fails" — replicate for options

  **WHY Each Reference Matters**:
  - `popup.css:195-209` is the EXACT CSS pattern to copy — `img-error` class toggles visibility between img and placeholder
  - `thumb.ts:thumbColor` provides deterministic color per game — ensures consistent placeholder colors across popup and options
  - `popup-dom.test.ts:38-47` shows how to simulate the double-error and assert the `img-error` class

  **Acceptance Criteria**:

  - [ ] Games without valid images show a colored letter placeholder (first letter of game name)
  - [ ] Placeholder color matches `thumbColor(appid)` from `src/popup/thumb.ts`
  - [ ] `wireThumbFallback` is correctly wired to the new `.game-row-thumb-wrap` container
  - [ ] `pnpm vitest run` → ALL tests pass, 0 failures
  - [ ] `pnpm build` → succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Letter placeholder appears for games with missing images
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, options page open, at least one game tracked whose image URL fails
    Steps:
      1. Open options page, navigate to tracked games list
      2. Find a game row where the image fails to load (e.g., a game with invalid capsule image)
      3. Assert `.game-row-thumb-wrap` has class `img-error`
      4. Assert `.game-row-placeholder` is visible (display: flex)
      5. Assert placeholder text content is the first letter of the game name (uppercase)
      6. Assert placeholder has a non-default background color (from thumbColor palette)
    Expected Result: Colored letter placeholder visible instead of missing/hidden image
    Failure Indicators: Image area is blank/hidden, no placeholder visible
    Evidence: .sisyphus/evidence/task-4-placeholder.png

  Scenario: Games with valid images still show their image
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, options page open, at least one game with valid Steam capsule image
    Steps:
      1. Find a game row where image loaded successfully
      2. Assert `.game-row-thumb` is visible (display is NOT none)
      3. Assert `.game-row-placeholder` is hidden (display: none)
    Expected Result: Normal image display is unaffected
    Failure Indicators: Placeholder shows instead of valid image
    Evidence: .sisyphus/evidence/task-4-valid-image.png
  ```

  **Commit**: YES
  - Message: `fix(options): show letter placeholder for failed game images`
  - Files: `src/options/main.ts`, `src/options/options.css`
  - Pre-commit: `pnpm vitest run`

- [ ] 5. Add interactive hover tooltip to Options History chart

  **What to do**:
  - In `src/options/main.ts`, after the chart SVG is rendered in `renderHistory()` (after line 648), add hover interaction elements and event listeners matching the popup's `attachSparklineHover()` pattern but adapted for the History chart's dimensions:
    - Create three DOM elements: `.sparkline-tooltip` (div), `.sparkline-hover-line` (div), `.sparkline-hover-dot` (div)
    - Append them to `.history-chart-wrap` (the container around the SVG)
    - Add `mousemove` listener on `.history-chart-wrap`:
      - Convert DOM mouse position to SVG coordinates accounting for the History chart's viewBox (600×160) and padding (padX=52, padY=16):
        ```
        const svgX = (domX / domW) * 600;
        ```
      - Use `findNearestPointIndex(svgX, pts)` to find the nearest data point
      - Show tooltip with content: `fmtNumber(snap.current) + " — " + fmtTime(snap.ts)` (player count + timestamp)
      - Position tooltip, hover line, and hover dot using percentage coordinates within the container
      - Apply the same edge-clamping logic from Task 2 (measure tooltip width, clamp `left` percentage)
    - Add `mouseleave` listener to hide all three elements
    - **IMPORTANT**: Before appending hover elements, check if they already exist in the container (from a previous `renderHistory()` call) and remove them. This prevents duplicates when the user switches games or time windows.
  - Ensure `.history-chart-wrap` has `position: relative` in CSS (check if already set — if not, add it to `options.css`)
  - Import `findNearestPointIndex` from `../utils/sparkline.js`
  - The tooltip shows BOTH player count AND timestamp (unlike popup which shows only count) because the History chart is larger and context is valuable

  **Must NOT do**:
  - Do NOT change the SVG rendering code (lines 590-648) — hover is a DOM overlay, not SVG elements
  - Do NOT add click-to-pin, zoom, pan, or crosshair interactions
  - Do NOT change the chart viewBox (600×160) or padding (padX=52, padY=16)
  - Do NOT modify `src/utils/sparkline.ts` — just import and use existing `findNearestPointIndex`
  - Do NOT invent new CSS classes — reuse `.sparkline-tooltip`, `.sparkline-hover-line`, `.sparkline-hover-dot` from popup.css (they'll need to be duplicated or shared in options.css)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires careful coordinate math, DOM manipulation, and event handling adapted from popup pattern
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (with Task 6, but T5 should complete before T6)
  - **Blocks**: Task 6 (stats expansion builds on the hover infrastructure)
  - **Blocked By**: Task 1 (History chart must read from IDB first)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/popup/main.ts:507-567` — `attachSparklineHover()` — THE reference implementation. Copy the overall pattern (create 3 elements, mousemove to find nearest point, position elements, mouseleave to hide). Key differences for options: viewBox is 600×160 (not 372×56), chart has padding (padX=52, padY=16), tooltip shows timestamp too
  - `src/popup/popup.css:454-490` — CSS for `.sparkline-tooltip`, `.sparkline-hover-line`, `.sparkline-hover-dot` — replicate these styles in `options.css` (or share via a common stylesheet — but the popup and options have separate CSS files, so duplication is the existing pattern)

  **API/Type References**:
  - `src/utils/sparkline.ts:findNearestPointIndex(svgX, points)` — binary search for nearest point by X coordinate; returns index into the points array
  - `src/utils/trend.ts:fmtNumber(n)` — formats number with locale separators for tooltip display
  - `src/options/main.ts:610-613` — `fmtTime(ts)` — formats timestamp for tooltip display (already exists in renderHistory scope)

  **Test References**:
  - No existing hover tests in the codebase. Write new test: mock a container, dispatch `MouseEvent` at known positions, assert tooltip text and visibility

  **WHY Each Reference Matters**:
  - `popup/main.ts:507-567` is THE gold standard — don't reinvent, adapt
  - `findNearestPointIndex` handles the hard part (binary search) — just call it
  - `fmtTime` at line 610 already exists in the render function scope — reuse for tooltip timestamp

  **Acceptance Criteria**:

  - [ ] Hovering over the History chart shows a tooltip with player count and timestamp
  - [ ] A vertical line and dot appear at the hovered data point
  - [ ] Tooltip text format: `"1,234 — 3/27 14:30"` (fmtNumber + fmtTime)
  - [ ] Moving mouse across chart updates tooltip to nearest data point
  - [ ] Leaving chart hides tooltip, line, and dot
  - [ ] Switching games or time windows does not duplicate hover elements
  - [ ] Tooltip stays within container bounds (edge clamping)
  - [ ] `pnpm vitest run` → ALL tests pass, 0 failures
  - [ ] `pnpm build` → succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Hover tooltip appears on History chart
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, options page open, History tab selected, a game selected with chart data
    Steps:
      1. Navigate to Options → History section
      2. Select a game from the dropdown
      3. Verify chart SVG renders (polyline visible)
      4. Move mouse to center of `.history-chart-wrap`
      5. Assert `.sparkline-tooltip` is visible within `.history-chart-wrap`
      6. Assert tooltip text matches format: number + " — " + date/time
      7. Assert `.sparkline-hover-line` is visible
      8. Assert `.sparkline-hover-dot` is visible
    Expected Result: Tooltip, line, and dot appear at hovered position
    Failure Indicators: No tooltip appears; tooltip appears but empty; hover elements not visible
    Evidence: .sisyphus/evidence/task-5-hover-tooltip.png

  Scenario: Tooltip disappears on mouse leave
    Tool: Playwright (playwright skill)
    Preconditions: Tooltip is currently visible from previous scenario
    Steps:
      1. Move mouse outside `.history-chart-wrap`
      2. Assert `.sparkline-tooltip` is hidden
      3. Assert `.sparkline-hover-line` is hidden
      4. Assert `.sparkline-hover-dot` is hidden
    Expected Result: All hover elements hidden
    Failure Indicators: Any hover element remains visible after mouse leaves
    Evidence: .sisyphus/evidence/task-5-hover-leave.png

  Scenario: Switching games clears and rebuilds hover
    Tool: Playwright (playwright skill)
    Preconditions: History chart shown for Game A
    Steps:
      1. Hover over chart to show tooltip
      2. Change game dropdown to Game B
      3. Count `.sparkline-tooltip` elements inside `.history-chart-wrap` — expect exactly 1 (not 2)
      4. Hover over chart again — tooltip shows Game B data
    Expected Result: No duplicate hover elements after game switch
    Failure Indicators: Multiple tooltip elements in container; tooltip shows stale data
    Evidence: .sisyphus/evidence/task-5-game-switch.png
  ```

  **Commit**: YES
  - Message: `feat(options): add interactive hover tooltip to History chart`
  - Files: `src/options/main.ts`, `src/options/options.css`
  - Pre-commit: `pnpm vitest run`

- [ ] 6. Add Record Low, All-time Low, and price stats to History panel

  **What to do**:

  **Part A — Expand stats grid (HTML + JS):**
  - In `src/options/index.html` (lines 395-411), add 2 new stat items after "Recorded Peak":
    ```html
    <div class="history-stat">
      <div class="history-stat-label">Record Low</div>
      <div class="history-stat-value" id="hStatRecordLow">—</div>
    </div>
    <div class="history-stat">
      <div class="history-stat-label">All-time Low</div>
      <div class="history-stat-value" id="hStatAllTimeLow">—</div>
    </div>
    ```
  - In `src/options/options.css`, change `.history-stats` grid from `repeat(4, 1fr)` to `repeat(3, 1fr)` for a balanced 2×3 layout (6 stats total)
  - In `src/options/main.ts` `renderHistory()`, after the existing stats update (lines 650-659):
    - Import `computeWindowMin` from `../utils/trend.js`
    - Compute `recordLow = computeWindowMin(filtered)` — lowest in current time window
    - Compute `allTimeLow = computeWindowMin(allSnaps)` — lowest across all data
    - Get the `hStatRecordLow` and `hStatAllTimeLow` elements and set their text to `fmtNumber(recordLow)` and `fmtNumber(allTimeLow)` respectively

  **Part B — Add price stats section (HTML + JS):**
  - In `src/options/index.html`, after the `.history-stats` div (after line 412), add a price stats section:
    ```html
    <div class="history-price-stats" id="historyPriceStats" hidden>
      <div class="history-price-title">Price Information <span class="itad-credit">via <a href="https://isthereanydeal.com" target="_blank" rel="noopener">IsThereAnyDeal</a></span></div>
      <div class="history-price-grid">
        <div class="history-stat">
          <div class="history-stat-label">Historical Low</div>
          <div class="history-stat-value" id="hStatHistLow">—</div>
        </div>
        <div class="history-stat">
          <div class="history-stat-label">Current Price</div>
          <div class="history-stat-value" id="hStatCurrentPrice">—</div>
        </div>
        <div class="history-stat">
          <div class="history-stat-label">Discount</div>
          <div class="history-stat-value" id="hStatDiscount">—</div>
        </div>
      </div>
    </div>
    ```
  - In `src/options/options.css`, add styles for `.history-price-stats`:
    ```css
    .history-price-stats { margin-top: 12px; }
    .history-price-title { font-size: 11px; font-family: var(--ff-mono); color: var(--text-3); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .history-price-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .itad-credit { font-size: 10px; text-transform: none; letter-spacing: normal; }
    .itad-credit a { color: var(--accent); text-decoration: none; }
    .itad-credit a:hover { text-decoration: underline; }
    ```
  - In `src/options/main.ts` `renderHistory()`:
    - Import `idbGetPriceHistory` from `../utils/idb-storage.js` and `idbGetItadMapping` from the same module
    - After computing player stats, check if the selected game has ITAD data:
      ```ts
      const itadUuid = await idbGetItadMapping(appid);
      const priceStatsEl = document.getElementById("historyPriceStats");
      if (itadUuid && priceStatsEl) {
        const priceHistory = await idbGetPriceHistory(appid);
        if (priceHistory.length > 0) {
          show(priceStatsEl);
          // Find historical low
          const histLow = priceHistory.reduce((min, r) => r.priceAmountInt < min.priceAmountInt ? r : min);
          // Latest price entry
          const latest = priceHistory[priceHistory.length - 1]!;
          // Update elements
          hStatHistLow.textContent = histLow.priceFormatted ?? `$${(histLow.priceAmountInt / 100).toFixed(2)}`;
          hStatCurrentPrice.textContent = latest.priceFormatted ?? `$${(latest.priceAmountInt / 100).toFixed(2)}`;
          hStatDiscount.textContent = latest.discountPct > 0 ? `-${latest.discountPct}%` : "—";
        } else {
          hide(priceStatsEl);
        }
      } else if (priceStatsEl) {
        hide(priceStatsEl);
      }
      ```
    - When no ITAD data exists for a game, the price section stays hidden — no error, no empty section

  **Must NOT do**:
  - Do NOT add a price chart/sparkline to the History panel — stats only
  - Do NOT fetch ITAD data from the options page — read from IDB only
  - Do NOT change `compactSnapshots()` behavior
  - Do NOT modify `src/utils/trend.ts` — just import `computeWindowMin`
  - Do NOT modify `src/utils/idb-storage.ts` — just import existing functions
  - Do NOT change the existing 4 stats (Current, 24h Avg, Period Avg, Recorded Peak) — only add new ones

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multi-file change (HTML + CSS + JS), requires IDB reads, price formatting, and grid layout
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (must come after T5)
  - **Parallel Group**: Wave 2 (after Task 5)
  - **Blocks**: None
  - **Blocked By**: Task 1 (IDB switch), Task 5 (hover infrastructure — so renderHistory is already updated)

  **References**:

  **Pattern References**:
  - `src/options/main.ts:650-659` — Existing stats update pattern in `renderHistory()` — follow this exact pattern for Record Low + All-time Low
  - `src/options/index.html:395-411` — Existing stats HTML structure — replicate for new stats
  - `src/popup/main.ts:316-320` — Popup's price display section — reference for how price data is formatted

  **API/Type References**:
  - `src/utils/trend.ts:computeWindowMin(snaps)` — returns the minimum `current` value from snapshot array, or `null` if empty
  - `src/utils/idb-storage.ts:idbGetItadMapping(appId)` — returns ITAD UUID or `null`
  - `src/utils/idb-storage.ts:idbGetPriceHistory(appId)` — returns `PriceRecord[]` sorted by timestamp
  - `src/types/index.ts:PriceRecord` — `{ priceAmountInt: number; priceFormatted?: string; discountPct: number; ts: number; ... }`

  **Test References**:
  - `tests/trend.test.ts` — Tests for `computeWindowMin` — verify it returns correct minimum
  - `tests/idb-storage.test.ts` — Tests for IDB operations — follow pattern for price history tests

  **WHY Each Reference Matters**:
  - `main.ts:650-659` shows the exact DOM query + textContent update pattern to follow
  - `computeWindowMin` does the heavy lifting for Record Low/All-time Low — just call it with the right snapshot array
  - `idbGetPriceHistory` returns the data needed for price stats — format it for display
  - `PriceRecord` type tells us exactly what fields are available (priceAmountInt, priceFormatted, discountPct)

  **Acceptance Criteria**:

  - [ ] History stats grid shows 6 items: Current, 24h Avg, Period Avg, Recorded Peak, Record Low, All-time Low
  - [ ] Stats grid layout is `repeat(3, 1fr)` — balanced 2 rows × 3 columns
  - [ ] Record Low shows minimum player count for current time window filter
  - [ ] All-time Low shows minimum player count across all stored data
  - [ ] For games WITH ITAD data: price stats section is visible with Historical Low, Current Price, Discount
  - [ ] For games WITHOUT ITAD data: price stats section is hidden (not visible, no empty section)
  - [ ] ITAD credit link ("via IsThereAnyDeal") is present in price section
  - [ ] `pnpm vitest run` → ALL tests pass, 0 failures
  - [ ] `pnpm build` → succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Record Low and All-time Low stats display
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, options page open, History tab, a game selected with chart data
    Steps:
      1. Navigate to Options → History
      2. Select a game from dropdown
      3. Assert `#hStatRecordLow` is visible and contains a formatted number (not "—")
      4. Assert `#hStatAllTimeLow` is visible and contains a formatted number (not "—")
      5. Assert `.history-stats` grid has exactly 6 `.history-stat` children
      6. Verify grid layout: computed `grid-template-columns` is 3-column
    Expected Result: 6 stats visible in a 2×3 grid with Record Low and All-time Low populated
    Failure Indicators: Missing stat elements; stats show "—" when data exists; grid layout wrong
    Evidence: .sisyphus/evidence/task-6-stats-grid.png

  Scenario: Price stats visible for game with ITAD data
    Tool: Playwright (playwright skill)
    Preconditions: At least one tracked game has ITAD mapping and price history in IDB
    Steps:
      1. Select a game that has ITAD data
      2. Assert `#historyPriceStats` is visible (hidden=false)
      3. Assert `#hStatHistLow` contains a price string (e.g., "$4.99" or similar)
      4. Assert `#hStatCurrentPrice` contains a price string
      5. Assert `.itad-credit a` links to "https://isthereanydeal.com"
    Expected Result: Price stats section visible with formatted prices and ITAD credit
    Failure Indicators: Price section hidden when data exists; prices show "—"; credit link missing
    Evidence: .sisyphus/evidence/task-6-price-stats.png

  Scenario: Price stats hidden for game without ITAD data
    Tool: Playwright (playwright skill)
    Preconditions: At least one tracked game does NOT have ITAD mapping
    Steps:
      1. Select a game that lacks ITAD data (e.g., a free-to-play game)
      2. Assert `#historyPriceStats` is hidden
    Expected Result: Price section completely hidden, no empty section visible
    Failure Indicators: Empty price section visible; error displayed
    Evidence: .sisyphus/evidence/task-6-no-price.png

  Scenario: Stats update when time window changes
    Tool: Playwright (playwright skill)
    Preconditions: Game selected with data across multiple time windows
    Steps:
      1. Note current Record Low value with "7d" tab active
      2. Switch to "all" time window tab
      3. Assert Record Low value may change (could be lower with more data)
      4. Assert All-time Low value stays the same (always uses full data)
    Expected Result: Record Low updates based on time window; All-time Low is constant
    Failure Indicators: Record Low doesn't change when window changes; All-time Low changes with window
    Evidence: .sisyphus/evidence/task-6-window-switch.png
  ```

  **Commit**: YES
  - Message: `feat(options): add Record Low, All-time Low, and price stats to History panel`
  - Files: `src/options/index.html`, `src/options/main.ts`, `src/options/options.css`
  - Pre-commit: `pnpm vitest run`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm vitest run` + `pnpm build`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Load extension in browser. Test each fix: hover tooltip at edges of sparkline, options History chart renders from IDB, hover tooltip on History chart, stats show Record Low + All-time Low + price (if ITAD data available), game images show placeholders for games without capsule images, data retention text is accurate.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git diff). Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect unaccounted changes.
  Output: `Tasks [N/N compliant] | VERDICT`

---

## Commit Strategy

| Order | Scope | Message | Pre-commit |
|-------|-------|---------|------------|
| 1 | T1 | `fix(options): switch snapshot reads to IndexedDB` | `pnpm vitest run` |
| 2 | T2 | `fix(popup): clamp tooltip within sparkline container bounds` | `pnpm vitest run` |
| 3 | T3 | `fix(options): update data retention label to reflect compaction` | `pnpm vitest run` |
| 4 | T4 | `fix(options): show letter placeholder for failed game images` | `pnpm vitest run` |
| 5 | T5 | `feat(options): add interactive hover tooltip to History chart` | `pnpm vitest run` |
| 6 | T6 | `feat(options): add Record Low, All-time Low, and price stats to History panel` | `pnpm vitest run` |

---

## Success Criteria

### Verification Commands
```bash
pnpm vitest run   # Expected: ALL tests pass (390+ existing + new), 0 failures
pnpm build        # Expected: Build succeeds, no errors
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (390+ existing + new)
- [ ] Build succeeds
- [ ] F1–F4 all APPROVE
