# Design: Seed prod with platform-owned featured recipes + verify R2 delivery

- **Date:** 2026-06-25
- **Status:** Approved design → ready for implementation plan
- **Scope:** Contained. One code change to `server/scripts/seed-recipes.ts` + one gated prod run + verification.

## Problem

The untethered preview build (installed from an Expo QR code) talks to the live
backend (`https://api.ocrecipes.com` on Railway + Cloudflare R2). In that app, **no
recipes and no images appear.**

### Root cause (verified, not inferred)

| Fact                                                 | Evidence                                                                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prod `community_recipes` is **empty**                | `select count(*)` returned **0** (run against `DATABASE_PUBLIC_URL`)                                                                                                                         |
| R2 read path is **correctly configured**, just empty | `img.ocrecipes.com` resolves to Cloudflare, returns a clean HTTP 404 (`cf-nel` headers) for a missing object — the signature of a custom domain bound to the bucket with public read enabled |
| Prod has all 5 `R2_*` vars + OpenAI key              | `railway variables` (Runware key absent → DALL-E fallback covers image gen)                                                                                                                  |
| Local DB is irrelevant to this bug                   | Local has 915 rows but is reached only via `192.168.0.102:3000`; every EAS build points at prod                                                                                              |

**Conclusion:** the only gap is missing content. Seeding fills the DB; images then
flow through the already-working R2 path automatically. **No Cloudflare/R2 config
change is required.**

### Why a bulk migration is rejected

The local 915 rows are cruft: only **27 distinct titles** (≈888 duplicates), only **26
rows** have an image + ≥4 ingredients + ≥4 instructions, **0** have macros, and only the
**25 seed recipes** are public/complete. There is nothing in the 915 worth migrating that
the seed script does not regenerate cleaner.

## Goals

1. Prod's app shows a clean catalogue of **25 curated featured recipes** with images.
2. **No test/demo/synthetic login account exists on the live backend** — hard requirement.
3. Prove images actually render from R2 (not merely that rows were inserted).

## Non-goals

- No change to R2 / Cloudflare configuration (already correct).
- No bulk migration of local recipes.
- No expansion of the recipe catalogue beyond the existing 25 targets (easy follow-up later).
- No new login account of any kind in prod.

## Design

Two workstreams, sequenced: **A** (code) lands via normal commit → PR → CI **before**
**B** (the gated prod run).

### Workstream A — Code change to `server/scripts/seed-recipes.ts`

Today the script does double duty: it creates the recipe **author** _and_ the
`demo`/`demo123` **test login** that local simulator testing depends on. Split those:

- **When `--allow-prod-seed` is passed** (the prod path):
  - **Hard-refuse to create any account.** `ensureDemoUser()` is never called.
  - Insert every recipe with **`authorId: null`** (platform-owned content).
  - `authorId: null` is verified safe: schema column is nullable (`onDelete: "set null"`),
    `InsertCommunityRecipe = $inferInsert` exposes it as nullable, and the storage layer
    already handles `NULL authorId` orphans as a first-class state.
- **Without the flag** (local dev): unchanged — `ensureDemoUser()` still creates
  `demo`/`demo123` and authors under it, so simulator testing is unaffected.
- **Also set `isCanonical: true` on the seed insert** (one line in the seed's
  `createCommunityRecipe` call, all environments). See "Display surfaces" below for why.

**Gating detail (the trap to avoid):** the no-account/authorless behavior keys off the
explicit **`--allow-prod-seed` flag**, _not_ `NODE_ENV` alone. Running via
`railway run` may not inject `NODE_ENV`; if the script keyed off env and env were absent,
the prod guard would silently not fire and `ensureDemoUser()` would create `demo` in prod —
the exact account that is vetoed. Belt-and-suspenders condition:
`--allow-prod-seed OR NODE_ENV === "production"` ⇒ authorless, no account.

**Display surfaces (verified):**

- App featured list → `getFeaturedRecipes` filters `isPublic` + non-empty instructions.
  The seed sets `isPublic: true` and gates on ≥4 instructions, so recipes render here
  **regardless of `isCanonical`** — this alone solves the stated problem.
- B2B catalogue (`/api/v1/recipes`) → `getCuratedRecipes` filters `isCanonical && isPublic`.
  **Correction:** `is_canonical` defaults to `false` (`schema.ts:644`) and
  `createCommunityRecipe` does _not_ set it — so without action, seeded recipes would
  **not** appear in the catalogue. The seed is meant to produce exactly the curated
  content this API serves, so the seed insert explicitly sets `isCanonical: true`,
  making the claim true by deliberate choice rather than relying on (the wrong) default.

Image generation is unchanged: Runware (absent in prod) → DALL-E 3 fallback →
`saveRecipeImage` uploads to R2 and returns the absolute `img.ocrecipes.com` URL.

### Workstream B — Gated prod run + verification

The seed runs from the **laptop** (needs `tsx`/devDeps, not present in the built Railway
container), with prod env injected:

```
# Fetch the PUBLIC db url from the Postgres service (internal host won't resolve off-network)
PUBLIC_DB="$(railway variables --service Postgres --kv | sed -n 's/^DATABASE_PUBLIC_URL=//p')"

# Inject R2 + OpenAI from the app service; override DATABASE_URL with the public host
railway run --service OCRecipes -- sh -c \
  "DATABASE_URL='$PUBLIC_DB' npm run seed:recipes -- --allow-prod-seed"
```

- This is a **sensitive live-DB write** — executed by the user / with explicit approval
  (the auto-mode classifier will gate it).
- Expected: ~1.5 min wall-clock, ~$1–2 DALL-E cost, 25 rows inserted, 25 images in R2.

**Verification (the proof that "seeded" ⇒ "renders"):**

1. `select count(*) from community_recipes` against `DATABASE_PUBLIC_URL` → expect **25**,
   and `count(*) where author_id is null` → expect **25** (confirms no account path taken).
2. `curl -o /dev/null -w '%{http_code} %{content_type}'` on one seeded `img.ocrecipes.com/...`
   URL → expect **200** + `image/png`.
3. Open the app → featured recipes + images render. **(primary success criterion)**
4. `select count(*) from community_recipes where is_canonical and is_public` → expect **25**
   (confirms the catalogue surface is satisfied; a full `/api/v1/recipes` check needs a
   provisioned API key and is optional).

Macros are best-effort (`estimateMacros`); if estimation fails a card may show without
macros — acceptable, not blocking.

## Sequencing

1. Implement Workstream A → commit → PR → CI green → merge to `main`.
2. (Merge auto-deploys; this PR is code-only and changes no schema, so zero deploy risk.)
3. Run Workstream B against prod (user-gated).
4. Run verification steps 1–3.

## Risks & mitigations

| Risk                                                           | Mitigation                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `railway run` doesn't inject `NODE_ENV` → demo account created | Gate on explicit `--allow-prod-seed` flag; hard-refuse account creation when present |
| Internal `DATABASE_URL` won't resolve from laptop              | Override with `DATABASE_PUBLIC_URL` from the Postgres service                        |
| Image gen fails the gate → recipe skipped                      | DALL-E fallback verified present; script already retries + reports skips             |
| Re-running double-inserts                                      | Seed is idempotent (`getSeededIngredients` skips existing seed keys)                 |
| Seeded rows have no author shown in UI                         | Verified: no display surface requires an author                                      |
