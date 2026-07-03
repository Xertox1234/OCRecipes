---
title: kimi-review on cumulative working-tree diff re-flags earlier audit fixes
track: bug
category: logic-errors
module: shared
severity: low
tags: [audit, code-review, kimi-review, workflow, tooling]
symptoms: [Same WARNING re-surfaces across consecutive `kimi-review` calls in an audit session, Reviewer argues about something already empirically verified, Per-fix reviews touch unrelated parts of the working tree]
applies_to: [.claude/skills/audit/SKILL.md]
created: '2026-05-11'
---

# kimi-review on cumulative working-tree diff re-flags earlier audit fixes

## Problem

During a multi-fix audit session (Phase 3 of the `/audit` skill), `kimi-review` is called once per fix to verify each landing. The first fix gets a clean review; subsequent fixes get re-flagged for the _earlier_ fix because the working-tree diff is cumulative. By the third fix you're arguing with the reviewer about something already empirically verified in fix #1.

## Symptoms

- Same WARNING resurfaces in fix #2's review covering changes from fix #1
- Reviewer cannot tell that the earlier item was already addressed
- Audit session productivity drops because each fix triggers relitigation

## Root Cause

`kimi-review` without `--paths` reads the entire working-tree diff. Every uncommitted change in the audit session is in scope — including all earlier fixes. The reviewer has no way to know which lines belong to the current fix versus earlier ones.

## Solution

Scope `kimi-review` to the specific paths the current fix touches, not the whole working tree:

```bash
# Bad: reviews everything in the working tree — re-flags earlier fixes
kimi-review --scope "fix M1: add factories" --patterns testing,typescript

# Good: scopes to just the files this fix touched
kimi-review --paths server/__tests__/factories shared/schema.ts \
  --scope "fix M1: add factories" --patterns testing,typescript
```

For the Phase 6 final review, use `--paths <all-modified-files>` rather than `--base main` (which can also pull in unrelated commits that landed on main during the session — e.g., parallel auto-delegate hooks or other agents pushing to main).

## Prevention

In per-fix Phase 3 reviews, always pass `--paths` to constrain scope. The whole-tree review belongs to Phase 6, and even there, pass `--paths` explicitly to avoid pulling in concurrent main-branch changes.

## Related Files

- `.claude/skills/audit/SKILL.md` — audit Phase 3 review step
- Audit 2026-05-11 transcript (advisor reconcile call)
