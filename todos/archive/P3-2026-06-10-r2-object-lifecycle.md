<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "R2 object lifecycle: scope deleteImage, delete recipe objects on row deletion, fire-and-forget avatar cleanup"
status: done
priority: low
created: 2026-06-10
updated: 2026-06-11
assignee:
labels: [deferred, security, database, performance]
github_issue:

---

# R2 object lifecycle hardening

## Summary

Three related R2 storage-lifecycle gaps deferred from the 2026-06-10 full audit
(findings L1, L9, L5): `deleteImage()` deletes any bucket object derivable from
a URL with no prefix scoping; recipe deletion never deletes the recipe's R2
object (durable billed objects accumulate); avatar routes `await` best-effort
R2 cleanup on the response path.

## Background

- **L1 (security footgun):** `server/lib/image-store.ts` `deleteImage(url)`
  derives the key by stripping `R2_PUBLIC_BASE_URL` and deletes with no
  prefix/kind constraint. Current callers are safe (server-written avatar URLs
  only), but `mealPlanRecipes.imageUrl` is client-suppliable — the obvious
  future feature ("delete the recipe image when the recipe is deleted") becomes
  an arbitrary-deletion IDOR. AWS SDK provides no key-prefix enforcement; the
  app must.
- **L9 (object leak):** `deleteCommunityRecipe` / `deleteMealPlanRecipe` /
  image replacement never call `deleteImage` — post-R2 these are durable,
  billed objects that accumulate forever. Note `deleteImage` also silently
  no-ops on URLs whose base doesn't match the CURRENT `R2_PUBLIC_BASE_URL`
  (CDN-domain change would orphan all prior objects).
- **L5 (latency):** `server/routes/auth.ts:255,314,349` await the best-effort
  R2 `DeleteObjectCommand` (~50-300ms) before `res.json()` despite documented
  fire-and-forget semantics.
- **Review follow-up (2026-06-10 security review):** avatars uploaded BEFORE
  the randomUUID key fix still sit on the public CDN under
  `{userId}-{timestamp}` keys — consider a one-shot rekey (copy to UUID key,
  update users.avatarUrl, delete old object).

## Acceptance Criteria

- [x] `deleteImage` takes a `kind: "avatar" | "recipe"` param (or equivalent) and verifies the derived key starts with the matching prefix before deleting
- [x] Recipe deletion paths (`deleteCommunityRecipe`, `deleteMealPlanRecipe`, image replacement) delete the stored R2 object when the URL is R2-based (fire-and-forget, failure must not break the deletion)
- [x] Avatar routes use `void deleteImage(...).catch(...)` after responding (L5); the rollback path at auth.ts:308 may stay awaited
- [x] Decide on the pre-fix avatar rekey sweep (do it or document why not)
- [x] Tests for the prefix guard (wrong-prefix URL → no delete)

## Implementation Notes

- L1 fix shape: `deleteImage(url, kind)` mapping kind → expected key prefix (`avatars/`, `recipe-images/`); same prefixes used by the legacy disk branch.
- L9 must be implemented AFTER L1's scoping (deleting from a client-suppliable `imageUrl` without the prefix guard is the exact IDOR L1 warns about).
- MiniSearch/index cleanup ordering precedent in `server/storage/community-recipes.ts` — keep object deletion outside the tx.

## Dependencies

- None.

## Risks

- L9 without L1 creates the IDOR — land them together.

## Updates

### 2026-06-10

- Initial creation — deferred from 2026-06-10 full audit (L1, L5, L9 + review suggestion).

### 2026-06-10 (resolution)

- L1: `deleteImage(url, kind: "avatar" | "recipe")` now enforces the matching
  key prefix (`avatars/`, `recipe-images/`) in BOTH the R2 and legacy-disk
  branches; non-matching keys are a silent no-op.
- L9: `deleteCommunityRecipe` / `deleteMealPlanRecipe` capture `imageUrl` in
  the delete's `.returning()` and fire-and-forget `deleteImage(..., "recipe")`
  AFTER the transaction commits (next to the existing `removeFromIndex`
  precedent). Image replacement paths (`updateMealPlanRecipe`,
  `updateCommunityRecipeImageUrl`) capture the previous URL and clean up the
  replaced object the same way.
- L5: the three auth.ts avatar-cleanup sites now respond first, then run
  `fireAndForget("...", deleteImage(..., "avatar"))` (equivalent to
  `void ...catch(...)`, plus failure logging — house style). The upload
  rollback path stays awaited.
- **Rekey sweep decision: NOT doing it.** The `{userId}-{timestamp}` key
  window is tiny — R2 went live in PR #385 and the randomUUID key fix landed
  in PR #392 the same audit cycle (~2 days), the mobile client has not
  shipped, and the disk→R2 migration script already used non-reversible
  hash-derived keys. The affected set is near-zero; a one-off prod check
  (`SELECT id, avatar_url FROM users WHERE avatar_url ~ '/avatars/[0-9a-f-]{36}-[0-9]+\.'`)
  - manual re-upload covers any stragglers without a sweep script. Note:
    `deleteImage`'s base-URL match means a future CDN-domain change would
    orphan prior objects — acceptable, documented in the audit finding.

### 2026-06-11 (verification + review)

- Verified: scoped tests (35 files / 775 tests) green, `tsc --noEmit` clean,
  ESLint clean on all six changed files.
- Review cycle (code-reviewer + security-auditor, 1 round): security found no
  exploitable findings (prefix guard verified against traversal, encoding,
  base-URL confusion, double-slash/case bypasses; no unhandled-rejection
  window; no auth weakening). Code review: 1 Medium accepted (select-then-
  update TOCTOU in image-replacement paths — harmless, R2 delete of missing
  key is a no-op, internal-only patcher), 1 Low accepted (legacy disk unlink
  swallows errors via pre-existing inner `.catch(() => {})` — unchanged
  best-effort semantics, disk mode is legacy/dev-only).
- Solution codified:
  `docs/solutions/design-patterns/kind-scoped-object-deletion-r2-lifecycle-2026-06-11.md`.

- Residual (accepted, surfaced to orchestrator): the `recipe` prefix guard
  blocks cross-KIND deletion, but a meal-plan recipe's client-suppliable
  `imageUrl` pointed at another user's known `recipe-images/` object would
  still delete that object on recipe deletion. Keys are unguessable UUIDs and
  only leak via shared/community images; full fix would require per-object
  ownership tracking (out of audit scope — audit's stated fix is the prefix
  guard).
