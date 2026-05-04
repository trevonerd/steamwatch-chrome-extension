# Release Checklist

## When to Use
Releasing a new version of SteamWatch.

## Steps

1. **Decide version bump** — PATCH (bugfix), MINOR (feature), MAJOR (breaking)
2. **Update `manifest.json`** — Change `"version"` field
3. **Run `pnpm version-sync`** — Syncs version to package.json
4. **Update `CHANGELOG.md`** — Add entry under new version heading, follow Keep a Changelog format
5. **Build** — `pnpm run build` (prebuild hook runs version-sync automatically)
6. **Test** — `pnpm test` — all 289+ tests must pass
7. **Commit** — `git commit -m "chore: bump version to X.Y.Z"`
8. **Tag** — `git tag vX.Y.Z`
9. **Push** — `git push origin main --tags`

## Verification
- `manifest.json` version matches `package.json` version
- CHANGELOG.md has entry for new version
- Build output in `dist/` is fresh
- All tests pass
- Git tag exists and matches version
