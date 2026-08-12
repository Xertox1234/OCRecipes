---
title: "batch-merge-can-invalidate-clean-mergeable-state doc is fully inert — no tag matches any injection domain"
status: backlog
priority: low
created: 2026-08-11
updated: 2026-08-11
assignee:
labels: [deferred, harness]
github_issue:
---

# batch-merge doc is fully inert — no tag matches any injection domain

## Summary

`docs/solutions/best-practices/batch-merge-can-invalidate-clean-mergeable-state-2026-07-06.md` declares `applies_to: [docs/rules/*.md]` but its tags (`process, git, github, merge-conflicts, batch-merge, ci`) match no domain's `domain_tag_pattern`, so it never injects anywhere — even after PR #799 routed `docs/rules/**` to the harness domain.

## Background

Surfaced by the PR #799 review as the tag half of the two-part routing precondition (see `docs/solutions/conventions/tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md`). The sibling inert doc (`rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md`) was clear-cut harness material and got its `harness` tag in #799 itself. This one needs a content judgment: the lesson is about git merge-process (batch merges invalidating mergeable state), and it's unclear whether harness is the right pool for it or whether its `applies_to: [docs/rules/*.md]` glob is itself the stale part.

## Acceptance Criteria

- [ ] Decide the owning pool: add a domain-matching tag (likely `harness`), OR correct/remove the `docs/rules/*.md` applies_to glob if the doc shouldn't fire on rules-file edits
- [ ] After the change, `npx tsx scripts/lib/path-domains.ts` on a path the doc's applies_to covers routes to a domain whose `domain_tag_pattern` the doc's tags now match (verify the two-part precondition end to end)
- [ ] Frontmatter stays single-line inline-flow (lint-staged check passes)

## Implementation Notes

The one-line probe for the tag half: `grep -E '^tags:' <doc>` vs the alternations in `domain_tag_pattern()` in `.claude/hooks/inject-patterns.sh` (lines ~207-226). Note `harness` matches `\b(harness|tooling|pg-lab|worktree|agents)\b`.

## Scope Contract

- **Mechanisms to use:** frontmatter edit only — no hook or generator changes
- **Files in scope:** `docs/solutions/best-practices/batch-merge-can-invalidate-clean-mergeable-state-2026-07-06.md`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None (PR #799 already routed `docs/rules/**` → harness).

## Risks

- Adding `harness` mechanically without the content judgment just moves the doc from "inert" to "wrong-pool noise" — the decision is the work.

## Updates

### 2026-08-11

- Initial creation (deferred from PR #799 review finding 4).
