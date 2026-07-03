---
title: Audit prompts scoped to changed lines miss systemic bugs in the unchanged code of changed files
track: knowledge
category: best-practices
module: shared
tags: [audit, discovery-agents, prompt-engineering, pattern-grep]
applies_to: [.claude/skills/audit/SKILL.md, .claude/agents/*.md]
created: '2026-05-25'
---

# Audit prompts scoped to changed lines miss systemic bugs in the unchanged code of changed files

## When this applies

You are dispatching audit discovery agents with a file surface scoped to "files changed since the prior audit." The natural framing — "review what changed" — directs the agent at *changed lines*. This is correct for catching new regressions but systematically misses **pre-existing systemic bugs that live in the unchanged code of those same files**.

## Smell patterns

- An agent reports "no findings" for `server/storage/foo.ts` but the file has a wide-fanout pattern (e.g. `TIER_FEATURES[rawTier]`, `eq(t.userId, x)` without visibility filter, a missing `notNull` on an array column).
- A separate finding in a *different* file later surfaces the same pattern, revealing the original file had it too — undetected.
- Specialist `--patterns` already exist for the issue class, but the agent didn't pattern-match because the *changed lines* didn't show the smell.

## Why

The 2026-05-25 audit's H4 finding was systemic — four call sites of `TIER_FEATURES[rawTier]` skipped `resolveEffectiveTier`. The security and data-integrity agents reviewed `nutrition.ts` and `favourite-recipes.ts` (both in their changed-file surface) and reported clean. The `TIER_FEATURES[tier].maxSavedItems` indexer in `nutrition.ts:460` and `TIER_FEATURES[tier].maxFavouriteRecipes` in `favourite-recipes.ts:87` were *unchanged in this audit window* — they predated the baseline — so the agents skipped them. The bug was only discovered when the orchestrator (fixing H3 in `_helpers.ts`) `grep`'d for `TIER_FEATURES[` and found the systemic pattern.

Audit prompts that say "audit the changed files for issues" prime the LLM to think in terms of the diff. A diff-scoped LLM evaluates each *changed hunk* against the rule set; it does not re-evaluate the whole file. This is efficient and right for catching new defects, but it has a known blind spot: **a systemic bug that pre-existed and was not touched in the diff stays hidden in the file the agent just "reviewed."**

## Examples

**Bad — diff-only framing:**

```
You are auditing the OCRecipes codebase for SECURITY issues. Audit these files
changed since the last full audit:
- server/storage/nutrition.ts
- server/storage/favourite-recipes.ts
```

The agent will check the changed lines against IDOR/sanitization/etc. rules and miss the unchanged `TIER_FEATURES[rawTier]` indexer.

**Good — augment with a systemic-pattern-grep step:**

```
You are auditing these changed files for SECURITY issues:
- server/storage/nutrition.ts
- server/storage/favourite-recipes.ts

After per-file review, run these whole-file pattern searches against the same
files (NOT scoped to changed lines) and report any matches not gated by the
relevant safeguard:

- `TIER_FEATURES[` — must be preceded by `resolveEffectiveTier` for user subs
- `eq(<table>.userId, userId)` reads — must also filter by visibility/isPublic
  for IDOR
- `.default([])` on array columns — must pair with `.notNull()` in the schema

Report systemic findings separately from per-line findings.
```

The whole-file regex sweep is cheap (the file is already loaded), explicitly defeats the diff-scoped framing, and surfaces the very thing the changed-lines pass would miss.

## Exceptions

- **Pure greenfield files in the diff** (new modules) — there is no "unchanged code" to miss; the diff IS the file.
- **Truly small files** (< 100 lines) — the agent will scan them end-to-end anyway; the augmentation is redundant.
- **Pre-launch / "full" scopes** — when the audit budget allows a non-diff-scoped sweep, run a periodic full-pattern grep across the codebase (independent of any audit), and reconcile findings against the existing audit history.

## Audit-skill follow-ups (capture for future skill edits)

1. Add a "Phase 2.1 — systemic-pattern sweep" step to `.claude/skills/audit/SKILL.md` that runs after the discovery agents, doing a project-wide grep for the audit's domain patterns and reconciling against the manifest. (Or fold into Phase 2.5's existing docs-researcher dispatch.)
2. Update each specialist agent's review template (e.g. `.claude/agents/security-auditor.md`) to explicitly include a "whole-file pattern scan of the listed files" step after the per-line review.
3. Maintain a `docs/rules/<domain>.md` index of "smells worth a whole-file grep" so the agent knows what to look for.

## Related Files

- `.claude/skills/audit/SKILL.md` — the audit workflow that this lesson refines
- `.claude/agents/security-auditor.md` / `database-specialist.md` / etc. — the discovery agents whose prompts this would augment
- `docs/audits/2026-05-25-full.md` — the audit whose H3 → H4 escalation surfaced this gap (manifest local-only)

## See Also

- [widening-helper-dependency-surface-test-blast-radius-2026-05-25.md](widening-helper-dependency-surface-test-blast-radius-2026-05-25.md) — the sibling meta-lesson from the same audit
- [expired-premium-not-downgraded-before-tier-features-2026-05-25.md](../logic-errors/expired-premium-not-downgraded-before-tier-features-2026-05-25.md) — the underlying systemic bug whose discovery exposed this audit-prompt gap
