---
title: "Fix TypeScript config for standalone file type-checking"
status: resolved
priority: low
created: 2026-03-25
updated: 2026-03-25
assignee:
labels: [dx, tooling, typescript]
---

# Fix TypeScript Config for Standalone File Type-Checking

## Summary

Running `tsc --noEmit` on individual files (e.g. `npx tsc --noEmit client/screens/SavedItemsScreen.tsx`) fails with path alias resolution errors (`@/` and `@shared/` not found) and `esModuleInterop` issues. The project-wide `npm run check:types` works correctly because it reads `tsconfig.json` — the issue is only when type-checking individual files directly.

## Background

Discovered during skeleton loading states implementation (2026-03-25). Not blocking since `npm run check:types` works, but it would improve DX to have per-file type-checking work.

## Resolution

**Won't fix — by design.** TypeScript ignores `tsconfig.json` (including `paths` and `esModuleInterop`) when file arguments are passed directly to `tsc`. This is intentional `tsc` behavior, not a config issue.

**Workaround:** Use `npm run check:types` (which runs `tsc -p . --noEmit`) for all type-checking. This checks the whole project with full path alias resolution and is fast enough for this codebase size.
