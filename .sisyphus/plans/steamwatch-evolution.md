# SteamWatch Evolution — Interactive Charts, Historical DB, ITAD Integration

## TL;DR

> **Quick Summary**: Evolve SteamWatch with interactive hover tooltips on expanded charts, player count record-low tracking per time window, 6-level time filters (24h/3d/7d/15d/1m/all), IndexedDB migration for unlimited data retention with tiered compaction, ITAD API integration for historical price data and price chart, and an About page with proper ITAD attribution.
> 
> **Deliverables**:
> - Interactive hover tooltip on expanded sparklines (player count only)
> - Record low (min players) displayed as contextual row in expanded panel
> - 6 time filter pill buttons replacing current 3 tabs
> - IndexedDB storage layer (via `idb`) replacing chrome.storage.local for snapshots
> - Data migration from old storage to IndexedDB
> - ITAD API integration (lookup, price history, historical low)
> - Price history sparkline chart in expanded panel
> - About page with ITAD credits and disclaimer
> - Tiered data compaction for long-term retention
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Task 1 (types) → Task 3 (IndexedDB) → Task 5 (switchover) → Task 7 (ITAD data) → Task 8 (price chart) → Final Verification

---

## Context

### Original Request
User wants interactive hover on expanded charts, tracking of the lowest player count ("record negativo") per time window, standard time filters (24h, 3d, 7d, 15d, 1m, all), and a local DB to persist game data long-term without storage explosion. Also interested in ITAD API for price history.

### Interview Summary
**Key Discussions**:
- **Record negativo** = minimum player count (NOT price). Per selected time window + all-time always visible.
- **Chart approach**: Keep custom SVG sparklines, no external chart library. Add hover overlay.
- **Tooltip content**: Player count only (e.g., "1,234"), no date/time.
- **Time filters**: 6 pill buttons replacing current 3 tabs. Affects charts and record low.
- **Storage**: Migrate to IndexedDB via `idb`. Unlimited retention. Tiered compaction.
- **ITAD**: Integrate for price history. Hybrid fetch: lightweight data in background, full history on-demand. Steam prices only (shops=61).
- **Price chart**: Second sparkline in expanded panel showing ITAD price curve.
- **API key**: Build-time env var via Vite define. Never in runtime storage.
- **Limits**: Keep 5-game limit. Keep vanilla TS.
- **Test strategy**: TDD with Vitest. 261 existing tests to maintain.
- **About page**: ITAD credits, link to isthereanydeal.com, disclaimer per ToS.
- **Record low UI**: Row showing low for selected filter + all-time. Changes with filter selection.
- **purgeAfterDays**: Repurposed as "full-resolution window" — beyond it, compaction kicks in.
- **Touch**: Mouse-only hover (simplest approach).

**Research Findings**:
- chrome.storage.local re-serializes entire JSON blob on every write — bad for time-series
- IndexedDB via `idb` (1.8KB) is the industry standard for extensions with time-series data
- ITAD API has `games/lookup/v1`, `games/prices/history/v2`, `games/prices/historyLow/v1`
- ITAD uses query param `?key=` (not header). Must use `amountInt` (integer cents, never floats)
- 5 games × 96 snapshots/day × 365 days = ~175K records/year (~7MB) — manageable with compaction
- `navigator.storage.persist()` prevents eviction on low-disk situations

### Metis Review
**Identified Gaps** (addressed):
- Storage migration strategy → Atomic cutover with verification (keep old data until IndexedDB verified)
- ITAD fetch timing → Hybrid: background for lookup+historyLow, on-demand for full price history
- Price chart scope → Steam-only (shops=61)
- Record low contextual → Selected filter low + all-time always
- purgeAfterDays → Repurposed as full-resolution window
- Touch hover → Mouse-only (simplest)
- Missing manifest permissions → `unlimitedStorage` + ITAD host_permissions
- GraphWindowKey change is foundation → Do first, let TypeScript guide
- Service worker transaction safety → Never await fetch() inside IDB transaction
- Test mock replacement → `fake-indexeddb` in test setup

---

## Work Objectives

### Core Objective
Add interactive data visualization, long-term historical tracking, and ITAD price integration to SteamWatch while migrating storage to IndexedDB for unlimited retention.

### Concrete Deliverables
- `src/utils/idb-storage.ts` — IndexedDB storage layer with same API surface as current storage.ts
- `src/utils/migrate.ts` — One-shot migration from chrome.storage.local to IndexedDB
- `src/utils/itad-api.ts` — ITAD API client with Zod-validated responses
- Updated `src/utils/sparkline.ts` — Hover overlay system + price sparkline generator
- Updated `src/utils/card.ts` — CardViewModel extended with recordLows + price data
- Updated `src/utils/trend.ts` — `computeWindowMin()` for record low computation
- Updated `src/types/index.ts` — Extended GraphWindowKey, new ITAD types, CardViewModel fields
- Updated `src/popup/main.ts` — 6 filter pills, record low row, price chart, hover listeners
- Updated `src/popup/popup.css` — Styles for pills, tooltip, price chart, record low
- Updated `src/options/` — About section with ITAD credits
- Updated `src/background/index.ts` — ITAD background fetch, migration trigger, compaction
- Updated `manifest.json` — unlimitedStorage + ITAD host_permissions
- Updated `vite.config.ts` — ITAD API key build-time injection
- `.env.example` — Template for ITAD API key

### Definition of Done
- [ ] `pnpm vitest run` passes with 0 failures (all existing 261 tests + new TDD tests)
- [ ] IndexedDB stores snapshots; chrome.storage.local no longer holds snapshot data post-migration
- [ ] Hovering on expanded sparkline shows player count tooltip
- [ ] 6 time filter pill buttons work, charts and record low update accordingly
- [ ] Record low row shows "Xd Low: N • All-time Low: N" in expanded panel
- [ ] ITAD price history sparkline renders in expanded panel
- [ ] About section in options page credits ITAD with link
- [ ] `unlimitedStorage` permission in manifest.json
- [ ] No new npm deps beyond `idb` (runtime) and `fake-indexeddb` (dev)

### Must Have
- Interactive hover on expanded panel sparklines (player count display)
- Record low computation per time window + all-time
- 6 time filter pill buttons (24h, 3d, 7d, 15d, 1m, all)
- IndexedDB migration with data preservation
- ITAD API integration (lookup + price history + historical low)
- Price sparkline chart in expanded panel
- About page with ITAD credits and disclaimer
- TDD: tests written before implementation for all new modules
- Tiered compaction (full-resolution within window, aggregates beyond)

### Must NOT Have (Guardrails)
- No external chart library (Chart.js, D3, uPlot, etc.) — extend custom SVG
- No change to 5-game limit
- No React/Vue/Svelte — stay vanilla TS
- No "smart" features (price prediction, deal recommendations, comparison tables)
- No over-abstraction (no generic StorageProvider interface, no pluggable backends)
- No ITAD affiliate link changes or Steam link modifications
- No loading spinners or skeleton screens on existing UI elements
- No refactoring of existing test files (only add new tests + minimal mock adaptation)
- No JSDoc bloat — match existing sparse documentation style
- No `as any` / `@ts-ignore` / empty catches / console.log in production code
- No storing ITAD API key in runtime storage — build-time only
- No fetching price history on every background cycle — cache 24h minimum
- No `await fetch()` inside IndexedDB transactions
- No wrapper types around ITAD responses — use Zod-inferred types directly
- No touching notification/badge/share/export systems beyond storage API adaptation

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES — Vitest with 261 tests
- **Automated tests**: TDD (test first)
- **Framework**: Vitest (already configured)
- **Each task**: RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Pure logic modules**: Use Bash (`pnpm vitest run src/path/to/test.ts`) — assert pass/fail + coverage
- **UI changes**: Use Playwright (playwright skill) — Navigate popup, interact, assert DOM, screenshot
- **API modules**: Use Bash (vitest mocked tests) — assert Zod validation, error handling, caching
- **Storage**: Use Bash (vitest with fake-indexeddb) — assert CRUD, migration, compaction
- **Build**: Use Bash (`pnpm build`) — assert no errors, output size, manifest validity

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types + infrastructure, MAX PARALLEL):
├── Task 1: GraphWindowKey expansion + time filter types [quick]
├── Task 2: Record low computation (pure logic + TDD) [quick]
├── Task 3: IndexedDB storage layer (idb-storage.ts + TDD) [deep]
├── Task 4: ITAD API client module (itad-api.ts + TDD) [deep]
└── Task 5: Build config + manifest + env setup [quick]

Wave 2 (Integration — wire up infrastructure, PARALLEL where possible):
├── Task 6: Storage migration logic (migrate.ts + TDD) [deep]
│   (depends: 3)
├── Task 7: Storage switchover — all consumers use IndexedDB [unspecified-high]
│   (depends: 3, 6)
├── Task 8: ITAD data integration in background worker [unspecified-high]
│   (depends: 4, 5, 7)
└── Task 9: CardViewModel extension (record lows + ITAD data) [quick]
    (depends: 1, 2)

Wave 3 (UI — all visual changes, MAX PARALLEL):
├── Task 10: 6 filter pill buttons UI [visual-engineering]
│    (depends: 1, 7, 9)
├── Task 11: Interactive hover tooltip on expanded sparklines [visual-engineering]
│    (depends: 7, 9)
├── Task 12: Price history sparkline chart [visual-engineering]
│    (depends: 8, 9)
├── Task 13: Record low row in expanded panel [visual-engineering]
│    (depends: 2, 9, 10)
└── Task 14: About page with ITAD credits [quick]
    (depends: 5)

Wave 4 (Optimization + polish):
└── Task 15: Tiered data compaction [deep]
    (depends: 7)

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 3 → Task 7 → Task 8 → Task 12 → Final
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 5 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 9, 10 | 1 |
| 2 | — | 9, 13 | 1 |
| 3 | — | 6, 7 | 1 |
| 4 | — | 8 | 1 |
| 5 | — | 8, 14 | 1 |
| 6 | 3 | 7 | 2 |
| 7 | 3, 6 | 8, 10, 11, 12, 15 | 2 |
| 8 | 4, 5, 7 | 12 | 2 |
| 9 | 1, 2 | 10, 11, 12, 13 | 2 |
| 10 | 1, 7, 9 | 13 | 3 |
| 11 | 7, 9 | — | 3 |
| 12 | 8, 9 | — | 3 |
| 13 | 2, 9, 10 | — | 3 |
| 14 | 5 | — | 3 |
| 15 | 7 | — | 4 |

### Agent Dispatch Summary

- **Wave 1**: **5 tasks** — T1 → `quick`, T2 → `quick`, T3 → `deep`, T4 → `deep`, T5 → `quick`
- **Wave 2**: **4 tasks** — T6 → `deep`, T7 → `unspecified-high`, T8 → `unspecified-high`, T9 → `quick`
- **Wave 3**: **5 tasks** — T10 → `visual-engineering`, T11 → `visual-engineering`, T12 → `visual-engineering`, T13 → `visual-engineering`, T14 → `quick`
- **Wave 4**: **1 task** — T15 → `deep`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Expand GraphWindowKey type + time filter constants

  **What to do**:
  - RED: Write tests in `tests/sparkline.test.ts` (or new `tests/graph-windows.test.ts`) that:
    - Assert `GraphWindowKey` accepts all 6 values: `"24h" | "3d" | "7d" | "15d" | "1m" | "all"`
    - Assert `GRAPH_WINDOW_MS` maps all 6 keys to correct millisecond values (7d=604800000, 15d=1296000000, 1m=2592000000, "all"=Infinity or null sentinel)
    - Assert `buildAvailableGraphWindows()` returns up to 6 options based on data availability
    - Assert `filterSnapshotsByWindow()` handles new window sizes correctly
    - Assert `hasEnoughGraphHistory()` works for new windows (still ≥6 snapshots AND ≥75% span)
  - GREEN: Update `src/types/index.ts` — expand `GraphWindowKey` union type to include `"7d" | "15d" | "1m" | "all"`
  - GREEN: Update `src/utils/sparkline.ts` — add new entries to `GRAPH_WINDOW_MS` map, update `buildAvailableGraphWindows()` and `filterSnapshotsByWindow()` to handle all 6 windows
  - GREEN: The `"all"` window should use `0` as start time (i.e., no filter — return all snapshots)
  - REFACTOR: Ensure no hardcoded `"retention"` references remain — replace with `"all"` concept

  **Must NOT do**:
  - Do NOT change UI/DOM code (that's Task 10)
  - Do NOT remove the retention concept from Settings — `purgeAfterDays` is repurposed later (Task 15)
  - Do NOT add any chart library

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure type + constant expansion with test-first approach. Well-scoped, single module focus.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `vercel-react-best-practices`: Not React code

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/types/index.ts:GraphWindowKey` — Current union type `"24h" | "3d" | "retention"` to expand
  - `src/utils/sparkline.ts:GRAPH_WINDOW_MS` — Current map with 24h and 3d ms values. Add 7d=604800000, 15d=1296000000, 1m=2592000000
  - `src/utils/sparkline.ts:buildAvailableGraphWindows()` — Creates `GraphWindowOption[]` based on data completeness. Must return up to 6 options now
  - `src/utils/sparkline.ts:filterSnapshotsByWindow()` — Filters snapshots by timestamp cutoff. "all" should skip filtering
  - `src/utils/sparkline.ts:hasEnoughGraphHistory()` — Requires ≥6 snapshots AND ≥75% span. For "all", just ≥6 snapshots (no span check)

  **API/Type References**:
  - `src/types/index.ts:GraphWindowOption` — The option object returned by buildAvailableGraphWindows. Has `key: GraphWindowKey` field
  - `src/types/index.ts:CardViewModel` — Has `graphWindows: GraphWindowOption[]` — will contain up to 6 entries after this change

  **Test References**:
  - `tests/sparkline.test.ts` — Existing sparkline tests. Follow the `describe`/`it` structure
  - `tests/setup.ts` — Test setup with chrome.storage.local mock

  **WHY Each Reference Matters**:
  - `GraphWindowKey` type change is the foundation — TypeScript compiler will find every usage that needs updating
  - `GRAPH_WINDOW_MS` is used by all window-related functions — must have all 6 entries
  - `buildAvailableGraphWindows()` drives the tab/pill UI — must return correct options
  - "all" window is special (no time cutoff) — needs distinct handling in filter logic

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created/updated: `tests/graph-windows.test.ts`
  - [ ] `pnpm vitest run tests/graph-windows.test.ts` → PASS (all new tests green)
  - [ ] Existing tests still pass: `pnpm vitest run` → 0 failures

  **QA Scenarios:**

  ```
  Scenario: All 6 GraphWindowKey values are valid
    Tool: Bash (pnpm vitest run)
    Preconditions: Tests written that assert type validity
    Steps:
      1. Run `pnpm vitest run tests/graph-windows.test.ts`
      2. Assert all tests pass
    Expected Result: 0 failures, all 6 window keys tested
    Failure Indicators: TypeScript compile error or test failure
    Evidence: .sisyphus/evidence/task-1-window-keys.txt

  Scenario: "all" window returns unfiltered snapshots
    Tool: Bash (pnpm vitest run)
    Preconditions: Test with 100 snapshots spanning 60 days
    Steps:
      1. Call filterSnapshotsByWindow(snapshots, "all")
      2. Assert result.length === 100 (no filtering)
    Expected Result: All snapshots returned
    Failure Indicators: Fewer snapshots returned or error thrown
    Evidence: .sisyphus/evidence/task-1-all-window.txt

  Scenario: Build succeeds with expanded types
    Tool: Bash (pnpm build)
    Preconditions: All type changes applied
    Steps:
      1. Run `pnpm build`
      2. Assert exit code 0
    Expected Result: Clean build, no type errors
    Failure Indicators: TypeScript errors in consumers of GraphWindowKey
    Evidence: .sisyphus/evidence/task-1-build.txt
  ```

  **Commit**: YES
  - Message: `feat(types): expand GraphWindowKey to 6 time filters`
  - Files: `src/types/index.ts`, `src/utils/sparkline.ts`, `tests/graph-windows.test.ts`
  - Pre-commit: `pnpm vitest run`

- [x] 2. Record low computation (computeWindowMin)

  **What to do**:
  - RED: Write tests in `tests/trend.test.ts` (add new describe block):
    - `computeWindowMin([])` → `null` (empty array)
    - `computeWindowMin([{ts: 1000, current: 50}])` → `{ value: 50, timestamp: 1000 }`
    - `computeWindowMin([...10 snapshots])` → correct min with its timestamp
    - `computeWindowMin` with all same values → returns first occurrence
    - `computeWindowMin` with `current: 0` → returns 0 (not falsy skip)
  - GREEN: Add `computeWindowMin(snapshots: Snapshot[]): { value: number; timestamp: number } | null` to `src/utils/trend.ts`
  - GREEN: Simple reduce over snapshots to find minimum `current` value and its `ts`
  - REFACTOR: Ensure function is exported and has clean signature

  **Must NOT do**:
  - Do NOT add this to CardViewModel yet (Task 9)
  - Do NOT touch UI (Task 13)
  - Do NOT compute for multiple windows in one call — keep it single-window (caller selects window first)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single pure function with straightforward TDD. ~20 lines of implementation.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Tasks 9, 13
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/utils/trend.ts:computeTrend()` — Follow this pattern: takes Snapshot[], returns computed value. Pure function, no side effects
  - `src/utils/trend.ts:compute24hAvg()` — Another example of Snapshot[] → number computation

  **API/Type References**:
  - `src/types/index.ts:Snapshot` — `{ ts: number; current: number }` — the input type
  - Return type should be `{ value: number; timestamp: number } | null`

  **Test References**:
  - `tests/trend.test.ts` — Existing trend tests. Add new `describe("computeWindowMin")` block

  **WHY Each Reference Matters**:
  - `computeTrend()` shows the established pattern for snapshot computation functions
  - `Snapshot` type has `.ts` (timestamp) and `.current` (player count) — min is on `.current`
  - Existing trend tests show assertion style and test data creation patterns

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Tests added to `tests/trend.test.ts`
  - [ ] `pnpm vitest run tests/trend.test.ts` → PASS (new + existing tests)

  **QA Scenarios:**

  ```
  Scenario: Empty snapshots return null
    Tool: Bash (pnpm vitest run)
    Preconditions: Test with empty array input
    Steps:
      1. Run `pnpm vitest run tests/trend.test.ts`
      2. Assert computeWindowMin([]) returns null
    Expected Result: null returned, no error
    Failure Indicators: Error thrown or non-null value
    Evidence: .sisyphus/evidence/task-2-empty.txt

  Scenario: Zero player count correctly identified as minimum
    Tool: Bash (pnpm vitest run)
    Preconditions: Test with snapshots including current=0
    Steps:
      1. Test computeWindowMin with snapshots [100, 50, 0, 25]
      2. Assert returns { value: 0, timestamp: <ts of 0 snapshot> }
    Expected Result: 0 is correctly identified (not skipped as falsy)
    Failure Indicators: Returns 25 or null instead of 0
    Evidence: .sisyphus/evidence/task-2-zero.txt
  ```

  **Commit**: YES
  - Message: `feat(trend): add computeWindowMin for record low tracking`
  - Files: `src/utils/trend.ts`, `tests/trend.test.ts`
  - Pre-commit: `pnpm vitest run`

- [x] 3. IndexedDB storage layer (idb-storage.ts)

  **What to do**:
  - Install `idb` as runtime dependency and `fake-indexeddb` as dev dependency: `pnpm add idb && pnpm add -D fake-indexeddb`
  - RED: Write tests in `tests/idb-storage.test.ts`:
    - Test DB open/close lifecycle
    - Test `saveSnapshot(appId, snapshot)` → stores record with compound key [appId, timestamp]
    - Test `getSnapshotsForGame(appId)` → returns all snapshots sorted by timestamp
    - Test `getSnapshotsInRange(appId, startTs, endTs)` → returns filtered snapshots using IDB range query
    - Test `deleteSnapshotsForGame(appId)` → removes all records for that appId
    - Test `saveItadMapping(appId, itadUuid)` + `getItadMapping(appId)` → stores/retrieves UUID mapping
    - Test `savePriceHistory(appId, records[])` + `getPriceHistory(appId)` → stores/retrieves ITAD price records
    - Test concurrent writes don't corrupt data
  - GREEN: Create `src/utils/idb-storage.ts`:
    - Use `openDB` from `idb` library
    - DB name: `steamwatch`, version: 1
    - Object stores:
      - `snapshots`: keyPath `id` (auto-generated), indexes: `byApp` on `appId`, `byAppTime` compound on `[appId, ts]`
      - `itadMappings`: keyPath `appId` — stores `{ appId: string, itadUuid: string, updatedAt: number }`
      - `priceHistory`: keyPath `id` (auto-generated), indexes: `byApp` on `appId`, `byAppTime` compound on `[appId, timestamp]`
    - Export functions matching the API surface pattern of existing `storage.ts`:
      - `idbSaveSnapshot(appId: string, snap: Snapshot): Promise<void>`
      - `idbGetSnapshots(appId: string): Promise<Snapshot[]>`
      - `idbGetSnapshotsInRange(appId: string, startTs: number, endTs: number): Promise<Snapshot[]>`
      - `idbDeleteSnapshots(appId: string): Promise<void>`
      - `idbSaveItadMapping(appId: string, uuid: string): Promise<void>`
      - `idbGetItadMapping(appId: string): Promise<string | null>`
      - `idbSavePriceHistory(appId: string, records: PriceRecord[]): Promise<void>`
      - `idbGetPriceHistory(appId: string): Promise<PriceRecord[]>`
    - Lazy DB connection: open on first call, reuse handle. Auto-reconnect if closed (MV3 service worker lifecycle).
    - Use `{ durability: 'relaxed' }` for write transactions (performance)
    - NEVER `await fetch()` inside a transaction
  - REFACTOR: Ensure clean error handling — wrap in try/catch, return sensible defaults on failure
  - Update `tests/setup.ts` to include `fake-indexeddb` polyfill: `import 'fake-indexeddb/auto'`

  **Must NOT do**:
  - Do NOT modify existing `storage.ts` — it stays intact until Task 7
  - Do NOT migrate data here (that's Task 6)
  - Do NOT add compaction logic here (that's Task 15)
  - Do NOT over-abstract into a generic StorageProvider interface

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: IndexedDB in MV3 has gotchas (service worker lifecycle, transaction auto-close). Needs careful implementation.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/utils/storage.ts` — Current storage API. New module should have equivalent function signatures where applicable (getSnapshotsForGame, saveSnapshot, etc.)
  - `src/utils/storage.ts:getSnapshotsForGame()` — Current implementation reads `sw_snaps_{appId}` from chrome.storage.local. New IDB version uses compound index range query.
  - `src/utils/storage.ts:purgeSnapshotsForGame()` — Current purge logic. Will be replaced by IDB range delete in Task 15.

  **API/Type References**:
  - `src/types/index.ts:Snapshot` — `{ ts: number; current: number }` — stored in `snapshots` object store
  - New type needed: `PriceRecord` — `{ appId: string; timestamp: number; priceAmountInt: number; regularAmountInt: number; cut: number; shop: string }` — define in types/index.ts or inline

  **Test References**:
  - `tests/storage.test.ts` — Existing storage tests. Follow same assertion patterns.
  - `tests/setup.ts` — Global test setup. Add `import 'fake-indexeddb/auto'` here.

  **External References**:
  - `idb` library: https://github.com/jakearchibald/idb — `openDB`, `IDBPDatabase` types, upgrade pattern
  - `fake-indexeddb`: https://github.com/nicolo-ribaudo/fake-indexeddb — `import 'fake-indexeddb/auto'` polyfills global `indexedDB`

  **WHY Each Reference Matters**:
  - `storage.ts` API surface is the contract consumers depend on — new module must be a drop-in replacement
  - `Snapshot` type is the core data unit — must be stored/retrieved identically
  - `fake-indexeddb` is critical for test environment — IndexedDB not available in Node.js by default
  - `idb` provides the thin wrapper that makes IndexedDB usable with async/await

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `tests/idb-storage.test.ts`
  - [ ] `pnpm vitest run tests/idb-storage.test.ts` → PASS (all tests green)
  - [ ] Existing tests unaffected: `pnpm vitest run` → 0 regressions

  **QA Scenarios:**

  ```
  Scenario: Snapshots stored and retrieved correctly
    Tool: Bash (pnpm vitest run)
    Preconditions: fake-indexeddb polyfill active
    Steps:
      1. Call idbSaveSnapshot("123", { ts: 1000, current: 500 })
      2. Call idbSaveSnapshot("123", { ts: 2000, current: 600 })
      3. Call idbGetSnapshots("123")
      4. Assert result is [{ ts: 1000, current: 500 }, { ts: 2000, current: 600 }] (sorted by ts)
    Expected Result: Both snapshots returned in chronological order
    Failure Indicators: Missing snapshots, wrong order, or IDB errors
    Evidence: .sisyphus/evidence/task-3-snapshots.txt

  Scenario: Range query returns filtered snapshots
    Tool: Bash (pnpm vitest run)
    Preconditions: 10 snapshots stored spanning 10 hours
    Steps:
      1. Store 10 snapshots at ts 1000, 2000, ..., 10000
      2. Call idbGetSnapshotsInRange("123", 3000, 7000)
      3. Assert result contains exactly snapshots with ts 3000-7000
    Expected Result: 5 snapshots returned (3000, 4000, 5000, 6000, 7000)
    Failure Indicators: Wrong count or boundary errors
    Evidence: .sisyphus/evidence/task-3-range-query.txt

  Scenario: Different appIds are isolated
    Tool: Bash (pnpm vitest run)
    Preconditions: Snapshots stored for appId "100" and "200"
    Steps:
      1. Store 3 snapshots for appId "100"
      2. Store 2 snapshots for appId "200"
      3. Call idbGetSnapshots("100")
      4. Assert result.length === 3
    Expected Result: Only app "100" snapshots returned
    Failure Indicators: Snapshots from app "200" leaked
    Evidence: .sisyphus/evidence/task-3-isolation.txt
  ```

  **Commit**: YES
  - Message: `feat(storage): add IndexedDB storage layer via idb`
  - Files: `src/utils/idb-storage.ts`, `src/types/index.ts` (PriceRecord type), `tests/idb-storage.test.ts`, `tests/setup.ts`, `package.json`
  - Pre-commit: `pnpm vitest run`

- [x] 4. ITAD API client module (itad-api.ts)

  **What to do**:
  - RED: Write tests in `tests/itad-api.test.ts`:
    - Test `lookupItadGame(steamAppId)` with mocked fetch → returns ITAD UUID
    - Test `lookupItadGame` with unknown game → returns null
    - Test `fetchPriceHistory(itadUuid, shop?)` → returns array of PriceRecord[]
    - Test `fetchPriceHistory` with empty result → returns []
    - Test `fetchHistoricalLow(itadUuids[])` → returns map of uuid→{price, timestamp}
    - Test Zod validation rejects malformed responses gracefully (returns null/[])
    - Test API key is injected from `import.meta.env.VITE_ITAD_KEY`
    - Test 429 rate limit response triggers appropriate error (no retry in this module — caller handles)
  - GREEN: Create `src/utils/itad-api.ts`:
    - Define Zod schemas for each ITAD endpoint response:
      - `ItadLookupSchema` — validates `{ found: boolean, game?: { id: string, slug: string } }`
      - `ItadPriceHistorySchema` — validates array of `{ timestamp: string, deal: { price: { amountInt: number }, regular: { amountInt: number }, cut: number } }`
      - `ItadHistoryLowSchema` — validates array of `{ id: string, low: { price: { amountInt: number }, cut: number, timestamp: string } }`
    - `lookupItadGame(steamAppId: string): Promise<string | null>` — GET `/games/lookup/v1?appid={id}&key={key}`
    - `fetchPriceHistory(itadUuid: string, shops?: number[]): Promise<PriceRecord[]>` — GET `/games/prices/history/v2?id={uuid}&shops[]={shop}&key={key}`. Default shop=61 (Steam)
    - `fetchHistoricalLow(itadUuids: string[]): Promise<Map<string, { amountInt: number; cut: number; timestamp: string }>>` — POST `/games/prices/historyLow/v1?key={key}` with body `[uuid1, uuid2, ...]`
    - API key: `const ITAD_KEY = import.meta.env.VITE_ITAD_KEY as string`
    - Follow existing `api.ts` pattern: Zod schema → `safeParse()` → return null/fallback on failure
    - Use `amountInt` (integer cents) for all price values — NEVER floats
  - REFACTOR: Ensure all exported functions have consistent error handling

  **Must NOT do**:
  - Do NOT add caching logic in this module (caching is in Task 8 background integration)
  - Do NOT add retry/backoff logic — keep module focused on HTTP + validation
  - Do NOT create wrapper types — use Zod-inferred types directly (`z.infer<typeof Schema>`)
  - Do NOT store the API key in chrome.storage or IndexedDB

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: API integration with Zod validation, multiple endpoints, careful error handling. Needs attention to ITAD API specifics.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Task 8
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/utils/api.ts:53-65` — Existing Zod validation pattern: define schema, `safeParse()`, return null on failure. FOLLOW THIS EXACTLY for ITAD fetchers.
  - `src/utils/api.ts:fetchPriceData()` — Example of price-related API call with error handling. Similar structure for ITAD.
  - `src/utils/api.ts:searchGames()` — Example of Steam Store API call with Zod validation.

  **API/Type References**:
  - ITAD API v2 docs: `GET /games/lookup/v1?appid=<steam_appid>&key=<key>` → `{ found: boolean, game?: { id, slug } }`
  - ITAD API v2 docs: `GET /games/prices/history/v2?id=<uuid>&shops[]=61&key=<key>` → `[{ timestamp, deal: { price, regular, cut } }]`
  - ITAD API v2 docs: `POST /games/prices/historyLow/v1?key=<key>` body: `["uuid1"]` → `[{ id, low: { price, cut, timestamp } }]`
  - ITAD uses `amountInt` for integer cents — e.g., $9.99 = 999
  - `src/types/index.ts:PriceRecord` (created in Task 3) — reuse for storing fetched history

  **Test References**:
  - `tests/api.test.ts` — Existing API tests with mocked fetch. Follow same vi.fn() mock pattern.

  **WHY Each Reference Matters**:
  - `api.ts` pattern is the established convention — ITAD module must be consistent
  - Zod schemas prevent runtime crashes from unexpected API responses
  - `amountInt` is crucial — ITAD returns both `amount` (float) and `amountInt` (integer cents). Always use `amountInt`.
  - Mock fetch pattern from existing tests ensures ITAD tests work without network

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `tests/itad-api.test.ts`
  - [ ] `pnpm vitest run tests/itad-api.test.ts` → PASS
  - [ ] All mocked fetch tests pass without network access

  **QA Scenarios:**

  ```
  Scenario: Lookup returns UUID for known Steam game
    Tool: Bash (pnpm vitest run)
    Preconditions: fetch mocked to return { found: true, game: { id: "uuid-123", slug: "test" } }
    Steps:
      1. Call lookupItadGame("413150")
      2. Assert returns "uuid-123"
    Expected Result: ITAD UUID string returned
    Failure Indicators: null returned or Zod validation error
    Evidence: .sisyphus/evidence/task-4-lookup.txt

  Scenario: Malformed API response handled gracefully
    Tool: Bash (pnpm vitest run)
    Preconditions: fetch mocked to return { invalid: "data" }
    Steps:
      1. Call lookupItadGame("999999")
      2. Assert returns null (Zod safeParse fails gracefully)
    Expected Result: null returned, no error thrown
    Failure Indicators: Unhandled exception or crash
    Evidence: .sisyphus/evidence/task-4-malformed.txt

  Scenario: Price history returns PriceRecord array
    Tool: Bash (pnpm vitest run)
    Preconditions: fetch mocked with realistic ITAD history response
    Steps:
      1. Call fetchPriceHistory("uuid-123")
      2. Assert result is array of PriceRecord with amountInt values (integer cents)
      3. Assert timestamps are valid ISO strings
    Expected Result: Correctly parsed PriceRecord[]
    Failure Indicators: Float prices instead of integer cents, or missing records
    Evidence: .sisyphus/evidence/task-4-history.txt
  ```

  **Commit**: YES
  - Message: `feat(api): add ITAD API client with Zod validation`
  - Files: `src/utils/itad-api.ts`, `tests/itad-api.test.ts`
  - Pre-commit: `pnpm vitest run`

- [x] 5. Build config + manifest + env setup

  **What to do**:
  - Create `.env.example` file with: `VITE_ITAD_KEY=your_itad_api_key_here`
  - Create `.env` file (add to `.gitignore` if not already) with the actual ITAD API key
  - Update `vite.config.ts`: Vite automatically exposes `VITE_`-prefixed env vars via `import.meta.env`. Verify this works — may need to add `envPrefix: 'VITE_'` if not default.
  - Update `manifest.json`:
    - Add `"unlimitedStorage"` to `permissions` array
    - Add `"https://api.isthereanydeal.com/*"` to `host_permissions` array
  - Verify `pnpm build` succeeds with new config
  - Add TypeScript declaration for `import.meta.env.VITE_ITAD_KEY` if needed (in `src/env.d.ts` or `vite-env.d.ts`)

  **Must NOT do**:
  - Do NOT commit the actual `.env` file with the real API key
  - Do NOT store the API key in chrome.storage or any runtime-accessible location
  - Do NOT modify any other build settings beyond env vars and manifest

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Config file changes only. No logic, just plumbing.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Tasks 8, 14
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `vite.config.ts` — Current build config. Uses `vite-plugin-web-extension`. Add env handling if needed.
  - `manifest.json` — Current permissions: `["storage", "alarms", "notifications"]`. Add to this list.

  **External References**:
  - Vite env docs: Vite exposes `VITE_`-prefixed vars from `.env` files via `import.meta.env`
  - Chrome MV3 `unlimitedStorage`: Allows chrome.storage.local and IndexedDB to exceed 10MB quota
  - Chrome MV3 `host_permissions`: Required for cross-origin fetch to ITAD API

  **WHY Each Reference Matters**:
  - Without `unlimitedStorage`, Chrome may silently evict IndexedDB data at 10MB
  - Without ITAD `host_permissions`, fetch to `api.isthereanydeal.com` will fail with CORS errors
  - `.env.example` documents required configuration for other developers

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Build succeeds with new manifest permissions
    Tool: Bash (pnpm build)
    Preconditions: .env file exists with VITE_ITAD_KEY
    Steps:
      1. Run `pnpm build`
      2. Check dist/manifest.json contains "unlimitedStorage" in permissions
      3. Check dist/manifest.json contains "https://api.isthereanydeal.com/*" in host_permissions
    Expected Result: Build succeeds, manifest correct
    Failure Indicators: Build failure or missing permissions
    Evidence: .sisyphus/evidence/task-5-build.txt

  Scenario: .env.example exists, .env is gitignored
    Tool: Bash
    Preconditions: Files created
    Steps:
      1. Check .env.example exists and contains VITE_ITAD_KEY placeholder
      2. Check .gitignore contains .env (or .env is not tracked)
    Expected Result: Template exists, real key is not committed
    Failure Indicators: .env tracked in git or .env.example missing
    Evidence: .sisyphus/evidence/task-5-env.txt
  ```

  **Commit**: YES
  - Message: `chore(config): add ITAD env vars, manifest permissions`
  - Files: `vite.config.ts`, `manifest.json`, `.env.example`, `.gitignore`
  - Pre-commit: `pnpm build`

- [x] 6. Storage migration logic (chrome.storage.local → IndexedDB)

  **What to do**:
  - RED: Write tests in `tests/migrate.test.ts`:
    - Test migration reads all `sw_snaps_{appid}` keys from chrome.storage.local
    - Test migration writes all snapshots to IndexedDB via idbSaveSnapshot
    - Test migration sets a sentinel flag `sw_migration_complete: true` in chrome.storage.local
    - Test migration skips if sentinel flag already present (idempotent)
    - Test migration preserves all snapshot data exactly (timestamp + current values)
    - Test migration does NOT delete chrome.storage.local data until verification passes
    - Test migration handles empty snapshot arrays gracefully
    - Test migration handles corrupted/invalid snapshot data gracefully (skip bad records, continue)
  - GREEN: Create `src/utils/migrate.ts`:
    - `migrateToIndexedDB(): Promise<{ migrated: number; skipped: number; errors: number }>`
    - Steps:
      1. Check sentinel: `await chrome.storage.local.get('sw_migration_complete')` → if true, return early
      2. Read game list: `await chrome.storage.local.get('sw_games')` → get list of appIds
      3. For each game, read `sw_snaps_{appId}` from chrome.storage.local
      4. Write each snapshot to IndexedDB via `idbSaveSnapshot()`
      5. Verify: for each game, `idbGetSnapshots(appId)` count matches source count
      6. If verification passes: set sentinel `sw_migration_complete: true`
      7. If verification fails: log error, do NOT set sentinel (will retry next startup)
      8. Do NOT delete chrome.storage.local snapshot data — keep as backup
    - Return stats object for logging
  - REFACTOR: Ensure migration is safe to call multiple times (idempotent)

  **Must NOT do**:
  - Do NOT delete chrome.storage.local data after migration — keep as backup forever
  - Do NOT run migration in a single giant transaction — batch per game
  - Do NOT block extension startup on migration — run async after basic init

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Data migration is high-risk. Needs careful verification, error handling, idempotency.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential within Wave 2)
  - **Parallel Group**: Wave 2 (after Task 3 completes)
  - **Blocks**: Task 7
  - **Blocked By**: Task 3 (needs idb-storage.ts)

  **References**:

  **Pattern References**:
  - `src/utils/storage.ts:getSnapshotsForGame()` — How current snapshots are read from chrome.storage.local
  - `src/utils/storage.ts:getGames()` — How game list is retrieved
  - `src/utils/idb-storage.ts:idbSaveSnapshot()` (from Task 3) — Target write function

  **API/Type References**:
  - `src/types/index.ts:Game` — Has `appid: string` field used as key
  - `src/types/index.ts:Snapshot` — `{ ts: number; current: number }` — the data being migrated
  - Chrome storage key pattern: `sw_snaps_{appid}` — e.g., `sw_snaps_413150`

  **WHY Each Reference Matters**:
  - Must read from exact same keys that current storage.ts uses
  - Must write in format compatible with idb-storage.ts from Task 3
  - Sentinel flag pattern prevents double-migration on subsequent startups

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `tests/migrate.test.ts`
  - [ ] `pnpm vitest run tests/migrate.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: Migration transfers all snapshots correctly
    Tool: Bash (pnpm vitest run)
    Preconditions: chrome.storage.local mock has sw_games=[{appid:"100"}] and sw_snaps_100=[snap1, snap2, snap3]
    Steps:
      1. Call migrateToIndexedDB()
      2. Assert idbGetSnapshots("100") returns [snap1, snap2, snap3]
      3. Assert return value is { migrated: 3, skipped: 0, errors: 0 }
    Expected Result: All 3 snapshots in IndexedDB
    Failure Indicators: Missing snapshots or incorrect count
    Evidence: .sisyphus/evidence/task-6-migration.txt

  Scenario: Migration is idempotent
    Tool: Bash (pnpm vitest run)
    Preconditions: Run migration once (sentinel set)
    Steps:
      1. Call migrateToIndexedDB() a second time
      2. Assert returns early with { migrated: 0, skipped: 0, errors: 0 }
      3. Assert no duplicate records in IndexedDB
    Expected Result: Early return, no duplicates
    Failure Indicators: Duplicate snapshots or re-migration
    Evidence: .sisyphus/evidence/task-6-idempotent.txt

  Scenario: Corrupted data skipped gracefully
    Tool: Bash (pnpm vitest run)
    Preconditions: sw_snaps_100 contains [validSnap, {invalid: "data"}, validSnap2]
    Steps:
      1. Call migrateToIndexedDB()
      2. Assert 2 migrated, 0 skipped, 1 error
      3. Assert valid snapshots are in IndexedDB
    Expected Result: Bad record skipped, good records migrated
    Failure Indicators: Migration aborts entirely or bad record stored
    Evidence: .sisyphus/evidence/task-6-corrupted.txt
  ```

  **Commit**: YES
  - Message: `feat(storage): add chrome.storage.local → IndexedDB migration`
  - Files: `src/utils/migrate.ts`, `tests/migrate.test.ts`
  - Pre-commit: `pnpm vitest run`

- [x] 7. Storage switchover — all consumers use IndexedDB

  **What to do**:
  - Use `lsp_find_references` on `getSnapshotsForGame` to find ALL consumers
  - Use `lsp_find_references` on `getCache`, `setCache`, `getSettings`, `setSettings` to map the full dependency graph
  - Update `src/background/index.ts`:
    - Import from `idb-storage.ts` instead of `storage.ts` for snapshot operations
    - Call `migrateToIndexedDB()` on service worker startup (before first fetch cycle)
    - Use `idbSaveSnapshot()` instead of old chrome.storage.local write
    - Use `idbGetSnapshots()` / `idbGetSnapshotsInRange()` for reading snapshots
    - Keep `chrome.storage.local` for: `sw_games`, `sw_cache`, `sw_settings`, `sw_gs_{appid}`, `sw_last_fetch` (these are NOT migrated — they're small key-value data)
  - Update `src/background/fetchCycle.ts`:
    - Use IndexedDB for snapshot read/write operations
  - Update `src/popup/main.ts`:
    - Use `idbGetSnapshotsInRange()` for fetching snapshots within selected time window
    - This enables efficient range queries instead of loading all snapshots and filtering in memory
  - Update `src/utils/card.ts`:
    - If it reads snapshots directly, switch to IndexedDB source
  - Update `manifest.json`: Ensure `unlimitedStorage` is present (should be from Task 5)
  - Remove snapshot purge logic from old storage (purge is now compaction in Task 15)
  - Run `lsp_diagnostics` on `src/` with extension `.ts` to verify no type errors after switchover

  **Must NOT do**:
  - Do NOT remove `storage.ts` — it's still used for games, cache, settings, game-settings
  - Do NOT migrate `sw_cache`, `sw_settings`, `sw_games` to IndexedDB — they're small key-value data, chrome.storage.local is fine
  - Do NOT touch notification/badge/share/export systems beyond changing snapshot read source
  - Do NOT refactor existing test files — only update imports where needed

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Cross-cutting change touching multiple files. Needs careful reference tracking.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential — depends on 3 + 6)
  - **Parallel Group**: Wave 2 (sequential after Task 6)
  - **Blocks**: Tasks 8, 10, 11, 12, 15
  - **Blocked By**: Tasks 3, 6

  **References**:

  **Pattern References**:
  - `src/utils/storage.ts:getSnapshotsForGame()` — Every call site needs to switch to `idbGetSnapshots()` or `idbGetSnapshotsInRange()`
  - `src/utils/storage.ts:purgeSnapshotsForGame()` — This function becomes obsolete for snapshot purge (compaction replaces it in Task 15)
  - `src/background/index.ts:~line 100-120` — Where snapshots are written during fetch cycle
  - `src/background/fetchCycle.ts:~line 30-60` — Where snapshots are read for cache building

  **API/Type References**:
  - `src/utils/idb-storage.ts` (from Task 3) — New API to use
  - `src/utils/migrate.ts` (from Task 6) — Call `migrateToIndexedDB()` on startup

  **Tool Recommendations**:
  - `lsp_find_references` on `getSnapshotsForGame` in `storage.ts` — find ALL consumers
  - `lsp_find_references` on `purgeSnapshotsForGame` — find where purge is called (to remove/replace)
  - `lsp_diagnostics` on `src/` after changes — catch type mismatches

  **WHY Each Reference Matters**:
  - Every consumer of `getSnapshotsForGame` must be updated — missing one means stale data
  - `purgeSnapshotsForGame` call sites must be identified to replace with compaction
  - Migration must be called BEFORE first fetch cycle in background worker

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Background worker uses IndexedDB for snapshots
    Tool: Bash (pnpm vitest run)
    Preconditions: All consumer files updated
    Steps:
      1. Run `pnpm vitest run` — all tests pass
      2. Run `pnpm build` — clean build
      3. Grep for "getSnapshotsForGame" in background/ and popup/ — should not import from storage.ts
    Expected Result: No direct chrome.storage.local usage for snapshots in background/popup
    Failure Indicators: Old storage.ts imports for snapshot operations remain
    Evidence: .sisyphus/evidence/task-7-switchover.txt

  Scenario: Build succeeds after switchover
    Tool: Bash (pnpm build)
    Preconditions: All imports updated
    Steps:
      1. Run `pnpm build`
      2. Assert exit code 0, no TypeScript errors
    Expected Result: Clean build
    Failure Indicators: Type errors from mismatched signatures
    Evidence: .sisyphus/evidence/task-7-build.txt

  Scenario: chrome.storage.local still used for settings/cache/games
    Tool: Bash (grep)
    Preconditions: Switchover complete
    Steps:
      1. Verify storage.ts still exports getGames, getCache, getSettings, etc.
      2. Verify these are still used in background/ and popup/ for non-snapshot data
    Expected Result: storage.ts retained for small key-value data
    Failure Indicators: storage.ts completely removed or settings migrated
    Evidence: .sisyphus/evidence/task-7-settings-intact.txt
  ```

  **Commit**: YES
  - Message: `refactor(storage): switch all consumers to IndexedDB for snapshots`
  - Files: `src/background/index.ts`, `src/background/fetchCycle.ts`, `src/popup/main.ts`, `src/utils/card.ts`
  - Pre-commit: `pnpm vitest run && pnpm build`

- [x] 8. ITAD data integration in background worker

  **What to do**:
  - Update `src/background/index.ts` fetch cycle to include ITAD data:
    - **On game add** (or first encounter without ITAD mapping): Call `lookupItadGame(appId)` → store mapping via `idbSaveItadMapping()`
    - **Background cycle** (every fetch): For each game with ITAD UUID, call `fetchHistoricalLow([uuid])` → update cached data with `itadHistoricalLow`
    - **On-demand** (panel expand — handled in popup, but data must be available): Price history is fetched lazily, NOT in background cycle
  - Update `src/background/fetchCycle.ts`:
    - Extend `BuildCachedDataInput` to include `itadHistoricalLow?: { amountInt: number; cut: number; timestamp: string }`
    - Extend `CachedData` type to include `itadHistoricalLow` and `itadUuid` fields
  - Add ITAD cache management:
    - Store ITAD UUID mapping permanently in IndexedDB (appId→UUID never changes)
    - `historyLow` is lightweight — fetch every cycle (it's a single POST for all games)
    - Full price history: NOT fetched in background. Fetched on-demand in popup when panel opens. Cache in IndexedDB with 24h TTL.
  - Add to popup's panel expand handler: When panel opens, check if price history is cached in IndexedDB (< 24h old). If not, fetch from ITAD and cache.
  - Handle games not found on ITAD gracefully: set `itadUuid: null` in mapping, skip price fetches for those games

  **Must NOT do**:
  - Do NOT fetch full price history on every background cycle — only historyLow (lightweight)
  - Do NOT block the existing fetch cycle if ITAD is slow — run ITAD fetches in parallel with Steam fetches
  - Do NOT crash if ITAD API is down — all ITAD data is optional enrichment

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration task touching background worker, fetch cycle, and types. Multiple async operations.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs Tasks 4, 5, 7)
  - **Parallel Group**: Wave 2 (after Tasks 4, 5, 7)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 4, 5, 7

  **References**:

  **Pattern References**:
  - `src/background/index.ts:runFetchCycle()` — Main fetch loop. Add ITAD fetch here, parallel with existing Steam fetches.
  - `src/background/fetchCycle.ts:buildCachedData()` — Cache builder. Extend with ITAD fields.
  - `src/utils/api.ts:fetchPriceData()` — Existing price fetch. ITAD enriches this with historical data.

  **API/Type References**:
  - `src/utils/itad-api.ts` (from Task 4) — `lookupItadGame()`, `fetchHistoricalLow()`, `fetchPriceHistory()`
  - `src/utils/idb-storage.ts` (from Task 3) — `idbSaveItadMapping()`, `idbGetItadMapping()`, `idbSavePriceHistory()`, `idbGetPriceHistory()`
  - `src/types/index.ts:CachedData` — Extend with `itadUuid?: string`, `itadHistoricalLow?: { amountInt: number; cut: number; timestamp: string }`

  **WHY Each Reference Matters**:
  - `runFetchCycle()` is where ITAD calls must be inserted — parallel with Steam, not blocking
  - `CachedData` is the popup's read source — ITAD data must be there for popup to display it
  - Mapping is permanent (appId→UUID doesn't change), historyLow is refreshed each cycle, full history is on-demand

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Tests updated for fetchCycle with ITAD integration
  - [ ] `pnpm vitest run` → PASS

  **QA Scenarios:**

  ```
  Scenario: ITAD UUID lookup on game add
    Tool: Bash (pnpm vitest run)
    Preconditions: ITAD API mocked, game "413150" added
    Steps:
      1. Simulate game add flow
      2. Assert lookupItadGame("413150") is called
      3. Assert idbSaveItadMapping("413150", "uuid-xyz") is called
    Expected Result: ITAD UUID persisted in IndexedDB
    Failure Indicators: No mapping stored or lookup not triggered
    Evidence: .sisyphus/evidence/task-8-lookup.txt

  Scenario: Historical low fetched in background cycle
    Tool: Bash (pnpm vitest run)
    Preconditions: Game has ITAD mapping, fetch cycle runs
    Steps:
      1. Run fetch cycle
      2. Assert fetchHistoricalLow called with game's ITAD UUID
      3. Assert CachedData updated with itadHistoricalLow
    Expected Result: Historical low price in cache
    Failure Indicators: Missing from CachedData or not fetched
    Evidence: .sisyphus/evidence/task-8-historical-low.txt

  Scenario: ITAD failure doesn't crash fetch cycle
    Tool: Bash (pnpm vitest run)
    Preconditions: ITAD API returns 500 error
    Steps:
      1. Run fetch cycle with ITAD mock returning error
      2. Assert Steam data still fetched and cached successfully
      3. Assert itadHistoricalLow is undefined/null in cache
    Expected Result: Graceful degradation, Steam data unaffected
    Failure Indicators: Entire fetch cycle fails or crashes
    Evidence: .sisyphus/evidence/task-8-itad-failure.txt
  ```

  **Commit**: YES
  - Message: `feat(background): integrate ITAD data fetching (hybrid strategy)`
  - Files: `src/background/index.ts`, `src/background/fetchCycle.ts`, `src/types/index.ts`
  - Pre-commit: `pnpm vitest run`

- [x] 9. Extend CardViewModel with record lows + ITAD data

  **What to do**:
  - RED: Write tests in `tests/card.test.ts` (add new describe block):
    - Test `buildCardViewModel()` includes `recordLow: { value: number; timestamp: number } | null` for the active time window
    - Test `buildCardViewModel()` includes `allTimeLow: { value: number; timestamp: number } | null` (always computed from all snapshots)
    - Test `buildCardViewModel()` includes `itadHistoricalLow?: { amountInt: number; cut: number; timestamp: string }` from CachedData
    - Test `buildCardViewModel()` includes `itadUuid?: string` from CachedData
    - Test record low is computed from snapshots within the active window using `computeWindowMin()`
    - Test all-time low is computed from ALL snapshots (unfiltered)
    - Test with empty snapshots → recordLow: null, allTimeLow: null
  - GREEN: Update `src/types/index.ts`:
    - Add to `CardViewModel`: `recordLow: { value: number; timestamp: number } | null`
    - Add to `CardViewModel`: `allTimeLow: { value: number; timestamp: number } | null`
    - Add to `CardViewModel`: `itadHistoricalLow?: { amountInt: number; cut: number; timestamp: string }`
    - Add to `CardViewModel`: `itadUuid?: string`
    - Add to `CardViewModel`: `priceSparklineSvg?: string` (placeholder — populated in Task 12)
  - GREEN: Update `src/utils/card.ts`:
    - Import `computeWindowMin` from `trend.ts`
    - Compute `recordLow` by filtering snapshots to active window, then calling `computeWindowMin()`
    - Compute `allTimeLow` by calling `computeWindowMin()` on ALL snapshots
    - Pass through `itadHistoricalLow` and `itadUuid` from CachedData
  - REFACTOR: Ensure CardViewModel remains a pure factory function (no side effects)

  **Must NOT do**:
  - Do NOT compute price sparkline SVG here (Task 12)
  - Do NOT add UI rendering (Tasks 10-13)
  - Do NOT add lazy ITAD price history fetching here (that's popup-level logic)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Extending an existing pure factory function with new computed fields. Well-defined inputs and outputs.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7, 8 if dependencies met)
  - **Parallel Group**: Wave 2 (needs Tasks 1, 2)
  - **Blocks**: Tasks 10, 11, 12, 13
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `src/utils/card.ts:buildCardViewModel()` — The factory function to extend. Currently ~60 lines. Follow same pattern for new fields.
  - `src/utils/card.ts:40-96` — Shows how existing fields are computed from snapshots + CachedData

  **API/Type References**:
  - `src/types/index.ts:CardViewModel` — The interface to extend with new fields
  - `src/types/index.ts:CachedData` — Source of ITAD data (itadHistoricalLow, itadUuid)
  - `src/utils/trend.ts:computeWindowMin()` (from Task 2) — Used for record low computation

  **Test References**:
  - `tests/card.test.ts` — Existing CardViewModel tests. Add new describe block for record lows + ITAD fields

  **WHY Each Reference Matters**:
  - `buildCardViewModel()` is the SINGLE boundary between data and UI — all display data must flow through it
  - `computeWindowMin()` provides the pure computation — CardViewModel just calls it with the right snapshots
  - CachedData carries ITAD fields from background worker — CardViewModel passes them through

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Tests added to `tests/card.test.ts`
  - [ ] `pnpm vitest run tests/card.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: Record low computed for active window
    Tool: Bash (pnpm vitest run)
    Preconditions: 24h of snapshots with min at ts=5000 value=42
    Steps:
      1. Call buildCardViewModel with active window "24h"
      2. Assert vm.recordLow === { value: 42, timestamp: 5000 }
    Expected Result: Correct min player count for window
    Failure Indicators: Wrong value or null when data exists
    Evidence: .sisyphus/evidence/task-9-record-low.txt

  Scenario: All-time low independent of active window
    Tool: Bash (pnpm vitest run)
    Preconditions: 30 days of snapshots, absolute min is 15 days ago
    Steps:
      1. Call buildCardViewModel with active window "24h"
      2. Assert vm.allTimeLow points to the 15-day-old minimum
    Expected Result: All-time low is from 15 days ago, not limited to 24h window
    Failure Indicators: All-time low matches 24h window low instead
    Evidence: .sisyphus/evidence/task-9-alltime-low.txt
  ```

  **Commit**: YES
  - Message: `feat(card): extend CardViewModel with record lows and ITAD data`
  - Files: `src/types/index.ts`, `src/utils/card.ts`, `tests/card.test.ts`
  - Pre-commit: `pnpm vitest run`

- [x] 10. Replace 3 graph tabs with 6 time filter pill buttons

  **What to do**:
  - Update `src/popup/main.ts`:
    - Find where current 3 graph window tabs are rendered (search for `graph-tab` or `buildAvailableGraphWindows`)
    - Replace with 6 pill buttons: `24h`, `3d`, `7d`, `15d`, `1m`, `All`
    - Each pill is a `<button>` with class `.graph-pill` and `data-window="24h"` etc.
    - Active pill gets `.graph-pill--active` class
    - Click handler: update active pill styling, re-filter snapshots from IndexedDB using `idbGetSnapshotsInRange()`, re-render sparkline, update record low display
    - Disable pills for windows with insufficient data (< 6 snapshots in that range) — add `.graph-pill--disabled` class
    - "All" pill is always enabled if there's any data at all
  - Update `src/popup/popup.css`:
    - `.graph-pill` — small pill button style: rounded corners, compact padding, font-size ~11px
    - `.graph-pill--active` — highlighted state (use existing accent color from design tokens)
    - `.graph-pill--disabled` — muted/grayed out, cursor: not-allowed
    - Ensure 6 pills fit within the 372px panel width (use flex-wrap if needed, or very compact sizing)
  - Remove old 3-tab rendering code and replace with new 6-pill approach

  **Must NOT do**:
  - Do NOT use a dropdown — user chose pill buttons
  - Do NOT add animation/transitions to pill switching (keep it snappy)
  - Do NOT change the sparkline rendering logic (that stays in sparkline.ts)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: DOM rendering + CSS styling for interactive pill buttons. Needs visual attention.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11, 12, 14)
  - **Blocks**: Task 13
  - **Blocked By**: Tasks 1, 7, 9

  **References**:

  **Pattern References**:
  - `src/popup/main.ts` — Search for graph tab rendering (likely around panel expand logic). Look for `graphWindows`, `graph-tab`, or `window-btn` class names
  - `src/popup/popup.css` — Existing button/tab styles to follow for consistency
  - `src/popup/popup.css` — Design tokens (CSS custom properties like `--accent`, `--bg-card`, etc.)

  **API/Type References**:
  - `src/types/index.ts:GraphWindowKey` (updated in Task 1) — 6 valid values
  - `src/utils/sparkline.ts:buildAvailableGraphWindows()` — Returns which windows have enough data
  - `src/utils/idb-storage.ts:idbGetSnapshotsInRange()` — Efficient range query for selected window

  **WHY Each Reference Matters**:
  - Must replace existing tab rendering code, not add alongside it
  - Design tokens ensure pills match existing extension aesthetic
  - `buildAvailableGraphWindows()` tells which pills should be enabled/disabled

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: 6 pill buttons render in expanded panel
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, game added, panel expanded
    Steps:
      1. Open extension popup
      2. Click expand button on a game card
      3. Assert 6 elements matching `.graph-pill` selector exist
      4. Assert text content is ["24h", "3d", "7d", "15d", "1m", "All"]
      5. Screenshot the panel
    Expected Result: 6 pills visible in correct order
    Failure Indicators: Fewer than 6 pills, wrong labels, pills overflow container
    Evidence: .sisyphus/evidence/task-10-pills-render.png

  Scenario: Clicking a pill updates the chart
    Tool: Playwright (playwright skill)
    Preconditions: Panel expanded with data for multiple windows
    Steps:
      1. Click "7d" pill button (`.graph-pill[data-window="7d"]`)
      2. Assert "7d" pill has class `.graph-pill--active`
      3. Assert other pills do NOT have `.graph-pill--active`
      4. Assert sparkline SVG in panel has been re-rendered (SVG content changed)
    Expected Result: Active pill highlighted, chart updated
    Failure Indicators: Multiple active pills, chart unchanged
    Evidence: .sisyphus/evidence/task-10-pill-switch.png

  Scenario: Insufficient data pills are disabled
    Tool: Playwright (playwright skill)
    Preconditions: Only 2 hours of data (only 24h should be enabled)
    Steps:
      1. Expand panel
      2. Assert "24h" pill is enabled (no `.graph-pill--disabled`)
      3. Assert "7d", "15d", "1m" pills have `.graph-pill--disabled` class
      4. Click disabled pill — nothing happens
    Expected Result: Only pills with enough data are clickable
    Failure Indicators: Disabled pills are clickable or all pills enabled
    Evidence: .sisyphus/evidence/task-10-disabled-pills.png
  ```

  **Commit**: YES
  - Message: `feat(ui): replace 3 graph tabs with 6 time filter pills`
  - Files: `src/popup/main.ts`, `src/popup/popup.css`
  - Pre-commit: `pnpm build`

- [x] 11. Interactive hover tooltip on expanded sparklines

  **What to do**:
  - RED: Write tests in `tests/sparkline.test.ts` (new describe block):
    - Test `findNearestPointIndex(mouseX, points[])` → returns index of closest point by x-coordinate
    - Test binary search is used (O(log n) not O(n))
    - Test edge cases: mouseX before first point, mouseX after last point, exact match
  - GREEN: Update `src/utils/sparkline.ts`:
    - Add `findNearestPointIndex(mouseX: number, points: Array<{x: number, y: number}>): number` — binary search for nearest x coordinate
    - Export the mapped points array from `buildSparklineSVG()` (or return it alongside the SVG string) so the popup can use it for hit-testing
    - The function should return both the SVG string AND the point-to-data mapping
  - GREEN: Update `src/popup/main.ts`:
    - After injecting sparkline SVG into panel via innerHTML, query the SVG element
    - Add `mousemove` event listener on the sparkline SVG container
    - On mousemove:
      1. Calculate mouse X position relative to SVG viewport
      2. Call `findNearestPointIndex(relativeX, points)`
      3. Get the original snapshot data for that index (player count)
      4. Show/update tooltip element positioned at the data point
    - Add `mouseleave` event listener to hide tooltip
    - Tooltip is a `<div class="sparkline-tooltip">` positioned absolutely above the SVG
    - Tooltip content: formatted player count only (e.g., "1,234")
    - Add a vertical line indicator at the hovered x position (thin SVG line or CSS pseudo-element)
    - Add a dot/circle at the exact data point being hovered
  - GREEN: Update `src/popup/popup.css`:
    - `.sparkline-tooltip` — small box, dark background, white text, rounded corners, pointer-events: none
    - `.sparkline-hover-line` — thin vertical line (1px, semi-transparent)
    - `.sparkline-hover-dot` — small circle (4px radius) at data point
    - Position tooltip above the hovered point, centered horizontally
    - Ensure tooltip stays within panel bounds (flip if near edge)
  - REFACTOR: Ensure hover is performant (no reflow on every mousemove, use transforms for positioning)

  **Must NOT do**:
  - Do NOT show date/time in tooltip — player count only
  - Do NOT add touch support — mouse-only
  - Do NOT add hover to compact card sparklines — expanded panel only
  - Do NOT use an external tooltip library

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Interactive SVG overlay with precise positioning, CSS styling, and performance considerations.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 12, 14)
  - **Blocks**: None
  - **Blocked By**: Tasks 7, 9

  **References**:

  **Pattern References**:
  - `src/utils/sparkline.ts:buildSparklineSVG()` — Returns SVG string. Must be modified to also return point mapping.
  - `src/utils/sparkline.ts:mapToPoints()` — Converts Snapshot values to SVG coordinates. These coordinates are needed for hit-testing.
  - `src/utils/sparkline.ts:downsampleSnapshotsForGraph()` — 96 points max for expanded panels. This is the hit-test target size.
  - `src/popup/main.ts` — Where SVG is injected via innerHTML. Hover listeners must be added AFTER innerHTML injection.

  **API/Type References**:
  - Points array: `Array<{x: number, y: number}>` — SVG coordinates from mapToPoints()
  - Original snapshots array (downsampled): needed to get player count for tooltip content
  - SVG viewBox dimensions: defined in buildSparklineSVG() — used for coordinate mapping

  **WHY Each Reference Matters**:
  - `mapToPoints()` coordinates are the exact positions in the SVG — reuse for hit-testing
  - 96 max points means binary search is fast but still meaningful over linear scan
  - innerHTML injection means DOM isn't available at SVG build time — listeners added after
  - `downsampleSnapshotsForGraph()` determines which snapshots map to which SVG points

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Tests added for `findNearestPointIndex()` in `tests/sparkline.test.ts`
  - [ ] `pnpm vitest run tests/sparkline.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: Hovering sparkline shows player count tooltip
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, game with 24h+ data, panel expanded
    Steps:
      1. Open popup, expand a game panel
      2. Hover mouse over the middle of the `.panel-sparkline` SVG
      3. Assert `.sparkline-tooltip` element is visible
      4. Assert tooltip contains a number (regex /[\d,]+/)
      5. Assert `.sparkline-hover-dot` element is visible
      6. Screenshot
    Expected Result: Tooltip with player count visible, dot indicator on chart
    Failure Indicators: No tooltip appears, tooltip is empty, or positioned off-screen
    Evidence: .sisyphus/evidence/task-11-hover-tooltip.png

  Scenario: Mouse leave hides tooltip
    Tool: Playwright (playwright skill)
    Preconditions: Tooltip currently visible from previous hover
    Steps:
      1. Move mouse away from sparkline SVG
      2. Assert `.sparkline-tooltip` is hidden (display:none or removed)
      3. Assert `.sparkline-hover-dot` is hidden
    Expected Result: Tooltip and dot disappear
    Failure Indicators: Tooltip stays visible after mouse leaves
    Evidence: .sisyphus/evidence/task-11-hover-hide.png

  Scenario: findNearestPointIndex binary search correctness
    Tool: Bash (pnpm vitest run)
    Preconditions: Points array [0, 10, 20, 30, 40]
    Steps:
      1. Call findNearestPointIndex(15, points)
      2. Assert returns index 1 (x=10) or 2 (x=20) — nearest
      3. Call findNearestPointIndex(-5, points)
      4. Assert returns index 0 (first point)
      5. Call findNearestPointIndex(100, points)
      6. Assert returns index 4 (last point)
    Expected Result: Correct nearest index for all edge cases
    Failure Indicators: Wrong index or out-of-bounds
    Evidence: .sisyphus/evidence/task-11-binary-search.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add interactive hover tooltip on expanded sparklines`
  - Files: `src/utils/sparkline.ts`, `src/popup/main.ts`, `src/popup/popup.css`, `tests/sparkline.test.ts`
  - Pre-commit: `pnpm vitest run`

- [x] 12. Price history sparkline chart (ITAD)

  **What to do**:
  - RED: Write tests in `tests/sparkline.test.ts` (new describe block):
    - Test `buildPriceSparklineSVG(priceRecords[])` returns valid SVG string
    - Test with empty array → returns empty/placeholder SVG or null
    - Test with single record → returns minimal SVG (single point)
    - Test color: price decreases (sales) should be green, increases red (opposite of player count logic)
    - Test price values use `amountInt` (integer cents) for Y axis
  - GREEN: Add `buildPriceSparklineSVG()` to `src/utils/sparkline.ts`:
    - Similar structure to `buildSparklineSVG()` but optimized for price data
    - Input: `PriceRecord[]` (from ITAD, sorted by timestamp)
    - Output: SVG string (same dimensions as player count sparkline for visual consistency)
    - Y axis: price in cents (amountInt). Scale min to max with padding.
    - Color logic: price going DOWN = green (good for buyer), going UP = red
    - Step-like rendering (prices are discrete, not continuous) — use `L` path commands with horizontal + vertical steps, not diagonal lines
    - Same viewBox dimensions as player count sparkline (372×56 for expanded panel)
  - GREEN: Update `src/popup/main.ts`:
    - In panel expand handler, after checking ITAD UUID exists:
      1. Check IndexedDB for cached price history (< 24h old)
      2. If not cached: fetch from ITAD via `fetchPriceHistory(itadUuid)`, cache result
      3. Build price sparkline SVG via `buildPriceSparklineSVG()`
      4. Render in panel below player count sparkline (new `.panel-price-sparkline` div)
    - Add a small label "Price History" above the price sparkline
    - Show "No price data" message if ITAD has no history for this game
    - Add loading state while fetching (simple "Loading price data..." text, NOT a spinner)
  - GREEN: Update `src/popup/popup.css`:
    - `.panel-price-sparkline` — same width as player sparkline, slightly smaller height (e.g., 40px)
    - `.panel-price-label` — small label text style
    - `.panel-price-loading` — loading text style

  **Must NOT do**:
  - Do NOT add hover tooltip to price chart in this task (can be added later if desired)
  - Do NOT fetch price history for all shops — Steam only (shops=61)
  - Do NOT show prices from other stores
  - Do NOT add a spinner — just text "Loading price data..."

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: New SVG chart generation + DOM rendering + CSS styling. Needs visual care.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 14)
  - **Blocks**: None
  - **Blocked By**: Tasks 8, 9

  **References**:

  **Pattern References**:
  - `src/utils/sparkline.ts:buildSparklineSVG()` — Follow same structure but adapt for price data (step chart, inverted color logic)
  - `src/utils/sparkline.ts:mapToPoints()` — Reuse or adapt for price-to-SVG coordinate mapping
  - `src/utils/sparkline.ts:segmentColor()` — Adapt: for prices, DOWN=green, UP=red (opposite of player count)

  **API/Type References**:
  - `src/types/index.ts:PriceRecord` (from Task 3) — `{ appId, timestamp, priceAmountInt, regularAmountInt, cut, shop }`
  - `src/utils/itad-api.ts:fetchPriceHistory()` (from Task 4) — Fetches ITAD price log
  - `src/utils/idb-storage.ts:idbGetPriceHistory()` / `idbSavePriceHistory()` (from Task 3) — Cache layer

  **WHY Each Reference Matters**:
  - `buildSparklineSVG()` is the pattern to follow — same architectural approach, different data
  - Step chart (not smooth line) is correct for prices — price stays flat until it changes
  - `amountInt` is integer cents — must be used for all price calculations (no float math)

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Tests added to `tests/sparkline.test.ts` for price sparkline
  - [ ] `pnpm vitest run tests/sparkline.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: Price sparkline renders in expanded panel
    Tool: Playwright (playwright skill)
    Preconditions: Game with ITAD data, price history available
    Steps:
      1. Open popup, expand a game panel
      2. Wait for price data to load (`.panel-price-loading` disappears)
      3. Assert `.panel-price-sparkline` contains an SVG element
      4. Assert SVG has path elements (the price curve)
      5. Screenshot
    Expected Result: Price sparkline visible below player count sparkline
    Failure Indicators: No SVG rendered, loading text stuck, or empty chart
    Evidence: .sisyphus/evidence/task-12-price-chart.png

  Scenario: No ITAD data shows graceful message
    Tool: Playwright (playwright skill)
    Preconditions: Game NOT found on ITAD (itadUuid is null)
    Steps:
      1. Expand panel for game without ITAD data
      2. Assert price sparkline area shows "No price data" or is hidden
      3. Assert no error in console
    Expected Result: Graceful empty state
    Failure Indicators: Error displayed, broken layout, or console error
    Evidence: .sisyphus/evidence/task-12-no-data.png

  Scenario: Price sparkline SVG is valid
    Tool: Bash (pnpm vitest run)
    Preconditions: Test with 20 price records
    Steps:
      1. Call buildPriceSparklineSVG(records)
      2. Assert result starts with "<svg"
      3. Assert result contains <path elements
      4. Assert viewBox matches expected dimensions
    Expected Result: Valid SVG string
    Failure Indicators: Empty string, invalid SVG, or missing path elements
    Evidence: .sisyphus/evidence/task-12-svg-valid.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add ITAD price history sparkline chart`
  - Files: `src/utils/sparkline.ts`, `src/popup/main.ts`, `src/popup/popup.css`, `tests/sparkline.test.ts`
  - Pre-commit: `pnpm vitest run`

- [x] 13. Record low row in expanded panel

  **What to do**:
  - Update `src/popup/main.ts`:
    - In the panel rendering section, add a new row below the stats area:
    - Row content: `"{Window} Low: {value} • All-time Low: {value}"` where:
      - `{Window}` = active filter label (e.g., "7d", "1m", "All")
      - `{value}` = formatted player count with thousands separator (e.g., "1,234")
    - If recordLow is null (no data for window), show "—" instead of value
    - If allTimeLow is null (no data at all), hide the entire row
    - When user switches filter pill (Task 10), this row updates to show the new window's low
    - Style as a `.panel-record-low` div
  - Update `src/popup/popup.css`:
    - `.panel-record-low` — subdued text, smaller font (~11px), flex row with gap
    - Use existing color tokens for consistency
    - Low values could be in a specific color (e.g., red/orange) to draw attention

  **Must NOT do**:
  - Do NOT add click-to-navigate-to-low-point on the chart (scope creep)
  - Do NOT show timestamp of the low (just the value — keep it clean)
  - Do NOT add record low to compact card view (expanded panel only)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: DOM rendering + CSS styling for a new panel element. Relatively simple but needs visual consistency.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (but needs Task 10 for filter interaction)
  - **Parallel Group**: Wave 3 (after Task 10 in practice)
  - **Blocks**: None
  - **Blocked By**: Tasks 2, 9, 10

  **References**:

  **Pattern References**:
  - `src/popup/main.ts` — Look for existing panel stat rows (24h peak, all-time peak, etc.) — follow same DOM structure
  - `src/popup/popup.css` — Existing stat row styles (`.panel-stat` or similar class names)
  - `src/utils/trend.ts:formatPlayers()` or similar — Number formatting with thousands separator

  **API/Type References**:
  - `src/types/index.ts:CardViewModel` — `recordLow` and `allTimeLow` fields (from Task 9)
  - Active `GraphWindowKey` — determines which window label to show

  **WHY Each Reference Matters**:
  - Existing stat rows in the panel define the visual pattern — record low must match
  - Number formatting must be consistent with existing player count displays
  - CardViewModel is the only data source — never read from storage directly in popup

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Record low row displays correct values
    Tool: Playwright (playwright skill)
    Preconditions: Game with sufficient data, panel expanded, "7d" filter active
    Steps:
      1. Expand panel, select "7d" filter
      2. Assert `.panel-record-low` element exists
      3. Assert text contains "7d Low:" followed by a number
      4. Assert text contains "All-time Low:" followed by a number
      5. Screenshot
    Expected Result: "7d Low: X • All-time Low: Y" visible
    Failure Indicators: Row missing, wrong window label, or NaN values
    Evidence: .sisyphus/evidence/task-13-record-low.png

  Scenario: Record low updates on filter switch
    Tool: Playwright (playwright skill)
    Preconditions: Panel expanded with multiple filter windows having data
    Steps:
      1. Note record low value on "24h" filter
      2. Switch to "7d" filter
      3. Assert record low label changed from "24h Low" to "7d Low"
      4. Assert value may have changed (7d window has more data)
    Expected Result: Label and value update to match active filter
    Failure Indicators: Label doesn't change, or value stays the same when it shouldn't
    Evidence: .sisyphus/evidence/task-13-filter-switch.png

  Scenario: No data shows dash
    Tool: Playwright (playwright skill)
    Preconditions: Game with very little data (< 6 snapshots for 7d window)
    Steps:
      1. Expand panel, try to select "7d" filter (should be disabled or show dash)
      2. Assert record low shows "—" or row is hidden
    Expected Result: Graceful handling of missing data
    Failure Indicators: NaN, undefined, or crash
    Evidence: .sisyphus/evidence/task-13-no-data.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add record low row in expanded panel`
  - Files: `src/popup/main.ts`, `src/popup/popup.css`
  - Pre-commit: `pnpm build`

- [x] 14. About page with ITAD credits and disclaimer

  **What to do**:
  - Update `src/options/index.html`:
    - Add a new tab button "About" in the tab bar (after existing tabs)
    - Add a new content section `#about-section` with:
      - Extension name and version (read from manifest via `chrome.runtime.getManifest()`)
      - "Price data provided by" section with ITAD logo/text + link to `https://isthereanydeal.com`
      - Disclaimer text (from ITAD ToS): "Price data is provided by IsThereAnyDeal. SteamWatch is not affiliated with IsThereAnyDeal."
      - "Data provided as-is. IsThereAnyDeal reserves the right to deny API access at any point."
      - Optional: links to SteamWatch GitHub repo, Steam community
  - Update `src/options/main.ts`:
    - Add tab switching logic for the About tab (follow existing tab pattern)
  - Update `src/options/options.css`:
    - Style the About section: clean, centered, with proper spacing
    - ITAD link should be clearly visible (underlined or button-like)

  **Must NOT do**:
  - Do NOT misrepresent as affiliated with ITAD
  - Do NOT add ITAD affiliate links or modify any URLs
  - Do NOT add changelog, roadmap, or feature request sections (scope creep)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple HTML/CSS addition with minimal JS. Well-defined content.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 12, 13)
  - **Blocks**: None
  - **Blocked By**: Task 5 (needs manifest setup)

  **References**:

  **Pattern References**:
  - `src/options/index.html` — Existing tab structure. Add new tab following same pattern.
  - `src/options/main.ts` — Existing tab switching logic. Follow same event delegation pattern.
  - `src/options/options.css` — Existing section styles to match.

  **WHY Each Reference Matters**:
  - Tab structure must be consistent with existing tabs (Games, Tracking, Notifications, etc.)
  - About section content is dictated by ITAD ToS — must mention ITAD, link to site, not claim affiliation

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: About tab exists and shows ITAD credits
    Tool: Playwright (playwright skill)
    Preconditions: Extension loaded, options page open
    Steps:
      1. Open extension options page
      2. Click "About" tab button
      3. Assert #about-section is visible
      4. Assert text contains "IsThereAnyDeal"
      5. Assert a link to "https://isthereanydeal.com" exists
      6. Assert text contains "not affiliated"
      7. Screenshot
    Expected Result: About section with ITAD credits and disclaimer
    Failure Indicators: Tab missing, ITAD not mentioned, link missing
    Evidence: .sisyphus/evidence/task-14-about.png

  Scenario: About section mentions "as-is" data
    Tool: Playwright (playwright skill)
    Preconditions: About tab visible
    Steps:
      1. Assert text contains "as-is" or equivalent disclaimer
    Expected Result: Disclaimer present per ITAD ToS
    Failure Indicators: Missing disclaimer text
    Evidence: .sisyphus/evidence/task-14-disclaimer.png
  ```

  **Commit**: YES
  - Message: `feat(options): add About page with ITAD credits and disclaimer`
  - Files: `src/options/index.html`, `src/options/main.ts`, `src/options/options.css`
  - Pre-commit: `pnpm build`

- [x] 15. Tiered data compaction for long-term retention

  **What to do**:
  - RED: Write tests in `tests/compaction.test.ts`:
    - Test `compactSnapshots(appId, fullResolutionDays)` aggregates old data correctly
    - Test: snapshots within `fullResolutionDays` window are NOT touched
    - Test: snapshots 30-90 days old → compressed to daily aggregates (one record per day: avg of `current` values, ts = start of day)
    - Test: snapshots 90+ days old → compressed to weekly aggregates (one record per week: avg of `current`, ts = start of week)
    - Test: the all-time minimum snapshot is NEVER deleted (preserved as a special "anchor" record)
    - Test: compaction is idempotent (running twice doesn't change already-compacted data)
    - Test: empty data → no-op
  - GREEN: Add `compactSnapshots()` to `src/utils/idb-storage.ts` (or new `src/utils/compaction.ts`):
    - Input: `appId: string, fullResolutionDays: number` (from repurposed `purgeAfterDays` setting)
    - Steps:
      1. Read all snapshots for appId from IndexedDB
      2. Identify the all-time minimum (preserve it)
      3. Split into tiers: recent (< fullResolutionDays), medium (fullResolutionDays → 90d), old (> 90d)
      4. For medium tier: group by date, compute average `current`, create one summary snapshot per day
      5. For old tier: group by ISO week, compute average `current`, create one summary snapshot per week
      6. Delete original granular records in medium and old tiers
      7. Insert compacted records
      8. Ensure all-time minimum record is present (re-insert if deleted)
  - GREEN: Update `src/background/index.ts`:
    - After fetch cycle completes, run compaction for each game (lightweight — most runs are no-ops)
    - Or better: run compaction via chrome.alarm once per day (not every fetch cycle)
    - Register a `steamwatch-compaction` alarm that fires every 24h
    - Handler calls `compactSnapshots()` for each tracked game
  - Update `src/utils/storage.ts` or settings:
    - Repurpose `purgeAfterDays` → used as `fullResolutionDays` parameter for compaction
    - Default remains 7 days (full resolution for 7 days, daily aggregates 7-90d, weekly 90d+)
    - Optionally update options page label from "Purge after" to "Full detail for" (if touching options UI)

  **Must NOT do**:
  - Do NOT delete the all-time minimum snapshot during compaction
  - Do NOT run compaction synchronously during fetch cycle — use separate alarm or requestIdleCallback
  - Do NOT compact data for windows the user might be actively viewing
  - Do NOT change the settings schema in a breaking way — repurpose existing field

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Data aggregation with time-series grouping, idempotency, and edge cases. Needs careful thought.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (solo)
  - **Blocks**: None
  - **Blocked By**: Task 7

  **References**:

  **Pattern References**:
  - `src/utils/storage.ts:purgeSnapshotsForGame()` — Current purge logic. Compaction replaces this approach.
  - `src/background/index.ts` — Alarm registration pattern (look for `chrome.alarms.create`)
  - `src/utils/idb-storage.ts` (from Task 3) — IndexedDB read/write/delete functions

  **API/Type References**:
  - `src/types/index.ts:Snapshot` — `{ ts: number; current: number }` — the data being compacted
  - `src/types/index.ts:Settings` — `purgeAfterDays` field to repurpose as `fullResolutionDays`

  **WHY Each Reference Matters**:
  - Compaction replaces purge — must understand current purge flow to replace it
  - Alarm pattern ensures compaction runs periodically without blocking fetch cycle
  - Snapshot type is simple — compacted records have same shape (just fewer of them)

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file created: `tests/compaction.test.ts`
  - [ ] `pnpm vitest run tests/compaction.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: Old snapshots compacted to daily aggregates
    Tool: Bash (pnpm vitest run)
    Preconditions: 100 snapshots for appId "100", spanning 45 days (oldest 45 days ago)
    Steps:
      1. Call compactSnapshots("100", 7) — 7 days full resolution
      2. Assert snapshots 0-7 days old: unchanged (full resolution)
      3. Assert snapshots 7-45 days old: one record per day (daily avg)
      4. Assert total record count decreased significantly
    Expected Result: Recent data preserved, old data aggregated
    Failure Indicators: Recent data lost, or old data not aggregated
    Evidence: .sisyphus/evidence/task-15-compaction.txt

  Scenario: All-time minimum preserved through compaction
    Tool: Bash (pnpm vitest run)
    Preconditions: All-time minimum is in the "old" tier (60 days ago, value=5)
    Steps:
      1. Run compactSnapshots
      2. Assert a record with current=5 still exists in IndexedDB
    Expected Result: All-time min record preserved
    Failure Indicators: Min record deleted or its value changed to an average
    Evidence: .sisyphus/evidence/task-15-min-preserved.txt

  Scenario: Compaction is idempotent
    Tool: Bash (pnpm vitest run)
    Preconditions: Run compaction once
    Steps:
      1. Count total snapshots after first compaction
      2. Run compaction again
      3. Count total snapshots after second compaction
      4. Assert counts are equal
    Expected Result: Second run doesn't change data
    Failure Indicators: Record count changes on re-run
    Evidence: .sisyphus/evidence/task-15-idempotent.txt
  ```

  **Commit**: YES
  - Message: `feat(storage): add tiered data compaction for long-term retention`
  - Files: `src/utils/compaction.ts` (or `idb-storage.ts`), `src/background/index.ts`, `tests/compaction.test.ts`
  - Pre-commit: `pnpm vitest run`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm vitest run` + `pnpm build`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names. Verify no chart library added. Verify `idb` and `fake-indexeddb` are the only new deps.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Load extension in browser. Execute EVERY QA scenario from EVERY task. Test cross-task: add game → expand panel → switch filters → hover chart → check record low → check price chart → check About page. Test edge cases: game with no ITAD data, empty snapshots, single data point.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes (new files not in plan, deleted files not mentioned).
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Commit | Scope | Files | Pre-commit |
|--------|-------|-------|------------|
| 1 | `feat(types): expand GraphWindowKey to 6 time filters` | `types/index.ts`, `sparkline.ts`, tests | `pnpm vitest run` |
| 2 | `feat(trend): add computeWindowMin for record low tracking` | `trend.ts`, tests | `pnpm vitest run` |
| 3 | `feat(storage): add IndexedDB storage layer via idb` | `idb-storage.ts`, tests, `package.json` | `pnpm vitest run` |
| 4 | `feat(api): add ITAD API client with Zod validation` | `itad-api.ts`, tests | `pnpm vitest run` |
| 5 | `chore(config): add ITAD env vars, manifest permissions` | `vite.config.ts`, `manifest.json`, `.env.example` | `pnpm build` |
| 6 | `feat(storage): add chrome.storage.local → IndexedDB migration` | `migrate.ts`, tests | `pnpm vitest run` |
| 7 | `refactor(storage): switch all consumers to IndexedDB` | `background/index.ts`, `popup/main.ts`, `options/main.ts`, `storage.ts` | `pnpm vitest run` |
| 8 | `feat(background): integrate ITAD data fetching (hybrid)` | `background/index.ts`, `fetchCycle.ts` | `pnpm vitest run` |
| 9 | `feat(card): extend CardViewModel with record lows + ITAD data` | `card.ts`, tests | `pnpm vitest run` |
| 10 | `feat(ui): replace 3 graph tabs with 6 time filter pills` | `popup/main.ts`, `popup.css` | `pnpm build` |
| 11 | `feat(ui): add interactive hover tooltip on expanded sparklines` | `sparkline.ts`, `popup/main.ts`, `popup.css`, tests | `pnpm vitest run` |
| 12 | `feat(ui): add ITAD price history sparkline chart` | `sparkline.ts`, `popup/main.ts`, `popup.css`, tests | `pnpm vitest run` |
| 13 | `feat(ui): add record low row in expanded panel` | `popup/main.ts`, `popup.css` | `pnpm build` |
| 14 | `feat(options): add About page with ITAD credits` | `options/index.html`, `options/main.ts`, `options/options.css` | `pnpm build` |
| 15 | `feat(storage): add tiered data compaction for long-term retention` | `idb-storage.ts`, `background/index.ts`, tests | `pnpm vitest run` |

---

## Success Criteria

### Verification Commands
```bash
pnpm vitest run                    # Expected: all tests pass (261 existing + new TDD tests)
pnpm build                         # Expected: clean build, no errors
pnpm vitest run --coverage         # Expected: new modules ≥80% line coverage
```

### Final Checklist
- [ ] All "Must Have" present and functional
- [ ] All "Must NOT Have" absent (no chart lib, no framework, no over-abstraction)
- [ ] All tests pass (existing + new)
- [ ] IndexedDB migration preserves all existing data
- [ ] ITAD API calls work with provided key
- [ ] About page credits ITAD per ToS
- [ ] `unlimitedStorage` permission in manifest
- [ ] No new deps beyond `idb` + `fake-indexeddb`
