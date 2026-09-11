# SteamWatch Chrome Extension - Agent Instructions

## 1. Project Overview

SteamWatch is a Chrome extension (Manifest V3) that tracks Steam games with live player counts, local player graph history, Twitch viewer data, toolbar badges, and player-count notifications. Built with TypeScript 5 (strict mode), Vite 5, Zod validation, and Vitest. Uses pnpm as the package manager.

The extension consists of three main components:
- Service worker (`src/background/index.ts`) - handles alarms, fetch cycles, notifications, and badge updates
- Popup UI (`src/popup/`) - primary user experience with game cards, sparklines, expanded graphs, and sharing
- Options page (`src/options/`) - lean settings for Games, Notifications, and About

Core tracking is always active:
- `FETCH_INTERVAL_MINUTES = 5`
- `TRACKING_RETENTION_DAYS = 60`
- `MAX_GAMES = 10`

## 2. Version Management (CRITICAL)

**Single source of truth: `manifest.json`**

The version number lives in `manifest.json` only. Never update `package.json` version directly.

### Version Sync Workflow

1. Update version in `manifest.json` (for example, `"version": "0.13.2"`)
2. Run `pnpm version-sync` to sync to `package.json`
3. The prebuild hook runs version-sync automatically during `pnpm run build`

### Version Bumping Rules

- PATCH: bugfixes and minor improvements
- MINOR: new features
- MAJOR: breaking changes

### Active v2 beta workflow

- User-requested beta builds use a numeric Chrome `version` and descriptive `version_name` in `manifest.json`, starting at `2.0.0` / `2.0.0-beta.1`.
- Keep the visible base fixed at `2.0.0`: increment ONLY the beta counter in `version_name` (`2.0.0-beta.3`, `2.0.0-beta.4`, etc.). The beta 2 patch increment was corrected by the user.
- Keep Chrome's technical version monotonic using its fourth numeric component: after the already delivered `2.0.1`, use `2.0.1.3` for beta 3, `2.0.1.4` for beta 4, etc. Do not increment for repeated builds/tests of the same change set.
- Run `pnpm version-sync`, update `CHANGELOG.md`, build, and test before handing the build to the user.
- Popup and About must display `chrome.runtime.getManifest().version_name` with `version` as fallback, so they identify the extension actually loaded.
- Before leaving beta, choose a stable numeric version greater than the last beta build; do not reset to an older numeric version.

### Release Checklist

1. Update `manifest.json` version
2. Run `pnpm version-sync`
3. Update `CHANGELOG.md` using Keep a Changelog format
4. Commit with message: `chore: bump version to X.Y.Z`
5. Build and test: `pnpm run build && pnpm test`

Note: `README.md` has no version number and is intentionally version-agnostic. The badge links to `CHANGELOG.md`.

## 3. Architecture & File Structure

```text
src/
├── background/
│   ├── index.ts              Service worker entry point, alarm handlers
│   └── fetchCycle.ts         Player data fetch cycle, local snapshots, notification logic
├── popup/
│   ├── index.html
│   ├── main.ts               Popup initialization, card rendering, graph rendering, quick actions
│   ├── popup.css
│   ├── shareBar.ts           Share controls
│   └── thumb.ts              Thumbnail fallback handling
├── options/
│   ├── index.html
│   ├── main.ts               Games, Notifications, About settings
│   └── options.css
├── types/
│   └── index.ts              Shared TypeScript types and Zod schemas
├── utils/
│   ├── api.ts                Steam, SteamSpy, SteamCharts, Twitch fetchers (Zod-validated)
│   ├── card.ts               CardViewModel factory
│   ├── html.ts               XSS-safe DOM helpers
│   ├── idb-storage.ts        IndexedDB wrapper for player snapshots and notification cooldowns
│   ├── log.ts                Typed error formatting helpers
│   ├── migrate.ts            chrome.storage.local -> IndexedDB migration
│   ├── quietHours.ts         Quiet hours bitmask logic
│   ├── share.ts              Share text, canvas image builder
│   ├── sparkline.ts          Graph window, point mapping, downsampling helpers
│   ├── storage.ts            chrome.storage.local abstraction and tracking constants
│   └── trend.ts              Trend and badge formatting
tests/                        Mirror src/ structure with Vitest unit tests
scripts/
└── sync-version.ts           Version sync (manifest.json -> package.json)
```

## 4. Code Conventions (MANDATORY)

### TypeScript

- Strict mode enforced - no `any`, no `@ts-ignore`, no `@ts-expect-error`
- All shared domain types live in `src/types/index.ts`
- Infer types from Zod schemas where possible

### API Validation

- All HTTP responses are validated with Zod schemas
- Schemas live in `src/types/index.ts`
- Validation happens at the API boundary (`src/utils/api.ts`)
- Invalid responses throw typed errors

### DOM Manipulation

- Use `src/utils/html.ts` helpers for DOM operations
- Helpers provide XSS-safe element creation, text insertion, class handling, attributes, and SVG creation
- Never use `innerHTML` directly
- Never concatenate user input into HTML strings

### No Frameworks

- Popup and options pages use vanilla TypeScript
- No React, Vue, or other frameworks
- DOM manipulation goes through helpers in `src/utils/html.ts`

### String Handling

- Use template literals for interpolation: `` `value: ${x}` ``
- Never concatenate strings with `+`
- For console logging, always use template literals: `` console.log(`msg: ${value}`) ``

### Console Logging

- Always log a single template-literal string
- Never pass objects directly to `console.log`, `console.warn`, or `console.error`
- Use `formatError` from `src/utils/log.ts` for unknown caught errors
- Correct: `` console.error(`operation failed: ${formatError(error)}`) ``
- Wrong: `console.error("operation failed:", error)`

### Error Handling

- Always catch errors with typed error handlers
- Never use empty catch blocks
- Log errors with context: `` console.error(`operation failed: ${formatError(error)}`) ``

### Imports

- Use relative paths only, no path aliases
- Example: `import { getGames } from "../utils/storage.js"`

## 5. Testing

### Framework & Environment

- Vitest with happy-dom environment
- IndexedDB tests use `fake-indexeddb`
- Test files mirror `src/` structure in `tests/`

### Running Tests

- `pnpm test` - single run
- `pnpm test:watch` - watch mode
- `pnpm test:coverage` - coverage report

### Test Requirements

- Every new utility function must have corresponding tests
- Every bugfix must include a regression test
- Tests should cover happy paths and error cases
- Mock external APIs: Steam, SteamSpy, SteamCharts, and Twitch

### Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("functionName", () => {
  it("should do X when given Y", () => {
    // arrange
    // act
    // assert
  });

  it("should handle error case", () => {
    // test error handling
  });
});
```

## 6. Build & Development

### Development

```bash
pnpm run dev
```

Vite watch mode. Rebuilds on file changes. Load the `dist/` folder in Chrome to test.

### Production Build

```bash
pnpm run build
```

Builds to `dist/`. Automatically runs version-sync via prebuild hook. Always run tests after building.

### Testing

```bash
pnpm test
```

Runs all Vitest tests. Check coverage with `pnpm test:coverage`.

### Loading the Extension

1. Open Chrome
2. Navigate to `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked"
5. Select the `dist/` folder

### Critical Vite Configuration

`vite.config.ts` must have `base: ""` (empty string). Absolute paths break under the `chrome-extension://` protocol.

## 7. Storage Architecture

### chrome.storage.local

- Settings, game list, trend metadata, and local summary data
- Accessed via `src/utils/storage.ts`
- Limited to about 10 MB per extension
- `sw_settings` must be normalized so removed keys are not written back

### IndexedDB

- Player snapshots and notification cooldowns
- Accessed via `src/utils/idb-storage.ts`
- Uses `idb` for simplified API access
- Used for higher-volume local tracking data

### Migration

- One-time migration from `chrome.storage.local` to IndexedDB
- Handled by `src/utils/migrate.ts`
- Migration sentinel key: `sw_migration_complete`
- Set once migration is verified complete

### Migration Count Verification

- IDB may have more snapshots than expected because bootstrap writes can happen concurrently
- Use `<` rather than `!==` for count checks

```typescript
if (idbCount < expectedCount) {
  // retry migration verification
}
```

## 8. Common Pitfalls

### Console Logging Objects

Chrome extension logs can render objects poorly. Always format unknown errors first:

```typescript
// Wrong
console.error("operation failed:", error);

// Correct
console.error(`operation failed: ${formatError(error)}`);
```

### Migration Count Verification

IDB may have more snapshots than expected due to concurrent bootstrap writes:

```typescript
// Wrong
if (idbCount !== expectedCount) {
  // fail
}

// Correct
if (idbCount < expectedCount) {
  // retry
}
```

### Vite Base Path

Must be `""` (empty string), not `"/"`. Absolute paths break `chrome-extension://` URLs:

```typescript
// Wrong
export default defineConfig({
  base: "/",
});

// Correct
export default defineConfig({
  base: "",
});
```

### Chrome Extension CORS

`host_permissions` in `manifest.json` must cover all API domains:

```json
"host_permissions": [
  "https://api.steampowered.com/*",
  "https://steamspy.com/*",
  "https://steamcharts.com/*",
  "https://gql.twitch.tv/*",
  "https://store.steampowered.com/*"
]
```

## 9. Agent Workflow Checklist

Before marking any task complete, verify:

1. Code compiles - run `pnpm run build` or check LSP diagnostics
2. Tests pass - run `pnpm test`
3. No type errors - TypeScript strict mode, no suppressions
4. Version updated only if releasing - update `manifest.json`, then run `pnpm version-sync`
5. `CHANGELOG.md` updated only if version bumped or release notes are requested
6. New functions have tests
7. Bugfixes have regression tests

## 10. Dependencies

### Runtime

- `idb` - IndexedDB wrapper
- `zod` - schema validation

### Development

- TypeScript 5
- Vite 5
- vite-plugin-web-extension
- Vitest
- happy-dom
- fake-indexeddb
- tsx

### Package Manager

- pnpm (NEVER use npm or yarn)
- Add new dependencies sparingly - prefer built-in APIs

## 11. Git & Release

### Commit Messages

Use Conventional Commits format:

- `feat: add player-count notifications`
- `fix: correct sparkline rendering on mobile`
- `chore: update dependencies`
- `test: add regression test for migration`
- `docs: update AGENTS.md`

### Files to Never Commit

- `.env` - environment variables
- `dist/` - build output
- `node_modules/` - dependencies
- `.sisyphus/` - internal agent state

`.gitignore` is already configured for all of the above.

### Release Process

1. Update `manifest.json` version
2. Run `pnpm version-sync`
3. Update `CHANGELOG.md`
4. Commit: `chore: bump version to X.Y.Z`
5. Build: `pnpm run build`
6. Test: `pnpm test`
7. Tag: `git tag vX.Y.Z`
8. Push: `git push origin main --tags`
9. Generate a zip file containing the files from `dist/`, without including the `dist` directory itself. Name it `streamwatch.vx.x.x.zip`. Exclude system files such as `.DS_Store`.
10. Publish the zip file to the GitHub release


## vexp - Context-Aware AI Coding <!-- vexp v3.1.3 -->

### Context strategy: call run_pipeline ONCE at task start
If the task already names the files/symbols to touch, SKIP vexp. Otherwise one
`run_pipeline({ "task": "..." })` returns ranked pivot files with line ranges and
blast radius. Do NOT open files one by one to find your way around - every extra
tool call costs a turn. Call it again ONLY when the task moves to a new area.
`get_skeleton` for files to understand, not edit. `verify_done` before calling a
multi-file task complete, then RUN the tests it names.

### Query shape (do this)
Anchor the task on real identifiers (ClassName, functionName) or file paths:
`run_pipeline({ "task": "fix JWT expiry in AuthService.validateToken" })`

vexp runs entirely on this machine, index in `.vexp/`;
`run_pipeline` transmits nothing to any external service.
On `status: "degraded"` or 0 pivots the index is still building - use your own tools.
For literal string sweeps use your native search - do NOT route text sweeps through vexp.
Repo SOURCE only: logs, dist/, node_modules/ and files outside the repo are NOT indexed.
<!-- /vexp -->
