# Recorded provider fixtures

`black-flag-history.json`: public SteamCharts response from
https://steamcharts.com/app/242050/chart-data.json, recorded on 2026-09-11.
932 rows, including roughly 30 days of hourly observations and an older monthly-peak prefix.
Used with a pinned evaluation time in `black-flag-history.test.ts`.
The fixture is input data, not a guarantee of current provider availability.

`resynced-games-popularity.json`: two public responses from
https://games-popularity.com/swagger/api/game/players/3751950 (second request follows `nextCursor`), recorded on 2026-09-11.
1,528 hourly observations, used at a pinned UTC evaluation time in `resynced-fallback.test.ts`.
Provider dates without an explicit zone are UTC; they must not be interpreted in the browser's local timezone.
