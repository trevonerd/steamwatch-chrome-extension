# CLAUDE.md — SteamWatch Chrome Extension

AI assistant guide for the SteamWatch Chrome Extension codebase.

---

## Project Overview

SteamWatch is a Manifest v3 Chrome extension that tracks Steam game player counts,
detects trends/spikes, and delivers configurable browser notifications. It polls
multiple APIs (Steam Web API, SteamSpy, SteamCharts, Twitch) on a periodic alarm
and stores snapshots locally for sparkline charts and analytics.

**Current version:** 0.11.1 (see `manifest.json` and `CHANGELOG.md`)

---

## Architecture

```
src/
├── background/     # MV3 service worker (fetch cycle, alarms, notifications, badge)
├── popup/          # Toolbar popup UI (game cards, sparklines, share)
├── options/        # Full-page settings UI (game management, thresholds, export)
├── types/          # Shared TypeScript interfaces
└── utils/          # Pure utility modules (api, card, storage, trend, etc.)

tests/              # Vitest unit tests (261 tests, mirrors src/utils/ + src/background/)
public/icons/       # Extension icons (16/32/48/128px PNG)
manifest.json       # Chrome Extension Manifest v3
```

### Data Flow

```
chrome.alarms (every N min)
  → background/index.ts (fetchAll)
      → utils/api.ts        (fetch Steam + Twitch APIs, Zod-validated)
      → utils/storage.ts    (persist snapshots + cache)
      → chrome.notifications (emit alerts with cooldowns)
      → chrome.action.setBadgeText (red/green/empty)

User clicks extension icon
  → popup/main.ts
      → utils/storage.ts    (load games, cache, snapshots)
      → utils/card.ts       (buildCardViewModel — single source of truth)
      → utils/sparkline.ts  (generate SVG charts)
      → utils/share.ts      (text / canvas image for clipboard)

User opens options page
  → options/main.ts
      → utils/storage.ts    (load/save settings, games, per-game overrides)
      → utils/api.ts        (searchGames for autocomplete)
      → utils/exporter.ts   (CSV/JSON download)
```

---

## Key Modules

| File | Purpose |
|------|---------|
| `src/background/index.ts` | Service worker: alarms, fetch loop, notifications, badge |
| `src/background/fetchCycle.ts` | `buildCachedData()`, `mergeCycleCache()` helpers |
| `src/popup/main.ts` | Popup rendering, card build, expand panel, refresh |
| `src/popup/shareBar.ts` | Share bar visibility toggle |
| `src/popup/thumb.ts` | Thumbnail color fallback (deterministic per appid) |
| `src/options/main.ts` | Options page: game CRUD, settings, quiet hours, export |
| `src/types/index.ts` | All shared interfaces (`Game`, `Snapshot`, `CachedData`, `Settings`, `CardViewModel`, …) |
| `src/utils/api.ts` | External API calls (all Zod-validated) |
| `src/utils/card.ts` | `buildCardViewModel()` — single source of truth for display data |
| `src/utils/storage.ts` | `chrome.storage.local` abstraction (`sw_` key prefix) |
| `src/utils/trend.ts` | `computeTrend()`, `detectSpike()`, `computeForecast()`, formatters |
| `src/utils/sparkline.ts` | SVG sparkline generation, `mapToPoints()`, `sparklineColor()` |
| `src/utils/share.ts` | `buildShareText()` (plain text), `renderShareCanvas()` (PNG) |
| `src/utils/exporter.ts` | `buildExportRows()`, `rowsToCSV()`, `rowsToJSON()`, `downloadFile()` |
| `src/utils/html.ts` | XSS-safe DOM helpers: `esc()`, `mustGet()`, `show()`, `hide()` |
| `src/utils/quietHours.ts` | `isQuietNow()`, day-of-week bitmask helpers |
| `tests/setup.ts` | Global Chrome API mocks (storage, alarms, runtime, notifications) |

---

## Development Commands

```bash
pnpm install          # Install dependencies (pnpm is the package manager)
npm run dev           # Vite watch mode (rebuilds on save)
npm run build         # Production build → dist/
npm test              # Run 261 Vitest unit tests
npm run test:watch    # Vitest watch mode
npm run test:coverage # Coverage report (text + JSON + HTML)
```

**Loading the extension in Chrome:**
1. `npm run build`
2. Navigate to `chrome://extensions`
3. Enable Developer mode
4. "Load unpacked" → select the `dist/` folder

---

## TypeScript Conventions

- **Strict mode** is enabled: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes`
- No `any` — use proper types or `unknown` with narrowing
- Target: ES2022, module resolution: `bundler` (Vite/esbuild)
- External API responses **must** be validated with Zod before use (see `utils/api.ts`)

### Naming

| Kind | Convention | Example |
|------|-----------|---------|
| Interfaces | PascalCase | `CardViewModel`, `Game` |
| Constants | UPPER_SNAKE_CASE | `MAX_GAMES`, `TREND_LEVELS` |
| Functions | camelCase with descriptive verb prefix | `buildCardViewModel`, `fetchCurrentPlayers`, `computeTrend` |
| Storage keys | `sw_` prefix | `sw_games`, `sw_snaps_{appid}` |

### File Structure Pattern

```ts
// ── Constants ─────────────────────────────────────────────────────────
const FOO = ...

// ── Types ─────────────────────────────────────────────────────────────
interface Bar { ... }

// ── Core logic ────────────────────────────────────────────────────────
export function doThing() { ... }

// ── Helpers ───────────────────────────────────────────────────────────
function _helper() { ... }
```

---

## Key Design Patterns

### 1. Single Source of Truth — CardViewModel

All display data is derived once via `buildCardViewModel()` in `src/utils/card.ts`.
The popup, share-text builder, and canvas renderer all consume the same model.
**Never compute trend/averages inline in the UI layer.**

### 2. Zod Validation at API Boundaries

Every external API response (Steam, SteamSpy, SteamCharts, Twitch) is parsed through
a Zod schema before any field is accessed. Validation failures throw and are caught
by the fetch cycle's try/catch, leaving the cache unchanged.

### 3. Storage Abstraction

All reads/writes go through `src/utils/storage.ts`. Never call `chrome.storage.local`
directly elsewhere. Storage keys all use the `sw_` prefix.

**Limits:**
- `MAX_GAMES = 5` (hard cap on tracked games)
- Snapshots purged after 7 days (configurable via `retentionDays` setting)

### 4. XSS Safety

All user-supplied or API-sourced strings must be escaped via `esc()` from
`src/utils/html.ts` before insertion into innerHTML. Use `mustGet()` for typed
element lookups (throws if element missing — fails fast on config errors).

### 5. Pure Functions & Testability

Business logic (trend, forecast, sparkline, quiet hours, export) lives in pure
utility modules with no side effects. This makes them straightforward to unit test
without mocking DOM or Chrome APIs.

### 6. Notification Cooldowns & Quiet Hours

Notification types have independent cooldowns stored in `chrome.storage.local`:
- Spike: 20 min
- Trend: 30 min
- Crash: 15 min

Quiet hours suppress notifications without consuming cooldown. Per-game threshold
overrides take precedence over global settings.

---

## Testing

Tests live in `tests/` and mirror the utility modules. Use Vitest.

```bash
npm test                    # Run all tests once
npm run test:watch          # Watch mode
npm run test:coverage       # Generate coverage report
```

**Chrome API mocks** are set up globally in `tests/setup.ts`:
- `chrome.storage.local` → in-memory key-value store, reset in `beforeEach`
- `chrome.runtime.sendMessage`, `chrome.runtime.openOptionsPage`
- `chrome.alarms.create`, `chrome.alarms.clear`, `chrome.alarms.onAlarm`
- `chrome.notifications.create`

When adding new storage keys or Chrome API calls, add corresponding mocks to `tests/setup.ts`.

**Test conventions:**
- Group with `describe()`, assert with `expect()`
- Test pure functions directly; test storage functions via the abstraction layer
- Each test file should cover one module

---

## Build System

**Vite 5** + `vite-plugin-web-extension`:
- `base: ""` — critical for Chrome extension (relative asset paths, not absolute)
- Minified output, no sourcemaps in production
- `emptyOutDir: true` — dist/ is wiped on each build

Dependency count is intentionally minimal: only `zod` as a runtime dependency.
Do not add unnecessary npm packages; prefer implementing utilities inline.

---

## Chrome Extension Specifics (MV3)

- **Service worker** (`background/index.ts`): long-lived via `chrome.alarms`, not
  persistent background pages. Never assume the service worker is awake between events.
- **Permissions**: `storage`, `alarms`, `notifications`, `clipboardWrite`
- **Host permissions**: Steam Web API, SteamSpy, SteamCharts, Twitch GraphQL
- **Popup** opens at `src/popup/index.html`, closes on blur — keep initialization fast
- **Options page** opens in a new tab (`chrome_url_overrides` is not used)

---

## What NOT to Do

- Do not call `chrome.storage.local` directly — use `src/utils/storage.ts`
- Do not insert API/user strings into innerHTML without `esc()`
- Do not add runtime dependencies without strong justification
- Do not compute display metrics in popup/options — use `buildCardViewModel()`
- Do not skip Zod validation for any external API response
- Do not hard-code player thresholds — read from `Settings` / `GameSettings`
- Do not add more than 5 tracked games (enforced by `MAX_GAMES`)

---

## External APIs Used

| API | Purpose | Validation |
|-----|---------|-----------|
| `api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1` | Current player count | Zod |
| `steamspy.com/api.php?request=appdetails` | All-time peak | Zod |
| `steamcharts.com/app/{id}` | 24h peak (HTML scrape) | Regex |
| `gql.twitch.tv/gql` (GraphQL) | Viewer count | Zod |
| `store.steampowered.com/api/storesearch` | Game search autocomplete | Zod |
