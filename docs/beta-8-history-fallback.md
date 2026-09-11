# Beta 8 — Resynced historical fallback

> Historical report: the trend algorithm described here is superseded by [beta 9 weekly comparison](beta-9-weekly-trend.md). Earlier measured percentages remain evidence of the earlier build.

The previous conclusion was too broad: SteamCharts has no usable history for App ID 3751950, but historical observations exist elsewhere. SteamDB displays a 24-hour peak and lifetime record on its [charts page](https://steamdb.info/app/3751950/charts/). Its [FAQ](https://steamdb.info/faq/) does not offer a public history API and restricts automated scraping, so SteamWatch does not scrape it.

## Implemented source

[Games Popularity documents a public hourly history API](https://games-popularity.com/api-docs), including optional-key access at 100 requests per day per IP. The production adapter uses it only after a SteamCharts unavailable/error result. Imports are bounded to two pages, limited to 60 days, and normally repeated at the existing six-hour import cadence. Shared-IP usage or repeated manual retries may still reach the provider limit; failures retain existing history and use the existing retry state. Live counts remain from Steam.

Each response validates the Steam app ID, structure, counts and timestamps. Dates without an explicit zone are interpreted as UTC. A required continuation failure cannot become a successful partial import. Imported observations retain `games-popularity` provenance through IndexedDB, graph eligibility and seasonal analytics. Extension updates retry previously unavailable imports.

## Evidence, 2026-09-11

- Recorded two real pages: 1,528 hourly observations from July 9 through September 11, before the 60-day retention filter.
- Regression replays these responses through the actual persistent import and card model: completed import, all six periods, populated average and ready seasonal analysis.
- Isolated Chrome with real requests, without mocks: Resynced, Dota 2 and Civilization VI all had six enabled periods and current counts; no popup JavaScript errors.
- Resynced detail showed roughly 2.5k current players, 2.8k 24-hour average and a -46.4% seasonal trend at the test snapshot. These are timestamped observations, not promises about later values.
- Strict production build and all 431 tests in 34 files passed. Independent visual review passed; Impeccable detector found no issues.
- vexp reported no parse errors but incorrectly flagged existing TypeScript exports as missing and confused the two `index.ts` files. Source export checks and the strict compiler verified those imports; the full suite covers its listed impacted tests.

## Remaining distinction

The imported hourly samples do not establish SteamDB's lifetime record or its more frequent 24-hour peak. Those provider fields stay unavailable; the detail panel separately shows observed maximum and minimum for the selected period. SteamWatch does not relabel a 60-day maximum as an all-time record.

Build: visible `2.0.0-beta.8`, Chrome numeric `2.0.1.8`. Reload the unpacked extension; use Refresh if an already-open popup still shows the previous import status.
