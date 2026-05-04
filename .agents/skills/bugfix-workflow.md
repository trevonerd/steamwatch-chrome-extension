# Bugfix Workflow

## When to Use
Fixing a bug in SteamWatch.

## Steps

1. **Reproduce** — Understand the exact failure. Check console logs (remember: objects render as `[object Object]` in extension logs)
2. **Locate** — Find the relevant code. Tests mirror `src/` in `tests/`
3. **Fix minimally** — Change only what's needed. NEVER refactor while fixing
4. **Write regression test** — Every bugfix MUST have a test that would have caught it
5. **Run tests** — `pnpm test` — all must pass
6. **Check types** — `pnpm run build` or LSP diagnostics — zero errors
7. **Bump PATCH version** — Follow release-checklist if shipping immediately

## Common Bug Patterns

### Console logging objects
```typescript
// Bug: renders as [object Object]
console.error("error:", err);
// Fix: use template literals
console.error(`error: ${JSON.stringify(err)}`);
```

### Migration count mismatch
```typescript
// Bug: fails when bootstrap writes concurrently
if (stored.length !== expectedCount) { /* fail */ }
// Fix: IDB may have MORE snapshots than expected
if (stored.length < expectedCount) { /* retry */ }
```

### Vite base path
```typescript
// Bug: absolute paths break chrome-extension:// protocol
base: "/"
// Fix: empty string
base: ""
```
