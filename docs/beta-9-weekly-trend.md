# Beta 9 — explainable weekly activity

## Defect and replacement

The beta 8 `-46.4%` figure compared recent hours against a median of several older weeks. This described a longer-term level difference, not a clearly defined recent rate. In particular, a game stable for two weeks after a large launch decline could still be classified as falling. Three failing regressions reproduced this and the overweighting of percentage changes during quiet hours.

The primary metric now answers: **How much did average concurrent activity change over the last seven days compared with the previous seven days?** It does not measure unique players lost, causal organic decline, the current count's distance from a daily peak, or an instantaneous crash.

## Calculation contract

- End at the latest completed UTC hour. Current window `[end - 7 days, end)`, reference `[end - 14 days, end - 7 days)`.
- Pair each current hour with exactly the same UTC hour one week earlier. Qualified sources retain their provenance. Only the paired hours contribute to either mean; days/nights/weekends align.
- Require at least 80% matched coverage and 20 matched hours on every day. Require the last completed hour and its reference counterpart, plus an observation no older than two hours. Missing coverage means unavailable, not stable.
- Compute `100 × (current matched mean / previous matched mean - 1)`. Delta is the difference in means. Baseline average below 10 yields unavailable. Real zero observations are retained; a full fall to zero produces -100%.
- Round to one decimal consistently for classification and daily agreement. Existing stable range is -5% inclusive to +5% exclusive.
- At least five of seven paired days must independently exceed the material direction boundary (+5% or below -5%) for a sustained trend alert. Otherwise the weekly percentage stays visible as **Uneven week**, with neutral styling and no trend alert. This avoids relabeling a one-day event as sustained loss or growth.
- The rule fingerprint changes to `weekly-v2`; old pending trend alerts are re-primed as new observations, not delivered under the new definition. Absolute-count rules retain their state.

The badge, detail explanation, share image/text and notifications name the same comparison. The detail comparison is fixed at seven days and does not change when the user selects a different graph range.

## Recorded and live evidence

The saved Black Flag Resynced response evaluated at 2026-09-11 10:40 UTC has **166 paired hours**: 3,786.6687 current-week average versus 4,769.8675 previous-week average, yielding **-20.6%**. A simple raw-row average gives about -20.5%; the small difference is due to hourly normalization and identical-pair selection.

An isolated Chrome run with real APIs at approximately 14:06 UTC showed **3,767 versus 4,746.7**, again **-20.6%**, with all seven days confirming a decline and current players around 3.7k. Thus the historical weekly decline is real in this sample, while the earlier -46% magnitude used an unsuitable baseline for this label.

Validation includes 447 passing tests across 34 files, strict build, real Chrome checks for Resynced/Dota 2/Civilization VI, and independent visual review. Synthetic checks cover stabilization after launch, repeated daily/weekly patterns, persistent loss, a full crash to zero, sparse/stale endpoints, provider transitions and rounding boundaries. These deterministic tests establish the metric contract, not a general event-classification accuracy claim.

## Production checks advanced

A new ten-game performance run used 172,800 five-minute snapshots over 60 days. Across five measured runs after five warmups: cached cards p95 178.44 ms (target 200), hydrated history p95 974.11 ms, graph-range switching p95 67.06 ms (target 100), no recorded long tasks. These are local Chrome measurements, not network latency promises.

Remaining stable-release gates: user acceptance of the clearly labeled metric; native notification/OS sleep-resume acceptance; final package and store/privacy review. No stable tag, store submission or claim of independently calibrated false-alert accuracy is made by this beta.

vexp completion verification found no parse errors and listed tests covered by the full suite. Its missing `CachedDataSchema` import report is an index false positive: the export exists in `src/types/index.ts:157` and strict TypeScript resolves it. Unchanged callers retain the same API and consume the revised shared result.
