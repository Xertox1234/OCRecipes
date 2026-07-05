---
title: "ai-reviewer checklist still mandates manual COACH_CACHE_VERSION bump — mechanism was replaced by auto-hash"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, agents]
github_issue:
---

# ai-reviewer checklist still mandates manual COACH_CACHE_VERSION bump — mechanism was replaced by auto-hash

## Summary

`.claude/agents/ai-reviewer.md` (checklist lines ~112-113) instructs reviewers to include "a prompt-version constant (`COACH_CACHE_VERSION = \"v3\"` in the module)" in cache keys and to "bump the prompt-version constant when changing the system prompt." The coach service no longer has that constant — it was replaced by an automatic template hash.

## Background

Found 2026-07-05 while fact-checking the prompt-engineer agent redesign (PR for `chore/prompt-engineer-v2`): the redesign imported the manual-bump convention from ai-reviewer's checklist, but `server/services/nutrition-coach.ts:294` (`getSystemPromptTemplateVersion()`) documents that the memoized template hash "automatically changes when the prompt prose is edited, eliminating the manual COACH_CACHE_VERSION bump." A repo-wide grep finds no remaining `*_CACHE_VERSION` constants — the only hit is that doc comment. The checklist's underlying principle (prompt changes must invalidate cached responses) is still correct; only the mechanism description is stale, and a reviewer following it literally would demand a constant that no longer exists.

## Acceptance Criteria

- [ ] ai-reviewer.md checklist items describe the current invalidation mechanism: coach uses `getSystemPromptTemplateVersion()` auto-hash; any service keyed on a manual version constant must bump it.
- [ ] The `COACH_CACHE_VERSION = "v3"` example is removed or rewritten as historical context.
- [ ] The principle "cache key must change when the prompt, tool schema, or safety regex changes" is preserved.

## Implementation Notes

- Files in scope: `.claude/agents/ai-reviewer.md` only (lines ~112-113 in the current file; re-locate by grepping `COACH_CACHE_VERSION`).
- Cross-check against `server/services/nutrition-coach.ts` `getSystemPromptTemplateVersion()` before rewording.
- The redesigned `.claude/agents/prompt-engineer.md` cache-coupling bullet already carries the corrected wording — keep the two agents consistent.

## Dependencies

- None (docs-only change to an agent definition).

## Risks

- Low. Worst case is transient inconsistency between the two agent files if only one is updated.

## Updates

### 2026-07-05

- Initial creation — filed during the prompt-engineer v2 redesign session.
