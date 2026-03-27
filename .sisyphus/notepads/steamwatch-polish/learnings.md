# Learnings — steamwatch-polish

## 2026-03-27T14:05:19Z Session start

### Codebase Conventions
- Package manager: `pnpm` (NOT npm/yarn)
- Test command: `pnpm vitest run` — 390 tests passing at baseline
- Build command: `pnpm build`
- Language: TypeScript strict, no `as any`, no `@ts-ignore`, no empty catch, no console.log in prod
- SVG-only charts — no canvas, no external chart libraries
- CSS custom properties: `--accent`, `--bg-card`, `--border-hover`, `--bg`, `--bg-surface`, `--text-2`, `--text-3`, `--ff-mono`, `--ff-head`, `--r-sm`

### Key File Locations
- `src/options/main.ts` — Options page JS (722 lines). IDB switch targets: line 10 (import), line 577 (renderHistory), lines 694-695 (export)
- `src/options/index.html` — Options HTML (563 lines). Data retention label: line 181. History HTML: lines 373-414. Stats grid: lines 395-411.
- `src/options/options.css` — Options CSS (629 lines). `.history-stats` grid: lines 605-609.
- `src/popup/main.ts` — Popup JS. `attachSparklineHover()`: lines 507-567. Popup imports idbGetSnapshots at line 6-8, uses at line 68.
- `src/popup/popup.css` — `.sparkline-tooltip` CSS: lines 454-471. Image placeholder: lines 195-209.
- `src/popup/thumb.ts` — `thumbColor(appid)` + `wireThumbFallback()` (24 lines)
- `src/utils/idb-storage.ts` — `idbGetSnapshots(appId)` at line 132, `idbGetItadMapping(appId)` at line 175, `idbGetPriceHistory(appId)` at line 215
- `src/utils/trend.ts` — `computeWindowMin(snaps)`, `fmtNumber(n)`
- `src/utils/sparkline.ts` — `findNearestPointIndex(svgX, points)`

### Pre-Existing LSP Errors (DO NOT FIX)
- `src/background/index.ts:204` — exactOptionalPropertyTypes
- `src/popup/main.ts:628` — badgeFavoriteAppid type
- `src/background/fetchCycle.ts:63` — exactOptionalPropertyTypes
- `src/popup/index.html` + `src/options/index.html` — button type attribute warnings

### Patterns
- IDB in popup: `import { idbGetSnapshots } from "../utils/idb-storage.js"` at popup/main.ts:6
- Image placeholder toggle: add `img-error` class to wrap element. CSS hides img, shows placeholder
- History chart dimensions: viewBox 600×160, padX=52, padY=16
- Popup sparkline dimensions: viewBox 372×56, no explicit padding
- `wireThumbFallback(imgEl, wrapEl, appid)` — already imported in options/main.ts from `../popup/thumb.js`
