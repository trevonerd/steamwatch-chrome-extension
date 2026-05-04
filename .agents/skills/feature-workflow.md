# Feature Workflow

## When to Use
Adding a new feature to SteamWatch.

## Steps

1. **Scope** — Define what the feature does, which components it touches (background/popup/options)
2. **Types first** — Add/update types in `src/types/index.ts`. Use Zod schemas for any new API data
3. **Implement** — Follow existing patterns:
   - DOM manipulation via `src/utils/html.ts` helpers (XSS-safe, no `innerHTML`)
   - Storage via `src/utils/storage.ts` (chrome.storage.local) or `src/utils/idb-storage.ts` (IndexedDB)
   - API calls in `src/utils/api.ts` with Zod validation at the boundary
4. **Test** — Write tests in `tests/` mirroring `src/` structure. Cover happy path + error cases
5. **Build** — `pnpm run build` — zero type errors
6. **Test** — `pnpm test` — all pass
7. **Manual test** — Load `dist/` in Chrome, verify feature works end-to-end

## Conventions
- No frameworks — vanilla TypeScript + DOM helpers
- Template literals for all string interpolation and console logging
- Relative imports only (no path aliases)
- TypeScript strict mode — no `any`, no `@ts-ignore`
- Add new dependencies sparingly — prefer built-in APIs
