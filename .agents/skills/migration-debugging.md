# Migration Debugging

## When to Use
Debugging issues with the chrome.storage.local → IndexedDB migration system.

## Architecture

- **Migration code**: `src/utils/migrate.ts`
- **IDB wrapper**: `src/utils/idb-storage.ts`
- **Sentinel key**: `sw_migration_complete` in chrome.storage.local
- **Flow**: Service worker checks sentinel → if absent, migrates snapshots → verifies counts → sets sentinel

## Common Issues

### Migration re-runs every refresh
**Cause**: Sentinel never set because verification fails.
**Check**: Count comparison logic. IDB may have MORE snapshots than chrome.storage.local due to concurrent bootstrap writes.
**Fix**: Use `<` not `!==` for count checks: `if (idbCount < expectedCount)`

### Logs show `[object Object]`
**Cause**: Chrome extension console renders objects as `[object Object]` when passed directly.
**Fix**: Use template literals: `` console.error(`migration error: ${JSON.stringify(err)}`) ``

### Data appears missing after migration
**Check**: 
1. Is sentinel set? Look for `sw_migration_complete` in chrome.storage.local
2. Are snapshots in IDB? Check via DevTools → Application → IndexedDB
3. Is the IDB database name correct? Check `src/utils/idb-storage.ts` for DB name

## Debugging Steps

1. Open extension service worker DevTools (chrome://extensions → Inspect views)
2. Check console for migration logs
3. Check Application → Storage → chrome.storage.local for sentinel
4. Check Application → IndexedDB for snapshot data
5. To force re-migration: remove `sw_migration_complete` key and reload extension
