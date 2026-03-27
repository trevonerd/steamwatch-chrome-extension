# Learnings — steamwatch-evolution

## 2026-03-27 Session ses_2d1656314ffe5I0VETK0iMcV9I — Codebase Analysis

### Key Architecture
- **Framework**: Vanilla TypeScript + Vite 5 + Zod + Chrome MV3
- **Charts**: Custom SVG sparklines in `src/utils/sparkline.ts` — NO external chart library
- **Build**: `pnpm build`, tests: `pnpm vitest run` (261 existing tests pass)
- **Test setup**: `tests/setup.ts` with chrome.storage mock
- **Package manager**: pnpm

### Current Types (src/types/index.ts)
- `GraphWindowKey = "24h" | "3d" | "retention"` — expanding to 6 values
- `GraphWindowOption { key, label, windowMs }` — option object
- `CardViewModel` — pure UI data bag, no new fields yet
- `CachedData` — no ITAD fields yet
- `Snapshot { ts: number, current: number }` — simple, unchanged
- `Settings.purgeAfterDays` — repurposed as fullResolutionDays for compaction

### Current sparkline.ts
- `GRAPH_WINDOW_MS` only has "24h" and "3d" — missing "7d", "15d", "1m", "all"
- `buildAvailableGraphWindows(retentionDays)` — currently returns 2-3 windows using "retention" key
- `filterSnapshotsByWindow(snapshots, windowMs)` — "all" window should use 0 as windowMs (no filter)
- `hasEnoughGraphHistory(snapshots, windowMs)` — requires ≥6 snapshots AND ≥75% span; "all" = only ≥6
- `segmentColor(prev, next)` — rising=green, falling=red (OPPOSITE for price chart!)

### Current storage.ts
- chrome.storage.local keys: `sw_games`, `sw_cache`, `sw_settings`, `sw_snaps_{appid}`, `sw_gs_{appid}`, `sw_last_fetch`
- `getSnapshotsForGame(appid)` — reads `sw_snaps_{appid}` from chrome.storage.local
- `purgeSnapshotsForGame(appid, days)` — will be REPLACED by compaction
- Small key-value data (games, cache, settings) stays in chrome.storage.local FOREVER

### trend.ts patterns
- `computeTrend()`, `compute24hAvg()`, `computeRetentionAvg()` — all take `readonly Snapshot[]`, return computed value or null
- `fmtNumber(n)` — formats player counts: K/M suffixes
- Pattern for new `computeWindowMin`: same signature style, return `{ value, timestamp } | null`

### ITAD API
- Auth: query param `?key=YOUR_KEY` (NOT header)
- Lookup: `GET /games/lookup/v1?appid=<steam_appid>&key=<key>`
- History: `GET /games/prices/history/v2?id=<uuid>&shops[]=61&key=<key>`
- History Low: `POST /games/prices/historyLow/v1?key=<key>` body: `["uuid1"]`
- ALWAYS use `amountInt` (integer cents), never floats
- Pattern: `api.ts:53-65` — Zod `safeParse()`, return null on failure

### Pre-existing LSP Errors (NOT caused by our work)
- `src/popup/main.ts:473` — exactOptionalPropertyTypes mismatch
- `src/background/index.ts:165` — exactOptionalPropertyTypes mismatch
- `src/background/fetchCycle.ts:59` — exactOptionalPropertyTypes mismatch
- Multiple HTML files: missing `type` attribute on buttons

### Wave 1 Dependencies
- Task 1 + 2 run in parallel (no deps)
- Task 3 runs in parallel (no deps, installs idb)
- Task 4 runs in parallel (no deps, creates itad-api.ts)
- Task 5 runs in parallel (no deps, config files only)

## 2026-03-27 Session — Task 1: GraphWindowKey Expansion (TDD)

### Completed
- ✅ Expanded `GraphWindowKey` from 3 to 6 values: `"24h" | "3d" | "7d" | "15d" | "1m" | "all"`
- ✅ Added all 6 entries to `GRAPH_WINDOW_MS` constant with correct millisecond values
- ✅ Fixed `filterSnapshotsByWindow` to handle windowMs=0 as "all" sentinel (no time filter)
- ✅ Updated `hasEnoughGraphHistory` to skip span check for windowMs=0 ("all" window)
- ✅ Rebuilt `buildAvailableGraphWindows()` to filter all 6 windows by retention, always include "all"
- ✅ Updated `buildCardViewModel` to pick first non-"all" window as default (skip "all")
- ✅ All 261 existing tests + 27 new graph-windows tests pass (322 total)
- ✅ `pnpm build` clean exit

### Key Implementation Details
- **"all" as sentinel**: windowMs=0 means no time filter (special case in filterSnapshotsByWindow)
- **Span check bypass**: "all" window requires ≥6 snapshots only, no span requirement
- **Window filtering logic**: buildAvailableGraphWindows filters based on `retentionMs >= GRAPH_WINDOW_MS[key]`, except "all" always included
- **Default window selection**: Pick first window that is NOT "all" to avoid offering users an unbounded view as default
- **"retention" replaced**: Old "retention" key fully replaced by explicit "all" + "7d" windows

### Test Patterns
- Created comprehensive `tests/graph-windows.test.ts` with 27 tests covering:
  - Type assertions for all 6 GraphWindowKey values
  - GRAPH_WINDOW_MS constant coverage
  - filterSnapshotsByWindow behavior for windowMs=0 and regular windows
  - hasEnoughGraphHistory logic split (6+ snapshots for "all", 6+ + 75% span for others)
  - buildAvailableGraphWindows filtering and ordering
- Updated existing tests in `sparkline.test.ts` and `card.test.ts` to match new behavior

## 2026-03-27 — Task 4: ITAD API client + TDD
- Added `src/utils/itad-api.ts` using the same `safeParse` + fallback pattern as `src/utils/api.ts` (null/[]/empty Map on any failure).
- Implemented ITAD endpoints with `key` query param and integer-cent fields (`amountInt`) only.
- Added `tests/itad-api.test.ts` with global `fetch` stubbing and realistic ITAD payload shapes for lookup/history/historyLow paths.
- Confirmed targeted suite passes: `tests/itad-api.test.ts` (8/8).
- Full suite currently has unrelated pre-existing failure: `tests/idb-storage.test.ts` imports missing `src/utils/idb-storage.js`.

## 2026-03-27 — Task 3: IndexedDB storage layer + TDD
- Added `idb` runtime dependency and `fake-indexeddb` dev dependency.
- Added `PriceRecord` to `src/types/index.ts` as shared price-history domain model.
- Updated `tests/setup.ts` to import `fake-indexeddb/auto` first so IndexedDB APIs are available in Vitest Node runs.
- Implemented `src/utils/idb-storage.ts` with three object stores (`snapshots`, `itadMappings`, `priceHistory`), compound indexes for app/time range queries, relaxed-durability write transactions, and typed read/write APIs.
- Added `_resetDbForTesting()` that closes/open-state resets to avoid blocked/lingering DB handles between tests.
- Added `tests/idb-storage.test.ts` covering snapshot CRUD/range/isolation, ITAD mapping roundtrip/null behavior, and price history roundtrip/sorting.
- Important test isolation detail: `indexedDB.deleteDatabase()` must be awaited via request callbacks (`onsuccess`/`onerror`) to prevent hangs/timeouts.
- Verification: targeted suite `tests/idb-storage.test.ts` and full suite both pass (337/337).

## 2026-03-27 — Task 6: chrome.storage.local → IndexedDB migration (TDD)
- Added `src/utils/migrate.ts` with one-shot migration entrypoint `migrateToIndexedDB()` and typed stats `{ migrated, skipped, errors }`.
- Migration flow implemented in strict order: sentinel check (`sw_migration_complete`) → load `sw_games` → per-game `sw_snaps_{appid}` reads → snapshot validation (`ts/current` numbers) → per-snapshot `idbSaveSnapshot` writes → per-game verification with `idbGetSnapshots` count matching.
- Idempotency is enforced via sentinel short-circuit; successful first run sets `sw_migration_complete: true`, second run returns zeros and does not duplicate IDB rows.
- Corruption handling: invalid snapshot records are skipped and counted in `errors`; missing/non-array per-game snapshot payloads are counted in `skipped` and migration continues.
- Safety behavior: source `chrome.storage.local` keys are preserved (no deletion), and sentinel is set only if all per-game verifications succeed.
- Added `tests/migrate.test.ts` (9 tests) covering early return, full migration, sentinel write, idempotency, empty/missing `sw_games`, corrupted snapshots, source preservation, and aggregate stats.
- Captured evidence outputs to `.sisyphus/evidence/task-6-migration.txt`, `.sisyphus/evidence/task-6-idempotent.txt`, and `.sisyphus/evidence/task-6-corrupted.txt`.

## Task 7 — Storage Switchover (2026-03-27)

### What changed
- `src/background/index.ts`: removed `addSnapshot`/`purgeSnapshotsForGame` from storage.ts imports; added `idbSaveSnapshot`/`idbGetSnapshots` from `idb-storage.ts`; added `migrateToIndexedDB` from `migrate.ts`; `bootstrap()` now calls `void migrateToIndexedDB()` fire-and-forget before `resetAlarm()`; `fetchGame()` uses `idbSaveSnapshot` + `idbGetSnapshots` instead of old pattern
- `src/popup/main.ts`: removed `getSnapshotsForGame` from storage.ts; imports `idbGetSnapshots` from `idb-storage.ts`; passed as callback to `buildAllViewModels`

### Key pattern
`idbGetSnapshots(appId: string): Promise<Snapshot[]>` is a direct drop-in for `getSnapshotsForGame(appid: string): Promise<Snapshot[]>` — same signature.

### Deliberate design choices
- `purgeSnapshotsForGame` dropped entirely — IDB has no practical size limit, compaction is Task 15 scope
- `migrateToIndexedDB()` is fire-and-forget (`void`) so it never blocks alarm setup or first fetch
- `storage.ts` preserved intact — still used for games/cache/settings/last-fetch by all consumers including options/main.ts

### Tests
- No snapshot-related test changes needed — `fetchCycle.test.ts` and `popup-dom.test.ts` don't import snapshot functions
- `storage.test.ts` still tests old storage.ts functions (fine — storage.ts still exports them)
- All 358 tests pass, build exit 0

## Task 8 — ITAD Data Integration in Background Worker (2026-03-27)

### What changed
- `src/background/fetchCycle.ts`: Added `itadUuid?` and `itadHistoricalLow?` to `BuildCachedDataInput`; destructures them in `buildCachedData()`; return statement carries them forward from input, falling back to `prevCache` values (same pattern as other optional fields)
- `src/background/index.ts`: Added imports for `lookupItadGame`, `fetchHistoricalLow` from `itad-api.ts` and `idbSaveItadMapping`, `idbGetItadMapping` from `idb-storage.ts`; `fetchGame()` now does ITAD UUID lookup (checks IDB first, falls back to API, persists result); `fetchAll()` now does batch `fetchHistoricalLow` after Steam results and enriches `cacheResults` into `enrichedResults`
- `tests/fetchCycle.test.ts`: Added 5 new tests in `"buildCachedData — ITAD fields"` describe block

### Key patterns
- UUID lookup: IDB-first (`idbGetItadMapping`), API fallback (`lookupItadGame`), persist on first lookup (`idbSaveItadMapping`) — all `.catch()`-protected
- Historical low: single batch POST via `fetchHistoricalLow(uuidLookupList)` — after all Steam fetches complete; `.catch(() => new Map())` so ITAD failure is silent
- Immutable enrichment: `enrichedResults = cacheResults.map(r => ({ ...r, cacheData: { ...r.cacheData, itadHistoricalLow: low } }))`
- `buildCachedData` carry-forward: if neither input nor prevCache have ITAD data, fields are simply absent from output — no crash

### Pre-existing LSP errors (NOT our bugs, do not fix)
- `src/background/index.ts:188` — exactOptionalPropertyTypes mismatch (pre-existing)
- `src/background/fetchCycle.ts:63` — exactOptionalPropertyTypes mismatch (pre-existing)
- `src/popup/main.ts:473` — exactOptionalPropertyTypes mismatch (pre-existing)

### Tests
- 363 tests pass (added 5 new), build exit 0
- Evidence: `.sisyphus/evidence/task-8-lookup.txt`, `.sisyphus/evidence/task-8-historical-low.txt`, `.sisyphus/evidence/task-8-itad-failure.txt`

## Task 15 — Tiered Compaction (2026-03-27)
- Added `src/utils/compaction.ts` with focused snapshot-only compaction API: `compactSnapshots(appId, fullResolutionDays)`.
- Tier boundaries are time-based against `Date.now()`: recent (kept raw), medium (`< fullResolutionDays` to `>= 90d`) compacted by UTC day, old (`> 90d`) compacted by ISO week (Monday 00:00 UTC).
- `startOfDay` and `startOfWeek` are UTC-normalized; ISO-week start uses `(getUTCDay() + 6) % 7` to map Monday as zero-offset.
- Aggregation is deterministic and idempotent: `groupAndAverage` groups by bucket timestamp and uses `Math.round(sum/count)`.
- All-time minimum preservation detail: after delete/rebuild, compaction verifies any snapshot with `current === allTimeMin.current` exists; if absent, reinserts original min snapshot.
- Idempotency gotcha covered in tests: if the preserved minimum exists in an already-compacted bucket (same day/week anchor), exclude that preserved record from regroup input to avoid average drift on reruns.
- Added dedicated TDD suite `tests/compaction.test.ts` (8 cases) with fixed clock via `vi.spyOn(Date, "now")` to avoid fake-timer IndexedDB hangs.
- Background integration: `src/background/index.ts` now registers daily `steamwatch-compaction` alarm (`24 * 60` minutes) and runs `compactSnapshots` for each tracked game using `settings.purgeAfterDays ?? 7` as full-resolution window.
