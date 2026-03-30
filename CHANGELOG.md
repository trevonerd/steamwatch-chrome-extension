# SteamWatch — Changelog

All notable changes to this project are documented in this file.

## [0.12.0] — 2026-03-30

### Added
- **Price history chart** in the Options History panel — interactive SVG sparkline showing price over time, with a hover tooltip displaying price, date, and source.
- **Record Low** and **All-time Low** price stats in the History panel per game.
- **Price drop alerts** — 💸 push notification when a tracked game hits a new historical low, powered by ITAD (Is There Any Deal) integration.
- **Price history sparkline** in the popup per-game panel with a pill-based graph window selector (24h / 3d / 7d / 15d / 1m).
- **Record low price row** in the popup panel.
- **Favorite game badge** — toolbar badge shows the live player count (short format) of a pinned game instead of the rising/alerting count.
- **IndexedDB storage** (`idb`) for price snapshots — persistent, high-capacity, auto-migrated from `chrome.storage.local` on first launch.
- **Letter placeholder** for games with failed thumbnail images in both popup and options.

### Changed
- Data retention label in Options now reflects the actual compaction window (not a fixed string).
- Popup sparkline tooltip is clamped within the container bounds.
- Trend percentage in the popup badge uses the smoothed trend value.
- Snapshot reads in the Options History panel switch to IndexedDB.

### Fixed
- Spurious `getSettings` call removed from `renderHistory` in options.

---

## [0.11.1] — 2025

### Fixed
- Initial stable release with full feature set through v0.11.

---

## [0.6.0] — 2025

### Added
- **Persistent local all-time peak** — `localAllTimePeak` field accumulated in
  `chrome.storage.local` on every fetch cycle. PK now shows the highest player
  count ever observed locally, independent of SteamSpy availability.
- **Smart 24H avg guard** — 24H average is hidden (`—`) until at least 3 snapshots
  spanning ≥30 minutes are collected, preventing misleading "all values identical"
  display on fresh installs.

### Changed
- **Larger fonts** — base scale bumped to 15px; player count to 20px; game name
  to 15px; stat values to 12px; trend badge to 12px.
- **Peak source priority**: `localAllTimePeak` → SteamSpy `peak_ccu` → local
  snapshot max. All three combined via `Math.max`.

### Fixed
- Peak and 24H values no longer duplicate the current player count on first launch.
- `storage.ts` exports `getCache` (required by background fetch loop).

---

## [0.5.0] — 2025

### Added
- **Fetch status bar** — "🕐 Updated 3 min ago / Updated at 09:42" shown above
  the games list. Timestamp persisted by service worker via `sw_last_fetch`.
- **`setLastFetchTime` / `getLastFetchTime`** — new storage helpers for the
  global last-successful-fetch timestamp.

### Changed
- `showState("loading")` moved before `try` block — guaranteed to run even if
  storage calls fail.
- `.thumb-wrap` + `.thumb-placeholder` replace bare `<img>` — colored initial
  letter shown when the Steam CDN image fails to load.
- `[hidden]` attribute enforced with `!important` to prevent flex/block
  overrides from un-hiding elements.
- `hide()` now uses `setAttribute("hidden")` + `setProperty("display","none","important")`.
- Text hierarchy refactored: 4 levels (`--text`, `--text-2`, `--text-3`, `--text-4`).
- PK/24H labels: `font-weight: 600`, `text-transform: uppercase`, improved contrast.

### Fixed
- Chrome extension MIME error — `base: ""` in `vite.config.ts` produces relative
  asset paths (absolute paths break under `chrome-extension://` protocol).
- Manifest icon paths corrected from `public/icons/` to `icons/`.
- `loading` div starts `hidden` — no flash of spinner before JS runs.
- `ForecastResult` import added to `trend.ts`.
- `tsconfig.json` includes `vitest/globals` type — `beforeEach` no longer errors.

---

## [0.4.0] — 2025

### Added
- **Expandable mini-dashboard** — ▾ button per card reveals a 372×56 sparkline,
  4-stat grid (7d peak · 24h avg · snapshots · 6h forecast), Steam reviews
  (lazy-loaded), and links to Steam Store / SteamDB.
- **Clipboard card share** — ↗ button with two modes:
  - *Copy text*: Discord/Slack-friendly Unicode summary via `writeText()`.
  - *Copy image*: 440×128px dark canvas card via `ClipboardItem`.
- `clipboardWrite` manifest permission.
- `src/utils/card.ts` — `CardViewModel` / `buildCardViewModel()` / `buildAllViewModels()`.
- `src/utils/share.ts` — `buildShareText()` / `renderShareCanvas()`.
- `src/utils/store.ts` — `fetchStoreReviews()` (Zod-validated).
- `mapToPoints()` exported from `sparkline.ts` for shared SVG + canvas rendering math.

---

## [0.3.0] — 2025

### Added
- **Quiet Hours** — suppress notifications between configurable times / weekdays.
- **Dynamic Ranking** — games sorted by current player count; gold/silver/bronze badges.
- **Trend Forecast** — 6-hour projection based on linear regression of recent snapshots.

---

## [0.2.0] — 2025

### Added
- **Dynamic icon badge** — green (rising) or red (alerting) counter on the toolbar icon.
- **Sparkline SVG** — inline player-count history chart on each card.
- **Export CSV / JSON** — download tracked game data from Options.
- **Steam News correlation** — spike notifications include the most recent news headline.

---

## [0.1.0] — 2025

### Added
- Initial TypeScript rewrite of the extension.
- MV3 service worker with alarm-based fetch loop.
- Zod-validated API calls (Steam Web API + SteamSpy).
- Popup with game cards, trend badges, and per-game removal.
- Options page for adding/removing games and configuring notifications.
- 85 unit tests with Vitest.
