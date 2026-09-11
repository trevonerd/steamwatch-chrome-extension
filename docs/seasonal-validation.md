# Seasonal validation

> Historical report: the trend algorithm described here is superseded by [beta 9 weekly comparison](beta-9-weekly-trend.md). Earlier measured percentages remain evidence of the earlier build.

The seasonal classifier is validated with deterministic synthetic hourly series. These tests cover weekly and night-time usage shapes, sustained matched-hour decline, resilience to one historical spike, future-data exclusion, stale data, low baselines, and sparse comparable hours.

The tests are qualification checks, not a real-world accuracy claim. SteamWatch has no annotated incident dataset, so no precision, recall, or rolling-origin backtest is reported. A future evaluation should use timestamped, independently reviewed game-population incidents and avoid fitting thresholds on the same incidents used for measurement.
