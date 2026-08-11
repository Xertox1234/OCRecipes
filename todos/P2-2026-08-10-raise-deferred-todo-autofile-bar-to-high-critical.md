---
title: "Raise the Deferred Item Todos auto-file bar from Medium+ to High+ — medium findings should file themselves, not wait on a prompt"
status: backlog
priority: medium
created: 2026-08-10
updated: 2026-08-10
assignee:
labels: [deferred, harness, workflow, docs]
github_issue:
human_led: true
---

# Raise the deferred-todo auto-file bar to high/critical

## Summary

`CLAUDE.md` → **Deferred Item Todos** routes any **Medium severity or higher** defect
to a human prompt instead of letting it become a todo. The user's call (2026-08-10):
that gate should sit at **high and critical only**. Medium findings should auto-file the
same way low-severity ones do.

## Background

Current rule, verbatim:

> - **Defect, regression, or blocker (Medium severity or higher)** — never auto-file a
>   todo for it.
>   - If it is in scope of the current task, fix it now.
>   - If it is genuinely out of scope, surface it in your reply: one line, severity,
>     file path. Let the user decide. Do NOT file it silently.
> - **Low-severity item or minor followup** — this is the ONLY category that
>   auto-becomes a todo.

The rule exists because the old "file everything deferred" policy _"buried the backlog
and made finishing one todo spawn three."_ That rationale holds for genuinely trivial
noise; it does not hold for medium findings, which are the tier most likely to be real
and least likely to be remembered if they only ever appear in a chat reply.

**What triggered this.** During the PR #794 session two medium items were surfaced-not-
filed. One turned out to be a misreading (`coerceNumber` — see below) and one was real
(`parseServingGrams`), and the real one only became a todo because the user typed
"file a todo". A finding that survives only in conversation evaporates when the session
ends — which is precisely the failure the todo system exists to prevent.

The agent also repeatedly described the rule as "don't file Medium", inverting a
routing rule into a prohibition. Whatever threshold lands, the wording should make the
_auto_/_silently_ qualifiers impossible to drop.

## Acceptance Criteria

- [ ] `CLAUDE.md` → "Deferred Item Todos" gates the human-prompt path on **High and
      Critical only**; Medium joins Low in the auto-file tier
- [ ] The auto-file flow's filename/frontmatter guidance covers a medium item — today
      step 1 hardcodes `todos/P3-…` with `priority: low`, which cannot express a
      medium finding. It needs the priority and `P{n}` prefix to follow the assessed
      severity, not a constant
- [ ] The rewritten bullet keeps the _auto_/_silently_ qualifiers unmissable, so the
      high/critical branch is not re-read as "never file a high-severity todo"
- [ ] The in-scope-vs-out-of-scope split is preserved for every tier — "if it is in
      scope of the current task, fix it now" must not be lost in the rewrite
- [ ] Check whether `scripts/todo-automerge-guard.sh` / the `/todo` executor's
      eligibility logic keys off `priority` in a way that a larger medium population
      changes. Per the current rule a `low`- or `medium`-priority non-`security` todo
      is auto-merge-eligible, so more auto-filed mediums means more auto-merge-eligible
      PRs — decide deliberately whether that is wanted
- [ ] `.claude/skills/*/SKILL.md` and `docs/AI_WORKFLOW.md` grepped for restatements of
      the Medium+ bar and updated together, so the threshold is not defined twice

## Implementation Notes

- **`CLAUDE.md` is gitignored** (see the `project_claude_md_untracked` memory), so this
  edit is local-only and will not appear in a PR diff. Anything that must be shared
  belongs in a tracked file instead — check whether the rule is mirrored anywhere
  tracked before assuming a single edit site.
- `human_led: true` is set: this is a harness-policy change, so the wording is the
  user's call, not an agent's. An agent may draft, not decide.
- Consider whether "medium" needs a sharper definition alongside the threshold move. If
  medium auto-files, the severity label becomes load-bearing for backlog volume, and
  today it is assigned by judgement with no rubric.

## Scope Contract

- **Mechanisms to use:** editing the existing prose rule — no new gate, script, or
  frontmatter field
- **Files in scope:** `CLAUDE.md`, plus any tracked file found to restate the bar
  (`docs/AI_WORKFLOW.md`, `.claude/skills/*/SKILL.md`)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- The original rationale is real: the pre-2026-07 "file everything" policy buried the
  backlog. Moving the bar re-admits the tier just below the one that caused it, so it
  is worth revisiting the backlog size a few weeks after the change rather than
  treating it as settled.

## Updates

### 2026-08-10

- Filed at the user's request during the PR #794 follow-up. Trigger: a real medium
  finding (`parseServingGrams` unit-prefix match) reached a todo only because the user
  asked for one, and a second surfaced "medium" (`coerceNumber`) turned out on
  verification to be documented free-tier handling, not a defect at all — so the
  current gate produced one near-miss and one false alarm in a single session.
