# Beta 10: useful activity with limited history

The visible version is `2.0.0-beta.10` (Chrome numeric version `2.0.1.10`).

## Progressive interpretation

Limited imported history does not prove that a game has just launched. The UI therefore describes the available observations, without inferring a release date.

- Before a daily comparison is supported: show current players separately, observation count, elapsed span between observations, and observed minimum/maximum. Elapsed span is not continuous coverage. No growth percentage is invented.
- With two sufficiently covered days: compare the last 24 completed UTC hours with the preceding 24, using at least 20 matching hourly pairs and requiring the final pair. Show paired means, dates, coverage, and an explicit preliminary label.
- With sufficient two-week coverage: use the weekly model documented in [beta 9](beta-9-weekly-trend.md). The daily descriptive panel gives way to the weekly comparison.

Daily matching reduces ordinary within-day timing bias, but cannot establish weekday/weekend patterns or separate launch effects from lasting changes. These limitations are visible in the detail panel. A baseline below ten average players uses an absolute change; zero to five becomes `+5 avg players`, never an infinite percentage. Stale history is identified and does not produce a daily comparison.

Early activity is only a display model. It never feeds trend notifications or their state machine. Absolute player-count thresholds remain available independently. Even mature weekly changes describe observed concurrent activity, not a causal claim about individual player retention.

## Verification

- Production build and strict TypeScript validation passed.
- All 458 tests across 35 files passed, including ten early-activity cases and a popup regression.
- Isolated Chrome with controlled API responses verified first-hours collection, a repeating day/night cycle producing 0%, zero-to-five absolute change, shared PNG output, and the visible beta version. No page errors were recorded.
- Screenshots were captured after expansion animations settled. Evidence is retained locally under `.sisyphus/evidence/beta10/`.
- vexp verification reported no parse errors or broken imports. All identified test dependents passed; the live-provider script remains compatible with the optional view-model addition.

These controlled scenarios verify cold-start behavior. They do not measure a real-world false-alert rate or replace the remaining native notification and sleep/resume release acceptance checks.
