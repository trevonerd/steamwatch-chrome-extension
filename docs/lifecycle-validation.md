# Lifecycle and restart validation

## Final beta 11 check

The maintained harness is now `scripts/qa-lifecycle.cjs`. Build first, then run `node scripts/qa-lifecycle.cjs` with Playwright available. `SW_PLAYWRIGHT_PATH` optionally points to an existing Playwright module; `SW_CHROME_PATH` selects Chrome for Testing, and `SW_QA_OUTPUT` selects the report directory (default `.sisyphus/evidence/final`). No personal browser profile is used. The test creates and clears a local test notification when Chrome grants permission.

On September 11, beta 11 passed the restart/offline/recovery scenario below. An additional delivery scenario seeded a persisted threshold crossing from five minutes earlier, then sent two real `FETCH_NOW` messages. Steam responses were controlled, but `chrome.notifications.create` called the real native API: exactly one accepted notification was present in `getAll`, its pending state was acknowledged, and the favorite badge read `43`. The test cleared its notification afterwards. If permission is denied, the report explicitly marks this part blocked.

This establishes native API acceptance and deduplication after a persisted crossing, not visual observation of a macOS banner or a real five-minute wait. The crossing and elapsed time behavior are covered separately by the rule regression tests. Actual OS sleep/resume and banner presentation remain manual acceptance checks.

## Earlier evidence

The notification lifecycle is covered with in-memory Chrome storage tests. They verify that a durable pending notification ID survives a module reload, failed delivery retains the same ID for retry, and concurrent publication is serialized into one native-delivery attempt.

The executable CDP harness at `.sisyphus/evidence/beta6/qa-restart.cjs` loads the built extension in an isolated Chrome profile, stops its service worker with `ServiceWorker.stopWorker`, and wakes the replacement worker with a runtime message. It records both worker script URLs, then exercises two real `FETCH_NOW` messages through the extension page:

- With provider requests aborted, the response is `ok: false`; cached current `42` remains intact and its current-field freshness becomes `error`.
- With the Steam response restored to `43`, the response is `ok: true`, the cache changes to `43`, and IndexedDB contains a `43` snapshot.

The latest run is recorded in `.sisyphus/evidence/beta6/qa-restart.json`. This validates a Chrome service-worker stop and restart, persisted cache handling, and recovery; it does not claim a real operating-system suspend/resume cycle or a native notification banner.
