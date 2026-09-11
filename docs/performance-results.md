# Performance results

The deterministic fixture uses ten games, sixty days of five-minute qualified
Steam observations per game, and 172,800 snapshots total. Measurements ran on
macOS arm64 with Chrome 151 in a temporary extension profile. The browser harness
warms five popup loads and records five measured runs. Its raw output is
`.sisyphus/evidence/final/qa-performance.json`; the reproducible harness is
`.sisyphus/evidence/final/qa-performance.cjs`.

| Browser workload | p50 | p95 | Target | Result |
| --- | ---: | ---: | ---: | --- |
| Cached ten-card popup visible | 67.28 ms | 74.41 ms | 200 ms | Pass |
| Ten-card history hydration complete | 865.27 ms | 878.82 ms | Informational | IndexedDB-bound |
| Expanded-card 24h/7d period switch | 32.83 ms | 33.31 ms | 100 ms | Pass |
| Observed long tasks | none | none | 50 ms | Pass |

The popup first renders cached card values while the local histories load. The
sub-75ms cached-visible result is therefore the user-facing initial response;
the roughly 0.88s hydration result is also reported because it measures the
full IndexedDB read and derived-history render. It is not hidden by the
cache-first stage. No product-code change is proposed from this run: the
hydration work is yielded between cards, and period switches remain below the
main-thread target.

For comparison, the CPU-only harness at
`.sisyphus/evidence/final/perf.ts` runs Node v24.16.0 with an explicit clock.
It reports 41.71ms p95 to build all ten cards, 4.45ms p95 for one card, 26.23ms
p95 for ten graphs, and 3.39ms p95 for one graph. Its raw data is
`.sisyphus/evidence/final/perf.json`.
