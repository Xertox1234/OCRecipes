---
title: Kind-scoped object deletion + post-commit fire-and-forget for R2 lifecycle
track: knowledge
category: design-patterns
module: server
tags: [security, database, performance, r2, idor, fire-and-forget]
applies_to: [server/lib/image-store.ts, server/storage/**/*.ts, server/routes/**/*.ts]
created: '2026-06-11'
---

# Kind-scoped object deletion + post-commit fire-and-forget for R2 lifecycle

## When this applies

Any code that deletes an object-store (R2) object whose key is derived from a
URL — especially when that URL column is client-suppliable (e.g.
`mealPlanRecipes.imageUrl`). Also any DB row deletion or image replacement
that must clean up an associated stored object.

## Rules

1. **Never delete an object-store key derived from a URL without a kind/prefix
   guard.** The AWS SDK enforces no key scoping — the app must.
   `deleteImage(url, kind: "avatar" | "recipe")` maps kind → expected prefix
   (`avatars/`, `recipe-images/`) and silently no-ops if the derived key
   doesn't start with `<prefix>/`. Apply the guard in BOTH the R2 branch and
   the legacy-disk branch. Without it, "delete the image when the row is
   deleted" on a client-suppliable URL is an arbitrary-deletion IDOR.
2. **Wire object cleanup AFTER the transaction commits, fire-and-forget.**
   Capture the URL in the delete's `.returning()` (or a pre-select for
   updates), then `fireAndForget(label, deleteImage(url, kind))` next to the
   existing `removeFromIndex` post-commit precedent. An object-store failure
   must never break the row deletion, and a tx rollback must never have
   already deleted the object.
3. **Respond first, clean up second.** Best-effort cleanup on a response path
   (`await deleteImage(...)` before `res.json()`) adds ~50-300ms of R2
   latency for nothing. Move it after `res.json()` inside `fireAndForget`.
   Exception: rollback of a just-uploaded object on a failure path may stay
   awaited (the failure response should not race its own rollback).

## Why the guard composition is safe (verified in security review)

- S3/R2 keys are opaque literals — `..` is not path-resolved, so
  `recipe-images/../avatars/x` is a distinct nonexistent key, not a traversal.
- Base-URL match requires `url.startsWith(base + "/")` — the mandatory
  trailing slash defeats `img.example.com.evil.com` prefix confusion.
- No decode step runs on the derived key, so `%2e%2e` stays literal.
- Legacy disk branch keeps `path.basename()` AND pins the directory to the
  kind's prefix — cross-prefix disk traversal is doubly blocked.
- `fireAndForget(label, promise)` attaches `.catch` in the same synchronous
  frame as promise creation — no unhandled-rejection window.

## Accepted residuals (documented, do not re-flag)

- Cross-USER deletion within the same kind: a client-supplied
  `recipe-images/<uuid>` URL of another user's object is still deletable on
  row deletion. Keys are unguessable UUIDs; full fix needs per-object
  ownership tracking (out of scope, audit fix is the prefix guard).
- Select-then-update TOCTOU in image-replacement paths: two racing replacers
  both delete the old key; harmless because S3/R2 delete-of-missing-key is a
  no-op.
- Legacy disk unlink swallows errors via inner `.catch(() => {})`
  (pre-existing best-effort semantics; disk mode is legacy/dev-only).
- `deleteImage` no-ops on URLs whose base ≠ current `R2_PUBLIC_BASE_URL` — a
  CDN-domain change orphans prior objects (accepted in audit finding).

## Source

Todo `P3-2026-06-10-r2-object-lifecycle` (audit findings L1/L9/L5,
2026-06-10 full audit); implemented in `server/lib/image-store.ts`,
`server/storage/community-recipes.ts`, `server/storage/meal-plan-recipes-crud.ts`,
`server/routes/auth.ts`.
