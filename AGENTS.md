# SteamWatch Chrome Extension — Agent Instructions

## 1. Project Overview

SteamWatch is a Chrome extension (Manifest V3) that tracks Steam games with live player counts, price trends, Twitch viewer data, and price alerts. Built with TypeScript 5 (strict mode), Vite 5, Zod validation, and Vitest (289+ tests). Uses pnpm as the package manager.

The extension consists of three main components:
- Service worker (background/index.ts) — handles alarms, fetch cycles, notifications, badge updates
- Popup UI (popup/) — toolbar popup with game list and quick actions
- Options page (options/) — settings, history graph, data management

## 2. Version Management (CRITICAL)

**Single source of truth: manifest.json**

The version number lives in `manifest.json` only. Never update `package.json` version directly.

### Version Sync Workflow

1. Update version in `manifest.json` (e.g., `"version": "0.13.2"`)
2. Run `pnpm version-sync` to sync to package.json
3. The prebuild hook runs version-sync automatically during `pnpm run build`

### Version Bumping Rules

- PATCH: bugfixes and minor improvements
- MINOR: new features
- MAJOR: breaking changes

### Release Checklist

1. Update `manifest.json` version
2. Run `pnpm version-sync`
3. Update `CHANGELOG.md` using Keep a Changelog format
4. Commit with message: `chore: bump version to X.Y.Z`
5. Build and test: `pnpm run build && pnpm test`

Note: README.md has no version number — intentionally version-agnostic. The badge links to CHANGELOG.md.

## 3. Architecture & File Structure

```
src/
├── background/
│   ├── index.ts              Service worker entry point, alarm handlers
│   └── fetchCycle.ts         Price data fetch loop, alert logic
├── popup/
│   ├── index.html
│   ├── main.ts               Popup initialization and event handlers
│   └── popup.css
├── options/
│   ├── index.html
│   ├── main.ts               Options page initialization, history graph
│   └── options.css
├── types/
│   └── index.ts              All shared TypeScript types, Zod schemas
├── utils/
│   ├── api.ts                Steam/SteamSpy/price HTTP fetchers (Zod-validated)
│   ├── card.ts               CardViewModel factory
│   ├── exporter.ts           CSV/JSON export logic
│   ├── html.ts               XSS-safe DOM helpers
│   ├── idb-storage.ts        IndexedDB wrapper (price snapshots)
│   ├── migrate.ts            chrome.storage.local → IDB migration
│   ├── quietHours.ts         Quiet hours bitmask logic
│   ├── share.ts              Share text, canvas image builder
│   ├── sparkline.ts          SVG sparkline generator
│   ├── storage.ts            chrome.storage.local abstraction
│   └── trend.ts              Trend, spike, forecast, badge formatting
tests/
├── background/
├── popup/
├── options/
├── types/
└── utils/                    Mirror src/ structure, Vitest unit tests
scripts/
└── sync-version.ts           Version sync (manifest.json → package.json)
```

## 4. Code Conventions (MANDATORY)

### TypeScript

- Strict mode enforced — no `any`, no `@ts-ignore`, no `@ts-expect-error`
- All types defined in `src/types/index.ts`
- Infer types from Zod schemas where possible

### API Validation

- All HTTP responses validated with Zod schemas
- Schemas defined in `src/types/index.ts`
- Validation happens at the API boundary (src/utils/api.ts)
- Invalid responses throw typed errors

### DOM Manipulation

- Use `src/utils/html.ts` helpers for all DOM operations
- Helpers provide XSS-safe element creation and text insertion
- Never use `innerHTML` directly
- Never concatenate user input into HTML strings

### No Frameworks

- Popup and options pages use vanilla TypeScript
- No React, Vue, or other frameworks
- DOM manipulation via helpers in src/utils/html.ts

### String Handling

- Use template literals for interpolation: `` `value: ${x}` ``
- Never concatenate strings with `+`
- For console logging, always use template literals: `` console.log(`msg: ${value}`) ``

### Console Logging

- Always use template literals, never pass objects directly
- Chrome extension logs render objects as `[object Object]`
- Correct: `` console.error(`error: ${JSON.stringify(err)}`) ``
- Wrong: `console.error("error:", err)`

### Error Handling

- Always catch errors with typed error handlers
- Never use empty catch blocks
- Log errors with context: `` console.error(`operation failed: ${JSON.stringify(err)}`) ``

### Imports

- Use relative paths only (no path aliases)
- Example: `import { getGames } from "../utils/storage.js"`

## 5. Testing

### Framework & Environment

- Vitest with happy-dom environment
- IndexedDB tests use `fake-indexeddb` package
- Test files mirror `src/` structure in `tests/` directory

### Running Tests

- `pnpm test` — single run
- `pnpm test:watch` — watch mode
- `pnpm test:coverage` — coverage report

### Test Requirements

- Every new utility function must have corresponding tests
- Every bugfix must include a regression test
- Tests should cover happy path and error cases
- Mock external APIs (Steam, SteamSpy, price APIs)

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
3. Enable Developer mode (top right)
4. Click "Load unpacked"
5. Select the `dist/` folder

### Critical Vite Configuration

`vite.config.ts` must have `base: ""` (empty string). Absolute paths break under the `chrome-extension://` protocol.

## 7. Storage Architecture

### chrome.storage.local

- Settings, game list, trend data
- Accessed via `src/utils/storage.ts`
- Synchronous API (returns values directly)
- Limited to ~10MB per extension

### IndexedDB

- Price snapshots, high-capacity data
- Accessed via `src/utils/idb-storage.ts`
- Uses `idb` library for simplified API
- Unlimited storage (browser quota)

### Migration

- One-time migration from chrome.storage.local to IndexedDB
- Handled by `src/utils/migrate.ts`
- Migration sentinel key: `sw_migration_complete`
- Set once migration is verified complete

### Migration Count Verification

- IDB may have MORE snapshots than expected (bootstrap writes concurrently)
- Use `<` not `!==` for count checks
- Example: `if (idbCount < expectedCount) { /* retry */ }`

## 8. Common Pitfalls

### Console Logging Objects

Chrome extension logs render objects as `[object Object]`. Always stringify:

```typescript
// Wrong
console.error("error:", err);

// Correct
console.error(`error: ${JSON.stringify(err)}`);
```

### Migration Count Verification

IDB may have more snapshots than expected due to concurrent bootstrap writes. Use `<` not `!==`:

```typescript
// Wrong
if (idbCount !== expectedCount) { /* fail */ }

// Correct
if (idbCount < expectedCount) { /* retry */ }
```

### Vite Base Path

Must be `""` (empty string), not `"/"`. Absolute paths break chrome-extension:// protocol:

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

`host_permissions` in manifest.json must cover all API domains:

```json
"host_permissions": [
  "https://api.steampowered.com/*",
  "https://steamspy.com/*",
  "https://price-api.example.com/*"
]
```

## 9. Agent Workflow Checklist

Before marking any task complete, verify:

1. Code compiles — run `pnpm run build` or check LSP diagnostics
2. Tests pass — run `pnpm test`
3. No type errors — TypeScript strict mode, no suppressions
4. Version updated if releasing — update manifest.json, run version-sync
5. CHANGELOG.md updated if version bumped
6. New functions have tests
7. Bugfixes have regression tests

## 10. Dependencies

### Runtime

- `idb` — IndexedDB wrapper
- `zod` — schema validation

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
- Add new dependencies sparingly — prefer built-in APIs

## 11. Git & Release

### Commit Messages9. Generate a zip file containing the files from the dist folder, without including the dist directory itself. Name the file streamwatch.vx.x.x.zip. Exclude system files like .DS_Store.

Use Conventional Commits format:

- `feat: add price alert notifications`
- `fix: correct sparkline rendering on mobile`
- `chore: update dependencies`
- `test: add regression test for migration`
- `docs: update AGENTS.md`

### Files to Never Commit

- `.env` — environment variables
- `dist/` — build output
- `node_modules/` — dependencies
- `.sisyphus/` — internal agent state

.gitignore is already configured for all of the above.

### Release Process

1. Update manifest.json version
2. Run `pnpm version-sync`
3. Update CHANGELOG.md
4. Commit: `chore: bump version to X.Y.Z`
5. Build: `pnpm run build`
6. Test: `pnpm test`
7. Tag: `git tag vX.Y.Z`
8. Push: `git push origin main --tags`
9. Generate Zip file with the content of the dist file, no dist dir only files. Name should be streamwatch.vx.x.x.zip. it should not contain system file like .DSStore.
10. Publish the zip file to the GitHub release
