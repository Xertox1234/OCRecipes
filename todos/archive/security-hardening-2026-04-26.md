---
title: "Security hardening from 2026-04-26 audit"
status: in-progress
priority: high
created: 2026-04-26
updated: 2026-04-26
labels: [security, ai-safety, audit-2026-04-26]
audit_ids: [M2, M3, L15, L16, L18, L19]
---

# Security hardening from 2026-04-26 audit

## Summary

Six security findings. M1 (two-step generate+share atomicity) was fixed in the 2026-04-26 fix pass. These six remain: two AI prompt injection vectors and four lower-severity hardening items.

## Findings (cross-ref `docs/audits/2026-04-26-full.md`)

- **M2** — `dietPreferences` accepts arbitrary strings that flow into the AI prompt. `recipeGenerationSchema` uses `z.array(z.string().max(50)).max(10)`, only length-bounded. The client restricts to 8 known `DIET_OPTIONS`; the server should enforce the same set with `z.enum()` or explicit membership check before `buildDietaryContext()`. Only a regex deny-list stands between a crafted string and the OpenAI system prompt. `shared/schemas/recipe.ts:45`, `server/lib/dietary-context.ts:112–116`
- **M3** — Photo-scan AI output (vision model names) flows into the recipe generation AI prompt without explicit sanitization. `formatIngredientsContext()` assembles vision-model-returned food names into `productName`. The trust boundary between the vision model's output and the recipe-generation prompt is not annotated or validated. `client/components/recipe-generation-utils.ts:29–32`, `server/services/recipe-generation.ts:155`
- **L15** — `barcode` field in `recipeGenerationSchema` uses `z.string().max(100)` with no format constraint. All other barcode-accepting routes use `/^\d{8,14}$/`. Inconsistent validation; should match the project-wide pattern. `shared/schemas/recipe.ts:43`
- **L16** — `shareToPublic` defaults to `true` in `RecipeGenerationModal`. A user generating a recipe from a photo scan (containing health-context ingredient names) defaults to sharing it publicly unless they actively opt out. Privacy-by-default principle suggests the default should be `false`. `client/components/RecipeGenerationModal.tsx:59`
- **L18** — `generate-app-assets.ts`'s `generateImage()` function accepts a caller-supplied `outputPath` and writes to it with `fs.writeFileSync(opts.outputPath, buf)` without validating the path starts within `ASSETS`. Currently safe (hardcoded callers), but a latent path-traversal risk if the function is reused interactively. `scripts/generate-app-assets.ts:38–93`
- **L19** — `POST /api/coach/warm-up` uses `crudRateLimit` (30 req/min) instead of `chatRateLimit` (20 req/min). The warm-up pre-fetches conversation history and builds OpenAI context — as expensive as a chat turn. Should use the tighter limiter to prevent cheap token-burn abuse. `server/routes/coach-context.ts:93`

## Acceptance Criteria

- [ ] `dietPreferences` validated against the allowlist of known diet options on the server (same set as client `DIET_OPTIONS`)
- [ ] Photo-scan food names sanitized before assembly into `formatIngredientsContext()`, or the trust-boundary is explicitly documented with a code comment and server-side `sanitizeUserInput` call is confirmed sufficient
- [ ] `barcode` in `recipeGenerationSchema` validated with `/^\d{8,14}$/` pattern
- [ ] `shareToPublic` default changed to `false` in `RecipeGenerationModal`
- [ ] `generateImage()` in `generate-app-assets.ts` validates `outputPath` starts with `ASSETS` before writing
- [ ] `POST /api/coach/warm-up` uses `chatRateLimit` instead of `crudRateLimit`
- [ ] All existing tests pass

## Implementation Notes

- M2: The `DIET_OPTIONS` constant is defined client-side. Move it to `shared/` (or duplicate in `shared/schemas/recipe.ts`) so both client Zod schema and server schema can reference the same enum values.
- M3: Server-side `sanitizeUserInput()` already runs on `productName` (recipe-generation.ts:155). The key question is whether that covers AI-generated text containing novel injection patterns. A conservative approach: add an explicit comment at the assembly point in `formatIngredientsContext` noting that inputs are AI-generated (not direct user input) and that `sanitizeUserInput` is the trust boundary.
- L19: One-line change — swap `crudRateLimit` for `chatRateLimit` at line 93.
