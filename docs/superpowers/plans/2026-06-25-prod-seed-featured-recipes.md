# Prod Seed (Platform-Owned Featured Recipes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the live prod database with 25 platform-owned curated recipes (no account created) so the app shows recipes + images from Cloudflare R2.

**Architecture:** Extract the prod-seed authorization decision into a pure, unit-testable `seed-recipes-utils.ts` (the script auto-runs `main()` on import, so logic must live outside it). Wire it into `seed-recipes.ts` so that — when seeding the live backend — the script creates **no account** and inserts every recipe with `authorId: null` and `isCanonical: true`. Then run the seed against prod (user-gated) and verify images render from R2.

**Tech Stack:** TypeScript, `tsx`, Drizzle ORM, Vitest, Railway CLI, Cloudflare R2.

## Global Constraints

- **No test/demo/synthetic login account may exist on the live backend** — hard requirement. The prod path must never call `ensureDemoUser()`.
- **Platform-owned seeds use `authorId: null`** (column is nullable; `onDelete: "set null"`; orphan-author is a first-class state).
- **Gate the no-account/authorless path on the explicit `--allow-prod-seed` flag**, with `NODE_ENV === "production"` only as belt-and-suspenders — NOT on `NODE_ENV` alone (`railway run` may not inject it).
- **Seed insert sets `isCanonical: true`** so recipes appear in the B2B catalogue (`getCuratedRecipes` filters `isCanonical && isPublic`; `is_canonical` defaults to `false`).
- **No R2 / Cloudflare config changes** — the read path (`img.ocrecipes.com`) is already correct and verified.
- **25 recipes only** — no catalogue expansion in this change.
- **Code (Workstream A) lands via PR + green CI before the gated prod run (Workstream B).** Run `npm run preflight` before opening the PR.
- **The prod run + prod DB reads are user-gated** (auto-mode classifier blocks them) — the operator executes them.
- Local dev (no flag, non-production) behavior is unchanged: `ensureDemoUser()` still creates `demo`/`demo123`.

---

## Workstream A — Code change (PR-first)

### Task 1: Extract the prod-seed authorization helper

**Files:**

- Create: `server/scripts/seed-recipes-utils.ts`
- Test: `server/scripts/__tests__/seed-recipes-utils.test.ts`

**Interfaces:**

- Produces:
  - `ALLOW_PROD_SEED_FLAG: string` — the literal `"--allow-prod-seed"`.
  - `shouldSeedAsPlatformOwned(opts: { allowProdSeed: boolean; nodeEnv: string | undefined }): boolean` — `true` ⇒ create no account, author recipes as `null`.

- [ ] **Step 1: Write the failing test**

Create `server/scripts/__tests__/seed-recipes-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ALLOW_PROD_SEED_FLAG,
  shouldSeedAsPlatformOwned,
} from "../seed-recipes-utils";

/**
 * These tests pin the safety contract for seeding the LIVE backend:
 * a `demo` test account must never be created in prod, so the authorless/
 * no-account decision must fire whenever the operator opts in via the flag —
 * even when `railway run` fails to inject NODE_ENV (mirrors
 * backfill-email-verified-utils).
 */
describe("seed-recipes-utils", () => {
  it("ALLOW_PROD_SEED_FLAG is the exact opt-in flag", () => {
    expect(ALLOW_PROD_SEED_FLAG).toBe("--allow-prod-seed");
  });

  describe("shouldSeedAsPlatformOwned", () => {
    it("is true when the flag is passed even if NODE_ENV is unset (railway run case)", () => {
      expect(
        shouldSeedAsPlatformOwned({ allowProdSeed: true, nodeEnv: undefined }),
      ).toBe(true);
    });

    it("is true when NODE_ENV=production even without the flag (belt-and-suspenders)", () => {
      expect(
        shouldSeedAsPlatformOwned({
          allowProdSeed: false,
          nodeEnv: "production",
        }),
      ).toBe(true);
    });

    it("is true when both the flag and production env are set", () => {
      expect(
        shouldSeedAsPlatformOwned({
          allowProdSeed: true,
          nodeEnv: "production",
        }),
      ).toBe(true);
    });

    it("is false for local dev (no flag, non-production env)", () => {
      expect(
        shouldSeedAsPlatformOwned({
          allowProdSeed: false,
          nodeEnv: "development",
        }),
      ).toBe(false);
      expect(
        shouldSeedAsPlatformOwned({ allowProdSeed: false, nodeEnv: undefined }),
      ).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- server/scripts/__tests__/seed-recipes-utils.test.ts`
Expected: FAIL — cannot resolve `../seed-recipes-utils` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `server/scripts/seed-recipes-utils.ts`:

```ts
/**
 * Pure helpers for `seed-recipes.ts`.
 *
 * Extracted so the prod-seed authorization decision can be unit-tested without
 * booting a real Postgres connection — `seed-recipes.ts` runs `main()` at module
 * load, so it cannot be imported in a test.
 *
 * Safety context (mirrors backfill-email-verified-utils.ts): the live run path
 * is `railway run`, which does NOT reliably set NODE_ENV=production. So the
 * authorless/no-account decision keys PRIMARILY on the explicit opt-in flag;
 * NODE_ENV is only belt-and-suspenders. Keying on NODE_ENV alone would let
 * ensureDemoUser() create a `demo` test account on the live backend — vetoed.
 */

/** Opt-in flag the operator passes to seed the live backend. */
export const ALLOW_PROD_SEED_FLAG = "--allow-prod-seed";

/**
 * Decide whether to seed as PLATFORM-OWNED content: create NO account and
 * insert every recipe with `authorId = null`. True when `--allow-prod-seed`
 * was passed OR NODE_ENV === "production".
 */
export function shouldSeedAsPlatformOwned(opts: {
  allowProdSeed: boolean;
  nodeEnv: string | undefined;
}): boolean {
  return opts.allowProdSeed || opts.nodeEnv === "production";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- server/scripts/__tests__/seed-recipes-utils.test.ts`
Expected: PASS (6 assertions across 5 tests).

- [ ] **Step 5: Commit**

```bash
git switch -c feat/prod-seed-platform-owned
git add server/scripts/seed-recipes-utils.ts server/scripts/__tests__/seed-recipes-utils.test.ts
git commit -m "feat(seed): extract flag-keyed platform-owned seed authorization helper"
```

---

### Task 2: Wire the helper into the seed script (no-account + null author + canonical)

**Files:**

- Modify: `server/scripts/seed-recipes.ts`

**Interfaces:**

- Consumes: `ALLOW_PROD_SEED_FLAG`, `shouldSeedAsPlatformOwned` from `./seed-recipes-utils` (Task 1).
- Produces: nothing new for later code; behavior change verified by type-check + Workstream B.

- [ ] **Step 1: Import the helper**

In `server/scripts/seed-recipes.ts`, add after the existing local imports (e.g. below the `import { openai, MODEL_FAST } from "../lib/openai";` line):

```ts
import {
  ALLOW_PROD_SEED_FLAG,
  shouldSeedAsPlatformOwned,
} from "./seed-recipes-utils";
```

- [ ] **Step 2: Change `seedOneRecipe` to accept a nullable author**

Change the signature (currently `demoUserId: string`) and the insert. Replace:

```ts
async function seedOneRecipe(
  target: (typeof RECIPE_TARGETS)[number],
  index: number,
  alreadySeeded: Set<string>,
  demoUserId: string,
): Promise<RecipeResult> {
```

with:

```ts
async function seedOneRecipe(
  target: (typeof RECIPE_TARGETS)[number],
  index: number,
  alreadySeeded: Set<string>,
  authorId: string | null,
): Promise<RecipeResult> {
```

- [ ] **Step 3: Set `authorId` + `isCanonical: true` on the insert**

In the `storage.createCommunityRecipe({ ... })` call inside `seedOneRecipe`, replace the `authorId: demoUserId,` line with `authorId,` and add `isCanonical: true,`. The call's head becomes:

```ts
await storage.createCommunityRecipe({
  authorId,
  barcode: null,
  normalizedProductName: seedKey,
  title: content.title,
  description: content.description,
  difficulty: content.difficulty,
  timeEstimate: content.timeEstimate,
  servings: 2,
  dietTags: [...new Set([...content.dietTags, ...target.dietTags])],
  mealTypes: inferMealTypes(
    content.title,
    content.ingredients.map((i) => i.name),
  ),
  instructions: content.instructions,
  ingredients: content.ingredients,
  ...(macros ?? {}),
  imageUrl,
  isPublic: true,
  isCanonical: true,
});
```

- [ ] **Step 4: Resolve the author once in `main()`, skipping account creation in platform-owned mode**

In `main()`, the flag is read as:

```ts
const allowProdSeed = process.argv.includes("--allow-prod-seed");
```

Change it to use the constant:

```ts
const allowProdSeed = process.argv.includes(ALLOW_PROD_SEED_FLAG);
```

Then replace this line:

```ts
const demoUserId = await ensureDemoUser();
```

with:

```ts
// Platform-owned mode (live backend): create NO account and author every
// recipe with authorId = null. ensureDemoUser() is intentionally NOT called —
// a `demo` test login must never exist on the live backend.
const platformOwned = shouldSeedAsPlatformOwned({
  allowProdSeed,
  nodeEnv: process.env.NODE_ENV,
});
const authorId = platformOwned ? null : await ensureDemoUser();
if (platformOwned) {
  console.log(
    "Platform-owned seed: no account created; recipes authored as authorId=null.",
  );
}
```

- [ ] **Step 5: Pass the resolved author into the pipeline**

Replace the `seedOneRecipe` call argument `demoUserId` with `authorId`:

```ts
const results = await Promise.all(
  RECIPE_TARGETS.map((target, i) =>
    limit(() => seedOneRecipe(target, i, alreadySeeded, authorId)),
  ),
);
```

- [ ] **Step 6: Type-check + run the helper test**

Run: `npm run check:types`
Expected: PASS (no errors). Confirms `authorId: null` satisfies `InsertCommunityRecipe` and the new signature typechecks.

Run: `npm run test:run -- server/scripts/__tests__/seed-recipes-utils.test.ts`
Expected: PASS (unchanged).

> Behavioral proof (account-not-created, author null, canonical true) is verified end-to-end against prod in Task 3 — it cannot be unit-tested here because importing the script triggers `main()`.

- [ ] **Step 7: Commit**

```bash
git add server/scripts/seed-recipes.ts
git commit -m "feat(seed): platform-owned prod seed — no account, null author, canonical"
```

---

### Workstream A wrap-up: preflight, PR, merge

- [ ] **Step 1: Run full preflight (required before opening a PR)**

Run: `npm run preflight`
Expected: PASS (lint, types, tests, coverage — full CI parity).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/prod-seed-platform-owned
gh pr create --title "feat(seed): platform-owned prod seed (no test account, null author, canonical)" \
  --body "Seeds prod featured recipes as platform-owned content. No demo/test account is created on the live backend; recipes use authorId=null and isCanonical=true. Flag-keyed (--allow-prod-seed) per the railway-run NODE_ENV trap. Local dev seeding (demo/demo123) is unchanged. Spec: docs/superpowers/specs/2026-06-25-prod-seed-featured-recipes-design.md"
```

- [ ] **Step 3: Watch CI green, then merge**

Wait for all required checks to pass, then merge (squash). Confirm merge to `main` before starting Workstream B (the prod run forks from `main`, but this PR is code-only — the seed command runs the local checkout regardless).

---

## Workstream B — Gated prod run + verification (operator-executed)

> Every command here reads/writes the **live** DB and is gated by the auto-mode classifier — the operator runs them (prefix with `!` in the session, or run in a terminal). The internal `DATABASE_URL` won't resolve off-network, so the seed runs with `DATABASE_URL` overridden to the Postgres service's `DATABASE_PUBLIC_URL`, while R2 + OpenAI env come from the OCRecipes service.

### Task 3: Seed prod and verify R2 delivery

**Files:** none (operational).

- [ ] **Step 1: Read the public DB URL from the Postgres service**

```bash
railway run --service Postgres -- sh -c 'echo "$DATABASE_PUBLIC_URL"'
```

Copy the printed `postgresql://...` URL (the public host, not `*.railway.internal`).

- [ ] **Step 2: Run the seed against prod (R2 + OpenAI from OCRecipes service env)**

```bash
railway run --service OCRecipes -- sh -c \
  'DATABASE_URL="<PASTE_PUBLIC_DB_URL>" npm run seed:recipes -- --allow-prod-seed'
```

Expected (stdout): a `Platform-owned seed: no account created; ...` line, ~25 `✓ inserted`, finishing with `=== Done! 25 inserted, 0 already existed, 0 skipped ... ===`. Wall-clock ~1.5 min; ~$1–2 DALL-E cost. Images upload to R2 automatically (Runware absent → DALL-E fallback).

- [ ] **Step 3: Verify row counts in prod**

```bash
railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -tA -c "select count(*) from community_recipes"'
railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -tA -c "select count(*) from community_recipes where author_id is null"'
railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -tA -c "select count(*) from community_recipes where is_canonical and is_public"'
railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -tA -c "select count(*) from users"'
```

Expected: `25`, `25`, `25`, and `0` (the last confirms NO account was created — the hard requirement).

- [ ] **Step 4: Verify an image actually serves from R2**

```bash
IMG=$(railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -tA -c "select image_url from community_recipes limit 1"' | tail -1)
echo "$IMG"
curl -o /dev/null -w "%{http_code} %{content_type}\n" "$IMG"
```

Expected: an absolute `https://img.ocrecipes.com/recipe-images/recipe-<uuid>.png` URL, and `200 image/png`.

- [ ] **Step 5: Confirm in the app**

Open the untethered preview build → the featured list shows ~25 recipes with images. **Primary success criterion.**

---

## Self-Review

**1. Spec coverage:**

- Empty-prod root cause → fixed by Task 3 seeding. ✅
- No test account in prod → Task 2 Step 4 (skip `ensureDemoUser` when platform-owned) + Task 3 Step 3 (`users` count = 0). ✅
- `authorId: null` → Task 2 Steps 2–4 + Task 3 (`author_id is null` = 25). ✅
- Flag-keyed (not NODE_ENV alone) → Task 1 `shouldSeedAsPlatformOwned` + tests. ✅
- `isCanonical: true` → Task 2 Step 3 + Task 3 (`is_canonical and is_public` = 25). ✅
- No R2 config change → none in plan; only verification (Task 3 Step 4). ✅
- 25 recipes, no expansion → `RECIPE_TARGETS` untouched. ✅
- PR + CI before prod run → Workstream A wrap-up precedes Task 3. ✅
- Local dev unchanged → Task 2 keeps `ensureDemoUser()` on the `else` branch. ✅

**2. Placeholder scan:** Only `<PASTE_PUBLIC_DB_URL>` / `<uuid>` — deliberate operator-supplied runtime values in the ops task, not code placeholders. No TBD/TODO/"add error handling". ✅

**3. Type consistency:** `ALLOW_PROD_SEED_FLAG` and `shouldSeedAsPlatformOwned({ allowProdSeed, nodeEnv })` are defined in Task 1 and consumed with identical names/shape in Task 2. `seedOneRecipe(..., authorId: string | null)` matches the `authorId` passed from `main()` (`string | null`) and the `authorId,` insert field. ✅
