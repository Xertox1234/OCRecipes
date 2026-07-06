---
title: "ai-reviewer checklist still mandates manual COACH_CACHE_VERSION bump — mechanism was replaced by auto-hash"
status: done
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, agents]
github_issue:
---

# ai-reviewer checklist still mandates manual COACH_CACHE_VERSION bump — mechanism was replaced by auto-hash

## Summary

`.claude/agents/ai-reviewer.md` (checklist lines ~112-113) instructs reviewers to include "a prompt-version constant (`COACH_CACHE_VERSION = \"v3\"` in the module)" in cache keys and to "bump the prompt-version constant when changing the system prompt." The coach service no longer has that constant — it was replaced by an automatic template hash. One live docs/solutions file teaches the same retired mechanism and is in scope too.

## Background

Found 2026-07-05 while fact-checking the prompt-engineer agent redesign (PR for `chore/prompt-engineer-v2`): the redesign imported the manual-bump convention from ai-reviewer's checklist, but `server/services/nutrition-coach.ts:294` (`getSystemPromptTemplateVersion()`) documents that the memoized template hash "automatically changes when the prompt prose is edited, eliminating the manual COACH_CACHE_VERSION bump." No live code constant remains (`hashCoachCacheKey` in `coach-pro-chat.ts` keys on the auto-hash), but `git grep COACH_CACHE_VERSION` still returns 9 hits: the ai-reviewer checklist itself, the nutrition-coach doc comment, two in a **live docs/solutions file** (`docs/solutions/conventions/safety-filter-rescan-cache-hits-2026-05-13.md:38,43` — imperative present-tense instruction to bump the constant, plus a Related Files entry pointing at the dead symbol), and five in the frozen `docs/legacy-patterns/` archive (out of scope — historical record). The checklist's underlying principle (prompt changes must invalidate cached responses) is still correct; only the mechanism descriptions are stale, and a reviewer following them literally would demand a constant that no longer exists.

## Acceptance Criteria

- [x] ai-reviewer.md checklist items describe the current invalidation mechanism: coach uses `getSystemPromptTemplateVersion()` auto-hash; any service keyed on a manual version constant must bump it.
- [x] The `COACH_CACHE_VERSION = "v3"` example is removed or rewritten as historical context.
- [x] The principle "cache key must change when the prompt, tool schema, or safety regex changes" is preserved.
- [x] `docs/solutions/conventions/safety-filter-rescan-cache-hits-2026-05-13.md` no longer teaches the manual bump: its mechanism lines (~33-39) point at the auto-hash for prompt changes while PRESERVING the file's still-correct primary rule (re-scan safety filters on cache read — the auto-hash does NOT cover safety-regex changes), and its `## Related Files` entry references live symbols (`hashCoachCacheKey`, `getSystemPromptTemplateVersion`).
- [x] Post-fix, `git grep COACH_CACHE_VERSION` returns only the nutrition-coach.ts doc comment, historical-context mentions, and frozen `docs/legacy-patterns/` hits.

## Implementation Notes

- Files in scope: `.claude/agents/ai-reviewer.md` (lines ~112-113; re-locate by grepping `COACH_CACHE_VERSION`) and `docs/solutions/conventions/safety-filter-rescan-cache-hits-2026-05-13.md`. `docs/legacy-patterns/` is frozen — do NOT edit its hits.
- Cross-check against `server/services/nutrition-coach.ts` `getSystemPromptTemplateVersion()` before rewording.
- The solutions-file edit must keep frontmatter single-line inline-flow (`scripts/check-solution-frontmatter.js` lint-staged gate).
- The redesigned `.claude/agents/prompt-engineer.md` cache-coupling bullet already carries the corrected wording — keep the agent files consistent.

## Dependencies

- None (docs-only change: one agent definition + one docs/solutions file).

## Risks

- Low. Worst case is transient inconsistency between the two agent files if only one is updated.

## Updates

### 2026-07-05

- Initial creation — filed during the prompt-engineer v2 redesign session.
- Scope widened after PR #512 review: the original "no remaining hits" claim was wrong — `docs/solutions/conventions/safety-filter-rescan-cache-hits-2026-05-13.md` still teaches the manual bump and is now in scope; verification AC added.

### 2026-07-06

- Implemented: rewrote `.claude/agents/ai-reviewer.md` Caching checklist (lines ~112-113) to describe the coach's `getSystemPromptTemplateVersion()` auto-hash, reframed `COACH_CACHE_VERSION = "v3"` as historical context, and preserved the "prompt/tool-schema/safety-regex change must invalidate the cache" principle.
- Rewrote `docs/solutions/conventions/safety-filter-rescan-cache-hits-2026-05-13.md` mechanism lines to point at the auto-hash for prompt changes, explicitly note the auto-hash does NOT cover safety-regex changes (why the re-scan rule still holds), and updated `## Related Files` to live symbols (`hashCoachCacheKey`, `getSystemPromptTemplateVersion`).
- `code-reviewer` review caught that the first draft of the ai-reviewer.md rewrite implied the auto-hash covers tool-schema changes too ("either way") — it doesn't (`TOOL_DEFINITIONS` is never hashed). Fixed inline to state the gap explicitly. Codified as a fresh recurrence in `docs/solutions/logic-errors/symbol-existence-grep-is-not-claim-verification-2026-07-05.md` (updated, not duplicated).
- All ACs verified; `git grep COACH_CACHE_VERSION` post-fix returns only the nutrition-coach.ts doc comment, the ai-reviewer.md historical mention, and frozen `docs/legacy-patterns/` hits.
