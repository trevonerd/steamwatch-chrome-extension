# Lifecycle and restart validation

The notification lifecycle is covered with in-memory Chrome storage tests. They verify that a durable pending notification ID survives a module reload, failed delivery retains the same ID for retry, and concurrent publication is serialized into one native-delivery attempt.

The executable CDP harness at `.sisyphus/evidence/beta6/qa-restart.cjs` loads the built extension in an isolated Chrome profile, stops its service worker with `ServiceWorker.stopWorker`, and wakes the replacement worker with a runtime message. It records both worker script URLs, then exercises two real `FETCH_NOW` messages through the extension page:

- With provider requests aborted, the response is `ok: false`; cached current `42` remains intact and its current-field freshness becomes `error`.
- With the Steam response restored to `43`, the response is `ok: true`, the cache changes to `43`, and IndexedDB contains a `43` snapshot.

The latest run is recorded in `.sisyphus/evidence/beta6/qa-restart.json`. This validates a Chrome service-worker stop and restart, persisted cache handling, and recovery; it does not claim a real operating-system suspend/resume cycle or a native notification banner.
