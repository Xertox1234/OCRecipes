# Audit Changelog

Append-only history of all code audits performed on this project. Each entry links to the full audit manifest with detailed findings and resolutions.

## Format

```
### YYYY-MM-DD — Audit Title
- **Trigger:** Why the audit was run
- **Manifest:** [link to manifest file]
- **Findings:** X critical, Y high, Z medium, W low
- **Resolved:** N fixed, M deferred, P false-positive
- **Commit(s):** git SHA(s) of fix commits
```

---

## 2026-04-07 — Full Codebase Audit (Round 2)

- **Trigger:** Post-OCR-feature audit — 12 commits (~2200 LOC) landed since audit #6
- **Manifest:** [docs/audits/2026-04-07-full-2.md](2026-04-07-full-2.md)
- **Findings:** 0 critical, 2 high, 13 medium, 13 low (28 total, 43 raw from 6 agents)
- **Resolved:** 27 verified, 0 deferred, 4 false-positive (incl. L6 reclassified)
- **Commit:** (pending)
- **Note:** Key fixes: calories regex negative lookahead for "from Fat", mutation dep destructuring for stable useCallback, `cancelAnimation` on reducedMotion toggle, barcode Zod validation on 3 endpoints, OCR parser negative/upper-bound guards, `barcodeNutrition` CHECK constraints, `useScanClassification` timeout cleanup bug, label-analysis-utils extraction with 13 tests, useOCRDetection 10 tests, parser 6 edge-case tests. +28 tests net.

## 2026-04-07 — Full Codebase Audit

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-04-07-full.md](2026-04-07-full.md)
- **Findings:** 0 critical, 5 high, 14 medium, 11 low (30 total)
- **Resolved:** 23 verified, 6 deferred (H1/H2/M5/M14/L10 architectural refactors + H1 service extraction), 1 false-positive (L4 defense-in-depth filter)
- **Commit:** `da63a26`
- **Note:** Key fixes: `verifyGroceryListOwnership` for IDOR checks, cookbook orphan-aware `recipeCount`, `handleRouteError` migration (23 catch blocks in 4 files), Zod body validation on grocery update, CORS PATCH method, update function whitelists (M7/M8), pantry item limit (M9), TOCTOU race catch (M10), barcode format validation, photo endpoint rate limiters, `notNull` on source columns. Lint warnings reduced from 9 to 0.

## 2026-04-02 — Full Codebase Audit

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-04-02-full.md](2026-04-02-full.md)
- **Findings:** 1 critical, 6 high, 17 medium, 11 low (35 total)
- **Resolved:** 33 verified, 2 deferred (M13: split \_helpers.ts, M16: consolidate buildDietaryContext)
- **Commit:** `cbbd92f`
- **Note:** Key fixes: `is_public` index on community_recipes, `updateUser` field whitelist, API key prefix unique constraint, storage/service layering violations resolved, 12 routes standardized to `handleRouteError`, AI prompt input sanitization gap closed. 6 archived todos from previous audits resolved. Net -53 LOC.

## 2026-04-01 — Authentication System Security Audit

- **Trigger:** Targeted security audit of the authentication system
- **Manifest:** [docs/audits/2026-04-01-security-auth.md](2026-04-01-security-auth.md)
- **Findings:** 0 critical, 0 high, 3 medium, 1 low (4 total)
- **Resolved:** 4 verified, 0 deferred, 0 false-positive
- **Commit:** (pending)
- **Note:** Key fixes: atomic tokenVersion increment (TOCTOU), password hash excluded from default getUser queries, API key cache uses SHA-256 hash keys, JWT iss/aud claims added.

## 2026-03-31 — Performance & Data-Integrity Audit

- **Trigger:** Found generated images stored in DB; targeted audit for similar performance/data-integrity issues
- **Manifest:** [docs/audits/2026-03-31-performance.md](2026-03-31-performance.md)
- **Findings:** 0 critical, 2 high, 4 medium, 3 low (9 actionable, 7 dropped as below-threshold)
- **Resolved:** 9 verified, 0 deferred
- **Commit:** (pending)
- **Note:** Key fix: `transactions.receipt` was storing full IAP receipts (50-200KB+) — same class as images-in-DB. Also fixed unbounded cache growth, N+1 inserts, missing unique constraints, and orphaned data.

## 2026-03-30 — Full Audit (Round 3)

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-03-30-full.md](2026-03-30-full.md)
- **Findings:** 0 critical, 1 high, 8 medium (9 actionable out of 33 raw agent findings — 24 dropped as below-threshold)
- **Resolved:** 9 verified, 0 deferred
- **Commit:** `893fcd5`
- **Note:** Fourth consecutive audit. Agents trending toward diminishing-return findings. Recommending shift to targeted audits.

## 2026-03-29 — Full Audit (Round 2)

- **Trigger:** Periodic full codebase audit (first with all 5 domains reporting)
- **Manifest:** [docs/audits/2026-03-29-full-2.md](2026-03-29-full-2.md)
- **Findings:** 0 critical, 3 high, 7 medium, 12 low (22 total)
- **Resolved:** 17 verified, 5 deferred (L1/L3/L4/L6/L7 — structural refactors)
- **Commit:** `2c18392`

## 2026-03-29 — Full Audit

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-03-29-full.md](2026-03-29-full.md)
- **Findings:** 0 critical, 4 high, 10 medium, 8 low (22 total)
- **Resolved:** 20 verified, 1 deferred (M7 — JSONB validation), 1 false-positive (L4 — sequential loop)
- **Commit:** `4a50a06` fix: resolve full audit findings (20 verified, 1 deferred)
- **Note:** Architecture and code-quality agents hit rate limits (3/5 domains reported)

## 2026-03-27 — Full Audit

- **Trigger:** Full codebase audit across all domains
- **Manifest:** [docs/audits/2026-03-27-full.md](2026-03-27-full.md)
- **Findings:** 0 critical, 6 high, 14 medium, 10 low (30 total)
- **Resolved:** 0 fixed, 30 deferred (all tracked in `todos/001-030`)
- **Note:** Code quality agent hit rate limit; findings from 4/5 domains (security, performance, data-integrity, architecture)

## 2026-03-27 — Launch Readiness Audit (Round 2)

- **Trigger:** Second-pass audit after first round left unfixed items
- **Manifest:** No structured manifest (pre-workflow). Findings tracked in conversation only.
- **Findings:** 3 critical, 9 high, 7 medium, 1 low (net-new after dedup)
- **Resolved:** 11 fixed, 0 deferred, 0 false-positive
- **Commit:** `0a6c43c` fix: resolve verified audit findings with per-fix test verification

## 2026-03-27 — Launch Readiness Audit (Round 1)

- **Trigger:** Pre-launch readiness check
- **Manifest:** No structured manifest (pre-workflow). Findings were in agent output.
- **Findings:** ~30+ across 5 domains (security, performance, data, architecture, quality)
- **Resolved:** ~15 fixed, 3 deferred to todos, ~12 silently dropped (root cause of round 2)
- **Commits:** `cb1fc6a`..`16f8d6f` (6 commits)
- **Lesson:** Bulk fix without per-item verification led to incomplete resolution. This triggered creation of the structured audit workflow.
