---
title: "Migrate disk image storage (avatars + recipe images) to Cloudflare R2"
status: backlog
priority: medium
created: 2026-05-24
updated: 2026-05-24
assignee:
labels: [architecture, api, security, infrastructure]
github_issue:
---

# Migrate disk image storage (avatars + recipe images) to Cloudflare R2

## Summary

Move persisted image storage off the local filesystem (`uploads/`) and onto
Cloudflare R2 (S3-compatible, zero egress). Today avatars and AI-generated
recipe images are written to disk and served via Express static mounts, which
ties storage growth to the VPS disk and requires persistent-volume handling
across redeploys.

## Background

The earlier "base64-in-DB → disk" migration is **complete** (see
`server/scripts/migrate-avatars.ts` and `migrate-recipe-images.ts`); a scan on
2026-05-24 confirmed zero images remain in Postgres. The remaining and
not-yet-started migration is **disk → R2**.

R2 is the chosen object store (zero egress, S3-compatible API). Decoupling
storage from the VPS lets disk usage grow independently of the chosen hosting
tier and removes the need for a persistent volume that survives redeploys —
relevant to the in-progress Hostinger VPS sizing decision.

The migration surface is small because uploads already flow through
`multer.memoryStorage()` (`server/routes/_upload.ts:10`, `server/routes/food.ts:19`),
so every uploaded file is already a `Buffer` in memory — each `fs.writeFile(buffer)`
becomes a `PutObjectCommand(buffer)` with no "re-read from disk" plumbing.

## Acceptance Criteria

- [ ] `@aws-sdk/client-s3` (+ `@aws-sdk/lib-storage` if multipart needed) added; an R2 client wrapper created (e.g. `server/lib/object-storage.ts`) configured from env.
- [ ] New env vars defined and documented in CLAUDE.md: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (CDN/custom-domain origin for public reads).
- [ ] Avatar upload writes to R2 instead of disk (`server/routes/auth.ts:315`).
- [ ] Recipe-image writes go to R2 (`server/lib/runware.ts:191`, `server/services/recipe-generation.ts:370`).
- [ ] Avatar/recipe-image **deletes** target R2 (`deleteOldAvatarFile`, `server/routes/auth.ts:38`; recipe-image cleanup in `server/scripts/cleanup-seed-recipes.ts:48`).
- [ ] Stored URLs resolve correctly — either store full `R2_PUBLIC_BASE_URL` URLs, or keep `/api/avatars/...` & `/api/recipe-images/...` paths backed by a redirect/proxy (decide in Implementation Notes).
- [ ] One-off migration script uploads existing `uploads/avatars/*` and `uploads/recipe-images/*` to R2 and rewrites affected DB columns (`users.avatar_url`, `community_recipes.image_url`, `community_recipes.canonical_images`, `meal_plan_recipes.image_url`, `cookbooks.cover_image_url`, and any others that point at `/api/avatars` or `/api/recipe-images`).
- [ ] The two `express.static` mounts in `server/index.ts:179` and `:190` are removed (clean cutover) OR retained only as a transitional fallback.
- [ ] Existing magic-byte validation on uploads (e.g. `server/routes/receipt.ts:82`) is preserved.
- [ ] Audit whether menu/receipt/scan images (`menu_scans.image_url`, `scanned_items.image_url`, `scanned_items.photo_url`) are persisted anywhere or are transient (analyzed in-memory and discarded) — they are NOT currently served by a static mount. Bring them into scope only if persisted.

## Implementation Notes

- **URL strategy (decide first):** Prefer storing full public R2 URLs (via an `R2_PUBLIC_BASE_URL` custom domain on Cloudflare CDN) so reads serve directly from the edge with zero egress — that is R2's core value. The alternative (keep `/api/...` paths and proxy through Express) re-introduces a server hop and partially defeats the egress win. Whichever is chosen, never hardcode the host — derive from env so dev/prod differ cleanly.
- **Object keys:** keep filenames stable (`avatars/<id>.<ext>`, `recipe-images/<name>.<ext>`) to make the migration a 1:1 key mapping.
- **Bucket access:** bucket is private for writes (server holds credentials only); public read via the CDN/custom domain, mirroring the current "intentionally public, no auth" behavior of these assets. Do not make the bucket world-writable.
- **No prod deployment exists yet**, so a clean cutover (rewrite URLs, drop static mounts) is acceptable — no dual-write/backfill window needed. Still run the migration script against the dev DB and verify before removing disk fallback.
- **Reference pattern:** the completed `server/scripts/migrate-avatars.ts` / `migrate-recipe-images.ts` show the read-rows → transform → rewrite-URL loop to mirror for the disk → R2 direction.

## Dependencies

- Cloudflare R2 bucket provisioned + API token (account id, access key, secret).
- A public read origin for the bucket (R2 custom domain or `r2.dev` public bucket URL) before URLs can be cut over.

## Risks

- **Credential handling** — R2 secret access key is a real secret; load from env only, never commit, never log. This is why the todo is not delegable.
- **URL rewrite correctness** — missing a column that stores an image path leaves dead links; enumerate all image-URL columns (schema search on `*image*`/`*photo*`/`*avatar*`/`*cover*`) before running the rewrite.
- **Public-read misconfiguration** — an overly permissive bucket policy could expose write/list; scope the public origin to read-only.
- **In-flight uploads during cutover** — minimal given no prod traffic, but run the migration with the server stopped or in a maintenance window if that changes.

## Delegation

Not delegable — touches storage credentials/secrets and broad storage
architecture (excluded categories). Implement via the `/todo` skill with full
session context, then PR per the medium-priority flow.

## Updates

### 2026-05-24

- Initial creation. Scoped from a live audit: confirmed R2 is 0% wired (no SDK, no code, no env vars), images currently on local disk in `uploads/avatars` + `uploads/recipe-images`, DB→disk migration already complete.
