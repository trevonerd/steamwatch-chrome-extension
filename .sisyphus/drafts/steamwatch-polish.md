# Draft: SteamWatch Post-Evolution Polish & Fixes

## User Feedback (verbatim)

1. **Tooltip too small**: "pls make the container of the value on hover bigger, now the text is bigger then the container"
2. **No price info visible**: "i cant find any info about the prices"
3. **Options History panel needs upgrade**: "u have to update also the history pannel under the options because i need dinamic colors, hover etc… and all the information needed!"
4. **Game images missing in options**: "in the game list under options some games dont have the img!" — Marathon (3065800), Paladins (444090), Overwatch (2357570), Crimson Desert (3321460) — some show, some don't
5. **Options page data settings**: User showed Data retention at 7 days, Fetch interval at 15 min — needs review for consistency with the new compaction-based (no-purge) system

## F3 Scope Fidelity Finding

- **T7 REJECT**: `src/options/main.ts` still uses `getSnapshotsForGame` from `storage.ts` (chrome.storage.local) instead of IndexedDB. Lines 10, 577, 694-695. The plan required ALL snapshot consumers to switch to IndexedDB. This directly explains why History in options is broken/incomplete — it's reading from the old store which gets migrated away.

## Verification Wave Status

- **F1**: ✅ APPROVE (re-run after fixes) — 9/9 Must Have, 8/8 Must NOT Have, 14/14 deliverables
- **F2**: ✅ APPROVE — Build PASS, 390/0, 15 files clean, 0 issues
- **F3**: ❌ REJECT — T7 incomplete: options/main.ts snapshot reads not migrated to IDB
- **F4**: (replaced by F3 scope fidelity — covers the same concern)

## Research Findings

### Tooltip Sizing (from explore)
- CSS: `.sparkline-tooltip` has `font-size: 10px`, `padding: 2px 6px`, `white-space: nowrap`, NO explicit max-width
- Content: `fmtNumber(snap.current)` — just a formatted number like "1,234" or "45,678"
- Position logic: `pctX > 70 ? pctX - 6 : pctX` — only 6% shift for edge avoidance
- **Root cause**: No overflow protection. Large numbers or edge positions cause text to overflow container
- **Fix**: Add smart positioning that accounts for tooltip width + edge clamping

### Options Page (pending explore results)
- Need to understand: History panel structure, game list image rendering, Data retention setting interaction with compaction

## Issues to Fix

### CRITICAL
1. **Options snapshot reads → IDB** (F3 finding): Switch `getSnapshotsForGame` calls in `options/main.ts` to `idbGetSnapshots` from `idb-storage.ts`
2. **Options History panel**: Needs dynamic colors, hover, price info — currently just a basic table/graph?

### UI POLISH
3. **Tooltip overflow**: Make tooltip container responsive to text width
4. **Game images in options**: Some games missing thumbnail images

### SETTINGS REVIEW
5. **Data retention setting**: Does it still make sense as "7 days" when compaction preserves data forever? Should the label/description be updated?

## Open Questions
- What exactly does the History panel in options currently show? (waiting on explore)
- How are game images loaded in the options tracked games list? (waiting on explore)
- Does "Data retention" still trigger purge, or has compaction fully replaced it?

## Technical Decisions (pending)
- (pending) How extensive should the options History panel upgrade be?
- (pending) Should the Data retention setting be renamed/repurposed?
