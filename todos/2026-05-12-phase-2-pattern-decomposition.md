---
title: "Phase 2: decompose docs/patterns/*.md into docs/solutions/<category>/"
status: in-progress
priority: medium
created: 2026-05-12
updated: 2026-05-12
assignee:
labels: [deferred, hooks, infrastructure, docs, codification]
github_issue:
---

# Phase 2: decompose docs/patterns/\*.md into docs/solutions/<category>/

## Summary

Migrate the 16 monolithic `docs/patterns/*.md` files (~22,400 lines, ~990 KB total) and `docs/LEARNINGS.md` (4,007 lines) into one-file-per-solution under `docs/solutions/<category>/`, using the schema already documented in `docs/solutions/README.md`. This is Phase 2 of the plan in `docs/research/pattern-codification-alternatives.md`. The half-finished `docs/solutions/` infrastructure already exists with the right structure (frontmatter, category subdirectories, README); the codify skill simply doesn't write there yet.

## Background

Phase 1 (commit `8fa374d3`, 2026-05-12) reduced injection noise from the hook but did not solve the underlying bloat or the spill-on-4-domain-edits problem. Phase 2 is the structural fix:

- Frontmatter-indexed per-pattern files replace head-N or tail-N retrieval over monoliths — the hook can grep frontmatter and inject only the relevant items.
- Decomposition forces a curation pass: every subsection becomes one of {extracted, merged with existing, pruned}. Expect ~25-30% prune rate on first pass.
- Once content lives in `docs/solutions/`, the codify skill rewrites become surgical (one file per finding, with overlap-check before write).

The five fattest files account for ~14,300 of the ~22,400 lines:

| File                            | Lines | Approx subsections |
| ------------------------------- | ----- | ------------------ |
| `docs/patterns/react-native.md` | 3,869 | 48+                |
| `docs/patterns/database.md`     | 2,746 | 30+                |
| `docs/patterns/api.md`          | 2,724 | —                  |
| `docs/patterns/testing.md`      | 2,085 | —                  |
| `docs/patterns/security.md`     | 1,881 | —                  |

## Acceptance Criteria

- [x] Schema validated end-to-end on **one** small pattern file (proof-of-concept: `docs/patterns/design-system.md`, ~266 lines) — commit `07f4d787` (2026-05-12)
- [x] Each extracted subsection becomes one file at `docs/solutions/<category>/<slug>-<date>.md` matching the README schema — 7 extracted for design-system.md
- [x] Each pattern subsection has a documented outcome — extracted / merged / pruned — captured in a per-file manifest — `docs/solutions/_manifests/2026-05-12-design-system.md`
- [x] Manifest captures rationale for any prune — 0 prunes on design-system.md; rubric documented in manifest for use by Step 2 subagents
- [x] Top-5 fattest files (react-native, database, api, testing, security) decomposed via parallel subagents (one file per agent) after proof-of-concept passes — commits `88c16a6e`, `d855b10f`, `8a75631d`, `6359875b`, `667e81ab` (2026-05-13). 289 extracted, 0 merged, 3 pruned.
- [ ] LEARNINGS.md migrated section-by-section to bug-track categories (`logic-errors/`, `runtime-errors/`, `code-quality/`)
- [ ] `codify` skill rewritten to write to `docs/solutions/<category>/` with overlap-check before create
- [ ] Hook (`inject-patterns.sh`) rewritten to grep frontmatter instead of head/tail of pattern files
- [ ] Monolithic `docs/patterns/*.md` files removed or moved to `docs/legacy-patterns/` (decide based on link breakage scan)
- [ ] `docs/PATTERNS.md` index updated to reference the new structure

## Implementation Notes

### Recommended sequencing

1. **Step 1 — Proof of concept (single file, no parallelism).** Decompose `docs/patterns/design-system.md` end-to-end. Manifest every subsection. Verify the README schema covers everything; iterate the schema if not. Acceptance: one pattern file fully decomposed, schema validated, no edits to the codify skill or hook yet.

2. **Step 2 — Parallel decomposition of top-5 fattest files.** One subagent per file, each in its own context window. Each subagent receives: the file path, the schema, the overlap-check rubric (simple title+tag match), and a budget. Returns a manifest of extracted/merged/pruned outcomes.

3. **Step 3 — LEARNINGS.md migration.** Same pattern: subagent reads, classifies each `## ` section into a bug-track category, produces manifest.

4. **Step 4 — Codify skill rewrite.** Update `.claude/skills/codify/SKILL.md` Step 5/6 to write to `docs/solutions/<category>/<slug>-<date>.md` with overlap-check before create. Consider decoupling the codify trigger from the kimi-review CRITICAL/WARNING gate (see "Session learnings" in `docs/research/pattern-codification-alternatives.md` Section 8).

5. **Step 5 — Hook rewrite.** `.claude/hooks/inject-patterns.sh` switches from `head/tail` over monoliths to frontmatter grep over `docs/solutions/`. This is where the deferred spill problem (`todos/2026-05-12-pattern-injection-spill-on-multi-domain-edits.md`) gets resolved as a side effect.

6. **Step 6 — Retire monoliths.** Either delete (git is the archive) or move to `docs/legacy-patterns/`. Scan for inbound links first (`docs/PATTERNS.md`, CLAUDE.md, skill files).

### Hard constraints

- Don't parallelize before Step 1 succeeds. If the rubric is wrong, you'd re-do hundreds of files.
- Don't modify the codify skill or the hook during content decomposition (Steps 1-3). Content first, retrieval second.
- Use the simpler "title+tag overlap >70%" rubric, not the 5-dimension overlap rubric from compound-engineering. At OCRecipes scale, the simpler heuristic captures 90% of the value with 20% of the complexity.

### Reference files

- `docs/research/pattern-codification-alternatives.md` — full plan, especially Sections 4 (Recommendation) and 8 (Implementation Status)
- `docs/solutions/README.md` — target schema
- `docs/solutions/logic-errors/`, `docs/solutions/runtime-errors/`, `docs/solutions/code-quality/` — existing example solution files (one per category)
- Commit `8fa374d3` — what Phase 1 actually shipped (so the new session doesn't redo it)

## Dependencies

- None. Phase 1 is complete enough that Phase 2 can start whenever.

## Risks

- **Schema gaps.** The README schema may not cover knowledge-track categories (architecture-patterns, design-patterns, conventions, etc.). Step 1 will surface this and the schema extends if needed.
- **Subagent inconsistency.** Five subagents working in parallel may classify similar subsections differently (e.g., one extracts a security pattern under `security-patterns/`, another puts a similar one under `conventions/`). Mitigation: prompt template enforces a fixed category list from the start; manifest reconciliation pass after parallel work.
- **Link breakage.** Skill files, CLAUDE.md, and `docs/PATTERNS.md` reference the monolithic files. Step 6 needs a grep-and-update sweep.
- **Pruning over-aggressively.** Easier to delete than recover from git. Mitigation: prune outcomes get a one-line rationale in the manifest before deletion.

## Next-session prompt

Paste this into a fresh Claude Code session to continue the work:

```
Continue the pattern codification refactor for OCRecipes. Phase 1 is complete (commit 8fa374d3). Now starting Phase 2 Step 1 — proof-of-concept decomposition of ONE pattern file before parallelizing.

Load context by reading, in this order:
1. /Users/williamtower/projects/OCRecipes/docs/research/pattern-codification-alternatives.md — full plan, especially Sections 4 and 8 (Implementation Status)
2. /Users/williamtower/projects/OCRecipes/todos/2026-05-12-phase-2-pattern-decomposition.md — the work being picked up (this todo)
3. /Users/williamtower/projects/OCRecipes/todos/2026-05-12-pattern-injection-spill-on-multi-domain-edits.md — background on the deferred spill problem Phase 2 dissolves
4. /Users/williamtower/projects/OCRecipes/docs/solutions/README.md — target schema for extracted solutions
5. /Users/williamtower/projects/OCRecipes/docs/solutions/code-quality/react-native-style-typing.md — an existing example solution file (one per category exists)

Then propose your approach for Phase 2 Step 1: decompose /Users/williamtower/projects/OCRecipes/docs/patterns/design-system.md (the smallest pattern file, ~266 lines) end-to-end into individual files under docs/solutions/<category>/<slug>-<date>.md. For each subsection, produce one of three outcomes: extracted / merged-with-existing / pruned (with rationale). Track every outcome in a manifest.

Hard constraints:
- Do NOT use parallel subagents in this step. Single-file proof-of-concept first. If the rubric or schema is wrong, we want to discover that on 266 lines, not 14,000.
- Do NOT modify .claude/skills/codify/SKILL.md or .claude/hooks/inject-patterns.sh in this step. Content first, retrieval second.
- Use a simple "title + tag overlap >70%" rubric for merging, not the 5-dimension overlap rubric from compound-engineering.
- Frontmatter must match docs/solutions/README.md exactly. If the schema is missing knowledge-track categories (e.g., architecture-patterns, design-patterns, conventions), propose the extension as part of your approach — do not silently invent fields.

Do NOT touch any files until I approve your proposed approach. Show me:
1. The category mapping you propose for design-system.md subsections
2. Any schema extensions needed
3. The merge/prune rubric in concrete terms
4. The first 1-2 example extractions (just the frontmatter + first paragraph, not the full file)

Today's date: 2026-05-12.
Be honest and direct in your analysis — I'm not looking to have my ass kissed. Push back if the approach is wrong.
```

## Updates

### 2026-05-12

- Initial creation. Follows the Phase 1 commit (`8fa374d3`) which refactored `.claude/hooks/inject-patterns.sh` to inject pattern TOCs instead of `head -n 80` excerpts. Phase 2 is the structural fix that makes the deferred spill problem (`todos/2026-05-12-pattern-injection-spill-on-multi-domain-edits.md`) obsolete.

### 2026-05-13

- **Step 1 complete** (commit `07f4d787`, pushed). `docs/patterns/design-system.md` decomposed 7 extracted / 0 merged / 0 pruned into `docs/solutions/` knowledge-track. Schema extended (`track: bug | knowledge`, 3 new dirs, optional `applies_to` glob, conditional-required fields). 4 pre-existing bug-track files backfilled with `track: bug`. Manifest at `docs/solutions/_manifests/2026-05-12-design-system.md`.
- **kimi-review caught one inherited WARNING** during Step 1 (WCAG example `4.48:1 ✓` — actually fails AA). Fixed in extraction; source `design-system.md` left as-is until Step 6 retirement.
- **Step 2 starting**: parallel decomposition of top-5 fattest files. Sequencing: launch ONE subagent on `security.md` (smallest of the 5 at 1,881 lines) to validate the subagent prompt template before fanning out 4-in-parallel for the rest. Mirrors the Step-1-then-Step-2 staging logic at the subagent layer.
