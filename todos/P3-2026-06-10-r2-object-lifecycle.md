<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "R2 object lifecycle: scope deleteImage, delete recipe objects on row deletion, fire-and-forget avatar cleanup"
status: backlog
priority: low
created: 2026-06-10
updated: 2026-06-10
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

- [ ] `deleteImage` takes a `kind: "avatar" | "recipe"` param (or equivalent) and verifies the derived key starts with the matching prefix before deleting
- [ ] Recipe deletion paths (`deleteCommunityRecipe`, `deleteMealPlanRecipe`, image replacement) delete the stored R2 object when the URL is R2-based (fire-and-forget, failure must not break the deletion)
- [ ] Avatar routes use `void deleteImage(...).catch(...)` after responding (L5); the rollback path at auth.ts:308 may stay awaited
- [ ] Decide on the pre-fix avatar rekey sweep (do it or document why not)
- [ ] Tests for the prefix guard (wrong-prefix URL → no delete)

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
