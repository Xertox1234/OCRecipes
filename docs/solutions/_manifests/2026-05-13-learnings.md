---
manifest_for: docs/LEARNINGS.md
decomposed_on: 2026-05-13
source_size: 4007 lines, 78 sections
phase: 2
step: 3
status: partial — 66 of ~94 planned units completed; 28 deferred to follow-up todo
sub_manifests:
  - 2026-05-13-learnings-23-50.md
  - 2026-05-13-learnings-51-78.md
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

| Range | Source sections                                          | Status       | Files extracted | Prunes                                        |
| ----- | -------------------------------------------------------- | ------------ | --------------- | --------------------------------------------- |
| 2-22  | individual post-mortems (lines 5-665)                    | complete     | 21              | 0 (no manifest from original agent)           |
| 23-50 | individual post-mortems (lines 676-1614)                 | complete     | 26              | 2 (clauses 4 — see sub-manifest)              |
| 51-62 | individual post-mortems (lines 1659-~2700)               | complete     | ~19             | 0 (in-range)                                  |
| 63-78 | code-review roll-ups + themed digests (lines ~2700-4007) | **deferred** | 0 in this run   | 17 deferred prunes documented in sub-manifest |

**Step 3 totals as of this manifest write**:

- Extracted: **66 files** (21 original + 26 Agent A + ~19 Agent B)
- Pruned: **2** (Agent A clause-4 prunes — decision-style entries and themed digests duplicating existing knowledge-track files)
- **Deferred: 28 extract files** + **17 deferred prune dispositions** (Agent B's sub-manifest specified them but the file writes did not complete)

## Files extracted by category (Step 3 additions)

| Category                             | Count | Examples                                                                                                                           |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `logic-errors/`                      | ~45   | prettier-reformats-generated-files, calorie-restriction-regex, mark-then-enrich-orphan-state, decorative-badge-double-announcement |
| `runtime-errors/`                    | ~6    | drizzle-default-array-not-nullable, parseint-on-uuid-userid-returns-nan, onconflictdonothing-cache-expired-skip-crash              |
| `code-quality/`                      | ~3    | vision-camera-v4-to-v5-migration, visioncamera-v5-frame-processor-runonjs-bridge, jwt-types-shared (deferred)                      |
| `performance-issues/`                | 1     | avoid-requery-after-insert                                                                                                         |
| `conventions/` (knowledge-track)     | ~6    | requireauth-middleware-over-manual-checks, whisper-domain-prompt-engineering                                                       |
| `design-patterns/` (knowledge-track) | ~3    | tdee-back-calculation-adaptive-goals, dev-conditional-require-mock-vs-real-module (deferred)                                       |
| `best-practices/` (knowledge-track)  | ~2    | simplicity-review-fresh-implementation                                                                                             |

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

## Deferred items (28 files)

The following entries Agent B's sub-manifest specified for extraction but Agent C did not complete. Each maps to a specific source section in `docs/LEARNINGS.md`. Picking these up is a follow-up todo (see `todos/2026-05-14-learnings-step3-deferred-extractions.md`).

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

When picked up, agents should reference Agent B's sub-manifest (`2026-05-13-learnings-51-78.md`) for source-section line numbers and detailed disposition rationale.

## Open questions / handoff notes

1. **Step 3 partial completion is acceptable for unblocking Step 4-6.** The codify-skill rewrite (Step 4) and hook rewrite (Step 5) operate on the corpus shape and frontmatter schema — both validated. The 28 deferred items don't change either.
2. **Source-bug audit for sections 2-22.** The original agent crashed before producing a manifest; its 21 output files were not retrospectively audited for inherited bugs. A spot-check pass at Step 6 retirement time would close this gap.
3. **Agent stall patterns.** Three of four agents on this source stalled (original socket close, B watchdog, C watchdog). The corpus reading + multi-section iteration appears to exceed the runtime's typical session budget. For Step 4 (codify-skill rewrite) and Step 5 (hook rewrite), prefer scope splits ≤ 15 files per agent and write manifests _before_ files so stalls preserve maximum recovery value.
4. **`logic-errors/` now dominates the bug-track corpus** (45 of 60 bug-track files post-Step-3). This reflects the OCRecipes-specific nature of LEARNINGS.md — the project has had many "code runs but produces wrong behaviour" incidents historically and fewer hard crashes.
