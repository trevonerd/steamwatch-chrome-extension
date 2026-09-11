# Beta 7: segmented graph colors

Visible version: `2.0.0-beta.7`. Chrome upgrade version: `2.0.1.7`.

Popup sparklines, expanded graphs, and shared PNGs now use the same interval-color function. Changes between plotted observations of at least 2% are green or red; changes of at least 8% use the stronger existing shade. Smaller changes are cyan. A rise from zero is green. These colors describe the plotted intervals, not the seasonally adjusted trend in the badge. The SVG title explains the distinction.

Consecutive intervals with the same color share a stroke. Gaps remain disconnected, and singleton observations remain visible. Time coordinates, downsampling limits, period eligibility, and seasonal analytics are unchanged.

Validation on 2026-09-11:

- Strict TypeScript and production build passed.
- All 418 tests in 32 files passed, including the regression that failed with the previous single-color renderer.
- Isolated Chrome QA passed: Resynced unavailable-history message, six periods for the original Black Flag, selected-period statistics, both rising and falling SVG colors, shared PNG generation, below-player threshold saving, and no popup JavaScript errors.
- The visual harness reuses the recorded Black Flag response with timestamps shifted to the test run to avoid an aging fixture disabling fresh-history filters. This is a deterministic UI check, not a new live-provider measurement. Actual provider results are documented in `beta-6-live-validation.md`.
- Impeccable's mechanical detector reported no findings for the changed renderer files. Popup and shared image were visually inspected.
- vexp completion verification was attempted but its daemon was unavailable; compiler, tests, browser checks and diff validation supplied the verification instead.

The known provider and validation limits in `beta-6-live-validation.md` and `lifecycle-validation.md` still apply. No claim is made of perfect real-world false-alert calibration, operating-system suspend/resume coverage, or native notification-banner testing.
