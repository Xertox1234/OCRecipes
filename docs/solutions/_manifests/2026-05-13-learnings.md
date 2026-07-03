---
manifest_for: docs/LEARNINGS.md
decomposed_on: 2026-05-13
source_size: 4007 lines, 78 sections
phase: 2
step: 3
status: complete — 94 of 94 planned units completed (66 in original 3-agent run on 2026-05-13, 28 in follow-up 3-batch run on 2026-05-15)
sub_manifests:
  - 2026-05-13-learnings-23-50.md
  - 2026-05-13-learnings-51-78.md
  - 2026-05-15-learnings-deferred-batch-1.md
  - 2026-05-15-learnings-deferred-batch-2.md
  - 2026-05-15-learnings-deferred-batch-3.md
---

# LEARNINGS.md → docs/solutions/ unified manifest

Phase 2, Step 3 of the pattern-codification refactor. Migrates the monolithic bug post-mortem doc into per-incident files under `docs/solutions/` bug-track categories, with a smaller knowledge-track yield where individual incidents synthesized into reusable rules.

## Source

- File: `docs/LEARNINGS.md`
- Size: 4,007 lines, 78 `## ` sections
- Status after this decomposition: **retained in place** until Step 6.

## Decomposition process (3-agent recovery)

The original plan was a single subagent over the full file. Infrastructure stalls forced a recovery pattern:

| Agent                       | Scope                                            | Outcome                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original (`a871c6d68...`)   | sections 2-22 (lines 5-665)                      | crashed at 100 min on socket timeout; **21 files written**                                                                                                                       |
| A (`ada2c6e8c...`)          | sections 23-50 (lines 676-1614)                  | clean completion in 36 min; **26 files + 2 prunes**                                                                                                                              |
| B (`a2206d70f...`)          | sections 51-78 (lines 1659-4007)                 | stalled at section 63 (Phase 0-7 Code Review roll-up) at 600 s watchdog; **~19 files written; full disposition plan for 48 entries survives in `2026-05-13-learnings-51-78.md`** |
| C (fill-in, `a99088200...`) | the 28 entries Agent B planned but did not write | stalled before any file writes (600 s watchdog); **0 files written**                                                                                                             |

The compounding failure surfaced one durable pattern: **when an agent writes a manifest before the files, the manifest survives the stall and becomes a recovery spec.** Agent B's manifest documented complete dispositions for sections 51-78 before it began file writing; that artifact is now the canonical plan for the deferred items below.

## Outcomes (summary)

| Range | Source sections                                          | Status   | Files extracted                          | Prunes                                                   |
| ----- | -------------------------------------------------------- | -------- | ---------------------------------------- | -------------------------------------------------------- |
| 2-22  | individual post-mortems (lines 5-665)                    | complete | 21                                       | 0 (no manifest from original agent)                      |
| 23-50 | individual post-mortems (lines 676-1614)                 | complete | 26                                       | 2 (clauses 4 — see sub-manifest)                         |
| 51-62 | individual post-mortems (lines 1659-~2700)               | complete | ~19                                      | 0 (in-range)                                             |
| 63-78 | code-review roll-ups + themed digests (lines ~2700-4007) | complete | 28 (in 2026-05-15 follow-up — see below) | 17 prunes confirmed (already-captured-elsewhere digests) |

**Step 3 totals (final, after 2026-05-15 follow-up)**:

- Extracted: **94 files** (21 original + 26 Agent A + ~19 Agent B + 28 in 3-batch follow-up)
- Pruned: **19** (2 Agent A clause-4 prunes + 17 Agent-B-planned prunes for digests already captured in Step 1-2 knowledge-track files; the prunes never required file writes — Agent B's disposition rationale stands)

## Files extracted by category (Step 3 additions, final)

| Category                             | Count | Examples                                                                                                                                                                                                                             |
| ------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `logic-errors/`                      | ~51   | prettier-reformats-generated-files, calorie-restriction-regex, mark-then-enrich-orphan-state, decorative-badge-double-announcement, toggle-favourite-race-condition (follow-up), nullable-fk-inner-join-drops-rows (follow-up)       |
| `runtime-errors/`                    | ~8    | drizzle-default-array-not-nullable, parseint-on-uuid-userid-returns-nan, onconflictdonothing-cache-expired-skip-crash, url-injection-encodeuricomponent-path-segments (follow-up), add-column-default-existing-rows-null (follow-up) |
| `code-quality/`                      | ~4    | vision-camera-v4-to-v5-migration, visioncamera-v5-frame-processor-runonjs-bridge, react-19-useref-explicit-initial-value (follow-up)                                                                                                 |
| `performance-issues/`                | ~3    | avoid-requery-after-insert, inline-arrow-functions-defeat-react-memo (follow-up), asyncstorage-in-memory-token-cache (follow-up)                                                                                                     |
| `conventions/` (knowledge-track)     | ~17   | requireauth-middleware-over-manual-checks, whisper-domain-prompt-engineering, paginate-list-endpoints-default-limits (follow-up), tier-limits-single-source-of-truth (follow-up)                                                     |
| `design-patterns/` (knowledge-track) | ~7    | tdee-back-calculation-adaptive-goals, dev-conditional-require-mock-vs-real-module (follow-up), jwt-over-cookies-react-native (follow-up), postgres-cache-table-ai-content (follow-up)                                                |
| `best-practices/` (knowledge-track)  | ~4    | simplicity-review-fresh-implementation, parallel-agent-shared-file-merge-conflicts (follow-up), deferred-security-todo-documentation (follow-up)                                                                                     |

Exact paths are in the two sub-manifests.

## Schema validation

Schema as documented in `docs/solutions/README.md` held up for both bug-track and knowledge-track LEARNINGS extractions. No new fields or categories needed. The first `performance-issues/` directory entry appeared in this batch (was a documented but unpopulated category before). The first cross-track `## See Also` link emerged in Step 2 batch 2a (testing); this batch produced more, primarily bug-track `logic-errors/` files linking to knowledge-track `../conventions/` rules they motivated.

## Merge rubric validation

**0 merges triggered** across all 3 agent runs. The agents' explicit `## See Also` cross-links accomplished what the merge rubric was designed for in the soft path. The Agent B sub-manifest flagged ~5 "possible duplicate" candidates (e.g., Drizzle `sql<T>` type-hint variants across sections 56, 58.1, 62) but kept them as distinct incidents because each had its own root-cause story.

## Prune rubric validation

**Clause 5 (redundant digest) fired heavily in Agent B's plan** — 16 of its 17 deferred prunes cited clause 5 against existing Step 2 conventions or Step 3 individual post-mortems. Examples: section 67.5 (Stale Closures State vs Refs) is a digest of `logic-errors/stale-closure-callback-refs.md`; section 68.2 (CORS Wildcard) digests `conventions/cors-pattern-matching-not-wildcard-2026-05-13.md`. The themed roll-up sections of LEARNINGS.md (Performance Learnings, Caching Learnings, etc.) are by design summaries of earlier individual incidents; clause 5 is the right disposition for items whose individual incidents are already codified.

Clause 4 (meta/too-narrow) fired on the Table of Contents, "Key Takeaways", and "Contributing to This Document" sections.

## Source corrections

Agent A and Agent B's completed portions found **0 inherited content bugs** in their source ranges. The original agent's range (sections 2-22) was not audited for source bugs — those should be reviewed when the deferred items are picked up.

## Items completed in follow-up (28 files)

Originally planned by Agent B and deferred when Agent C stalled before any writes. Picked up on 2026-05-15 by a 3-batch parallel agent run (manifests `2026-05-15-learnings-deferred-batch-{1,2,3}.md`). All 28 destination files now exist; the table below stays in the manifest as a traceability record from the Deferred phase. Follow-up details in the **Step 3 follow-up (2026-05-15)** section below.

| Source section | Source line search                                   | Destination                                                                   |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| 64.5           | `Parallel Agent Development Shared File Conflicts`   | `best-practices/parallel-agent-shared-file-merge-conflicts-2026-05-13.md`     |
| 65.1           | `Soft Delete Breaks Aggregation Silently`            | `logic-errors/soft-delete-breaks-aggregation-queries-2026-05-13.md`           |
| 65.2           | `Toggle Favourite Race Condition`                    | `logic-errors/toggle-favourite-race-condition-2026-05-13.md`                  |
| 65.3           | `Inline Arrow Functions Defeat React.memo`           | `performance-issues/inline-arrow-functions-defeat-react-memo-2026-05-13.md`   |
| 65.4           | `Optimistic Total Must Target Correct Page`          | `logic-errors/optimistic-total-target-correct-page-2026-05-13.md`             |
| 65.5           | `Favourite Icon Visual State Differentiation`        | `conventions/toggle-icon-visual-state-differentiation-2026-05-13.md`          |
| 66.1           | `JWT Auth Migration`                                 | `design-patterns/jwt-over-cookies-react-native-2026-05-13.md`                 |
| 66.2           | `Transaction Simplification Inline Over Abstraction` | `conventions/inline-db-transaction-over-helper-2026-05-13.md`                 |
| 66.3           | `Response Type Location Inline vs Shared`            | `conventions/response-types-inline-over-shared-2026-05-13.md`                 |
| 67.1           | `React 19 useRef Requires Initial Value`             | `code-quality/react-19-useref-explicit-initial-value-2026-05-13.md`           |
| 67.3           | `AsyncStorage Slow, Cache in Memory`                 | `performance-issues/asyncstorage-in-memory-token-cache-2026-05-13.md`         |
| 68.4           | `URL Injection via Unencoded Path Segments`          | `runtime-errors/url-injection-encodeuricomponent-path-segments-2026-05-13.md` |
| 68.5           | `Deferred JWS Signature Verification`                | `best-practices/deferred-security-todo-documentation-2026-05-13.md`           |
| 69 (a)         | `Simplification Principles` → delete-unused-code     | `conventions/delete-unused-code-aggressively-2026-05-13.md`                   |
| 69 (b)         | `Simplification Principles` → replace-any            | `conventions/replace-any-with-proper-types-2026-05-13.md`                     |
| 70.2           | `Performance Learnings` → Pagination                 | `conventions/paginate-list-endpoints-default-limits-2026-05-13.md`            |
| 70.3           | `Performance Learnings` → Dynamic Imports            | `conventions/static-import-for-builtins-and-hot-paths-2026-05-13.md`          |
| 71             | `Caching Learnings` → PostgreSQL Caching             | `design-patterns/postgres-cache-table-ai-content-2026-05-13.md`               |
| 72.2           | `Subscription` → API Response Consistency            | `conventions/match-existing-api-response-conventions-2026-05-13.md`           |
| 72.3           | `Subscription` → Restore endpoint rigor              | `conventions/paired-endpoints-equal-safeguards-2026-05-13.md`                 |
| 72.4           | `Subscription` → Hardcoded tier limits               | `conventions/tier-limits-single-source-of-truth-2026-05-13.md`                |
| 73.1           | `Data Processing` → Longest-keyword match            | `logic-errors/longest-keyword-match-categorization-2026-05-13.md`             |
| 73.2           | `Data Processing` → Truthy default                   | `logic-errors/truthy-sentinel-default-bypasses-fallback-2026-05-13.md`        |
| 74.1           | `Testing & Tooling` → service-client                 | `conventions/lazy-singleton-external-clients-test-import-2026-05-13.md`       |
| 74.3           | `Testing & Tooling` → `__DEV__` conditional          | `design-patterns/dev-conditional-require-mock-vs-real-module-2026-05-13.md`   |
| 74.4           | `Testing & Tooling` → mounted ref guard              | `design-patterns/mounted-ref-guard-async-hooks-2026-05-13.md`                 |
| 75.1           | `DB Migration` → ADD COLUMN default                  | `runtime-errors/add-column-default-existing-rows-null-2026-05-13.md`          |
| 75.2           | `DB Migration` → LEFT JOIN rewrite                   | `logic-errors/nullable-fk-inner-join-drops-rows-2026-05-13.md`                |

All 28 entries above were extracted on 2026-05-15. See **Step 3 follow-up (2026-05-15)** below for the agent split and source-bug check results.

## Step 3 follow-up (2026-05-15)

Three parallel `general-purpose` agents picked up the 28 deferred items after Step 4 (codify-skill rewrite, commit `bd52d53f`) landed. Sequencing was governed by stall-resistance guidance from the 3-agent recovery experience: scope per agent ≤ 10 files, no full-corpus Jaccard scans, per-batch manifest written before file bodies.

| Agent | Batch   | Items | Source sections                                            | Outcome                      |
| ----- | ------- | ----- | ---------------------------------------------------------- | ---------------------------- |
| 1     | batch-1 | 10    | 65.1-65.5, 66.1-66.3, 67.1, 67.3                           | clean completion in ~4.5 min |
| 2     | batch-2 | 10    | 68.4, 68.5, 69(a), 69(b), 70.2, 70.3, 71, 72.2, 72.3, 72.4 | clean completion in ~5 min   |
| 3     | batch-3 | 8     | 64.5, 73.1, 73.2, 74.1, 74.3, 74.4, 75.1, 75.2             | clean completion in ~3.5 min |

**Zero stalls** — the smaller per-agent scope + manifest-before-files protocol resolved the failure mode that ate three of four agents in the original Step 3 run.

**`created:` field resolution.** Agent 1 surfaced a prompt-vs-source mismatch in their dispatch: the prompt asserted that sections 65.x, 66.x, 67.x had individual `[YYYY-MM-DD]` prefixes, but in source they sit under umbrella H2s without per-section dates. Resolution per the documented fallback rule: 65.x uses `2026-02-12` (the umbrella `## History Item Actions Learnings (2026-02-12)` date); 66.x (`## Architecture Decisions`, undated) and 67.x (`## React Native / Expo Go Gotchas`, undated) use `2026-05-13`. Batches 2 and 3 all use `2026-05-13` (no incident-date prefixes in their themed roll-up sections).

**Source-bug spot-check.** 3 high-risk extractions audited against LEARNINGS.md source:

- `performance-issues/asyncstorage-in-memory-token-cache-2026-05-13.md` — numeric perf claims (2-10ms / 20-100ms / <1ms) match source verbatim; agent added a small contextual hedge ("depending on device, OS, and AsyncStorage backend") that is engineering-appropriate, not a fabrication.
- `performance-issues/inline-arrow-functions-defeat-react-memo-2026-05-13.md` — React.memo shallow-prop-equality semantics match source.
- `runtime-errors/add-column-default-existing-rows-null-2026-05-13.md` — added a PG 11+ non-volatile-default caveat not in source; technically accurate (documented PG behavior), explains why Drizzle's `db push` didn't trigger the in-place backfill optimization. Defensible elaboration.

**Inherited source bugs found: 0** in the spot-checked extractions. Lower than Step 2 baseline of ~1-2 per 10-file batch.

**Cross-link integrity.** Agent 2 flagged two cross-link targets (`stub-service-production-safety-gate-2026-05-13.md`, `check-premium-feature-helper-2026-05-13.md`) for verification; both confirmed present in `design-patterns/`. Agent 3 normalized an absolute file path in 75.2's source content (`/Users/williamtower/...` → repo-relative `server/storage.ts`) at extraction time.

## Open questions / handoff notes

1. **Source-bug audit for sections 2-22.** The original agent crashed before producing a manifest; its 21 output files were not retrospectively audited for inherited bugs. A spot-check pass at Step 6 retirement time would close this gap.
2. **Agent stall patterns — original Step 3 vs 2026-05-15 follow-up.** Three of four agents on this source stalled in the original run (original socket close, B watchdog, C watchdog). The 2026-05-15 follow-up (3 agents at ≤10 files each, manifest-before-files, no full-corpus Jaccard) had zero stalls. For Step 5 (hook rewrite) and Step 6 (monolith retirement), prefer the same shape: scope splits ≤ 10-15 files per agent and write manifests _before_ files so stalls preserve maximum recovery value.
3. **`logic-errors/` dominates the bug-track corpus** (~51 of ~66 bug-track files post-Step-3 final). This reflects the OCRecipes-specific nature of LEARNINGS.md — the project has had many "code runs but produces wrong behaviour" incidents historically and fewer hard crashes.
