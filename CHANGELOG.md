# SteamWatch — Changelog

All notable changes to this project are documented in this file.

## [2.0.0-beta.10] - 2026-09-11

### Added
- Useful limited-history context: observation count, elapsed span and observed range before a daily comparison is possible
- Preliminary matched-hour 24h-vs-previous-24h activity for games with two sufficiently covered days; low baselines use absolute changes instead of misleading percentages

### Fixed
- Keep launch activity, missing history and mature weekly trends distinct in popup and sharing; preliminary changes never trigger structural trend alerts

### Changed
- Visible version is `2.0.0-beta.10`; Chrome numeric version is `2.0.1.10`

## [2.0.0-beta.9] - 2026-09-11

### Fixed
- Replace the distant multi-week trend baseline with average players over the last seven days versus the immediately preceding seven days, pairing the same UTC hours and weekdays
- Stop describing old launch-period losses as an ongoing decline after the population stabilizes
- Prevent isolated daily events and pending notifications from the old algorithm from producing sustained-trend alerts

### Added
- Explicit `7d` badge and detail breakdown with matched means, comparison dates, coverage and confirming days
- Regressions for Black Flag's recorded history, stabilization, night/weekend cycles, one-day events, zero counts, source transitions and rounding boundaries

### Changed
- Trend notifications and shared cards name the weekly comparison; at least five days must show a material change in the same direction for trend alerts
- Visible version is `2.0.0-beta.9`; Chrome numeric version is `2.0.1.9`

## [2.0.0-beta.8] - 2026-09-11

### Fixed
- Import hourly history from Games Popularity when SteamCharts is unavailable or fails, including Black Flag Resynced
- Qualify fallback observations for graph periods, averages, observed extrema and seasonal trends while preserving source identity
- Retry unavailable historical imports when the extension updates

### Added
- Bounded two-page historical API requests, UTC date validation, and source attribution in graph details
- Recorded Resynced API regression covering persistent import, all six periods and seasonal analysis

### Changed
- Visible version is `2.0.0-beta.8`; Chrome upgrade version is `2.0.1.8`
- Added Games Popularity host permission and privacy disclosure; no account or API key required

## [2.0.0-beta.7] - 2026-09-11

### Fixed
- Restore rising, falling and near-flat colors per plotted interval in popup graphs and shared images, independently of the seasonal trend badge
- Keep missing-history gaps disconnected and isolated observations visible in both renderers

### Changed
- Visible version advances to `2.0.0-beta.7`; Chrome numeric upgrade version is `2.0.1.7`

### Added
- Regression coverage for alternating colors, grouped strokes, gaps and zero player counts

## [2.0.0-beta.6] - 2026-09-11

### Fixed
- Steam titles containing typographic apostrophes now resolve their Twitch categories, including Black Flag and Civilization VI

### Added
- Opt-in real-provider diagnostic with a recorded random selection, raw response capture, period coverage and historical replay checks
- Regression replay for ten actual Steam titles: nine distinct hourly histories and Resynced's empty response
- Pending-notification persistence test across a worker module reload and an isolated Chrome worker-restart harness

### Changed
- Visible version advances to `2.0.0-beta.6`; Chrome numeric upgrade version is `2.0.1.6`

## [2.0.0-beta.5] - 2026-09-11

### Fixed
- Black Flag Resynced's missing provider history is distinguished from failed imports; legacy points cannot create confident averages, trends, or a provider all-time record
- Selected graph periods update their statistics from the same snapshot revision; missing intervals remain gaps and timestamps control horizontal spacing
- Favorite changes update the badge from cache without starting a full network refresh

### Added
- Seasonal trend compares seven complete days with matching hours and weekdays in preceding weeks, gated by source quality, coverage, freshness, and baseline size
- Independent above/below player-count and seasonal threshold crossings with persistence, hysteresis, restart-safe pending events, delivery retry, and quiet hours
- Observed peak labels, timestamp tooltips, hourly coverage, explicit unavailable trend states, and gap-aware shared images

### Changed
- Hourly normalization is reused across each card's analytics; graph output has a global point budget and rendering yields between games
- Visible version is `2.0.0-beta.5`; Chrome's numeric upgrade version is `2.0.1.5`
- Trend thresholds remain beta defaults: synthetic qualification does not establish real-world false-alert rates

## [2.0.0-beta.4] - 2026-09-11

### Fixed
- Manual Refresh retries failed history imports immediately instead of waiting for the automatic retry delay
- Active imports, completed-history cache lifetimes, removed games, and provider rate limits remain protected
- Unavailable periods remain visible with an explanation in the details panel

### Added
- Recorded Black Flag history regression covering failed import, recovery, and all six graph periods

### Changed
- Chrome numeric version is `2.0.1.4`; this is a history-recovery fix before phase 4, not the seasonal-trend update

## [2.0.0-beta.3] - 2026-09-11

### Added
- Shared refresh coordinator with progressive live counts, independent metadata jobs, and per-field source/freshness
- Visible-popup refresh every minute and storage events that update open details after remote history imports
- Bounded HTTP concurrency, response/body deadlines, one transient retry, and per-origin Retry-After cooldowns

### Fixed
- Overlapping opening, manual, and alarm requests share the same live cycle
- Failed requests preserve the age of retained data; live attempt and success timestamps are separate
- Popup shows cached values during automatic refresh and preserves expanded details and selected periods
- Missing Twitch metadata no longer causes repeated live refreshes on every popup opening

### Changed
- Visible beta version stays on `2.0.0-beta.N`; Chrome numeric version is `2.0.1.3` to remain above the previously loaded build
- This checkpoint covers phase 3; seasonal trends, notification rules, and full graph semantics remain in subsequent phases

## [2.0.1-beta.2] - 2026-09-11

### Fixed
- Failed history imports can retry instead of being blocked by a ten-year bootstrap marker
- Historical imports are deduplicated and committed with their completion state
- Snapshot compaction preserves aggregate extrema and weights in an atomic transaction
- Interrupted game removal and legacy migration can resume without silently marking failures complete
- Minimum and maximum calculations retain compacted extrema, including real zero-player observations

### Changed
- Persist source and resolution for new samples; retain legacy data with unknown quality
- Refresh remote history periodically and distinguish hourly observations from monthly peaks
- Imported and legacy history alone cannot qualify trend notifications
- Chrome numeric version is `2.0.1`; trend seasonality and the complete graph redesign remain in later phases

## [2.0.0-beta.1] - 2026-09-11

### Added
- Visible installed build version in the popup footer and beta labels in Options/About
- Strict TypeScript check required before production builds

### Fixed
- Steam AppDetails responses with dynamic app IDs are parsed correctly
- Malformed stored games, cache entries, notification overrides, and quiet-hour values are recovered at the storage boundary
- Popup update status remains visible and uses the timestamp after hydration
- Background refresh failures show an error and allow retry instead of appearing successful

### Changed
- Started the v2 beta sequence for individually identifiable review builds; Chrome numeric version is `2.0.0`
- This beta includes phase 1 only; history, trend, and notification redesign remain pending

## [0.14.7] - 2026-06-04

### Changed
- Refreshed the SteamWatch extension icons with a more polished eye mark across all packaged Chrome icon sizes

---

## [0.14.6] - 2026-06-04

### Fixed
- Retention stats now use the available local history inside the retention window instead of showing `—` until the full window is covered
- Retention stat labels now reflect the actual covered period, such as `5d average` for games with less than 60 days of data
- Popup graph hover tooltip now has proper vertical padding

### Changed
- Cleaned up extension internals and removed stale utility/test code after the player-only simplification

---

## [0.14.5] - 2026-05-05

### Fixed
- Trend indicator now reflects the true 24h trajectory instead of a ~90-minute micro-window
  - Old logic compared the last 3 snapshots vs the previous 3 (~90 min total), causing a
    collapsed game (e.g. peak 41 → current 8) to show +60% "Explosion" due to local noise
  - New logic splits all available 24h snapshots into two time-based halves and compares
    their averages, so a collapse correctly shows Strong Drop and a genuine spike correctly
    shows Explosion / Rising
  - Notifications triggered by `trend.pct` thresholds are now accurate as a result

---

## [0.14.4] - 2026-05-05

### Changed
- Removed one-time image URL migration (no longer needed)

---

## [0.14.3] - 2026-05-05

### Fixed
- Game thumbnails now load correctly for all games, including newer titles (Marathon, Windrose, Last Flag)
  - Search results use the `tiny_image` field from the Steam search API, which includes a content hash and works universally
  - Images that fail to load trigger a fallback that fetches the correct URL from the Steam appdetails API and persists it
  - Fixed a storage key mismatch (`"games"` vs `"sw_games"`) that prevented fallback URLs from being saved
  - Added `shared.akamai.steamstatic.com` to manifest host_permissions for the new CDN domain
- Added one-time image URL migration: on extension startup, existing games with stale CDN URLs are automatically updated via the Steam appdetails API

---

## [0.14.1] - 2026-05-04

### Changed
- Increased game limit from 5 to 10

---

## [0.14.0] - 2026-05-04

### Removed
- All price tracking: fetchPriceData, PriceOverviewSchema, price notifications
- ITAD integration: itad-api.ts deleted, price history stores removed
- Price types: PriceState, PriceRecord, SpikeResult
- Spike/crash notification types (merged into trend)
- Price UI elements from popup and options pages
- clipboardWrite permission, unused host domains from manifest
- IsThereAnyDeal About section

### Changed
- DB_VERSION bumped to 3 (drops orphaned price/ITAD stores)
- Default fetch interval: 15 → 30 minutes
- Default data retention: 7 → 30 days (max 60)
- Notification system: 3 types (trend_up, trend_down, absolute)
- Manifest permissions minimized for faster CWS review

### Fixed
- Options page thumbnail now uses cached game.image (was hardcoded CDN URL)
- About section cleaned up, added Marco Trevisani + Trevisoft links

---

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
