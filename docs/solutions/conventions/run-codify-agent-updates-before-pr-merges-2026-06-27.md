---
title: Run /codify's agent updates before the PR merges
track: knowledge
category: conventions
module: shared
tags: [codify, workflow, agent-rules, pull-request, ordering]
created: '2026-06-27'
---

# Run /codify's agent updates before the PR merges

## Rule

Run `/codify` — or at least its Step 7 `.claude/agents/*.md` updates — on the **feature
branch before the PR merges**, so the agent-rule changes ride the **same PR and review** as
the code they describe. Codifying *after* the squash-merge orphans the agent edits into a
brand-new branch + PR.

## Smell patterns

- You merged a PR, then ran `/codify` and discovered the agent-file edits have nowhere to
  land (the branch is gone, `main` is PR-only).
- A codify commit needs its own preflight + CI cycle for two lines of agent-doc changes.

## Why

`main` is PR-only (`enforce_admins` on), so a post-merge agent edit can't be pushed
directly — it needs a new branch + PR (#469 in this session), doubling the preflight + CI
cost for trivial doc changes. Worse, the delay opens a **divergence window**: a *sibling*
codify had already added a "Common Mistakes #15" to `testing-specialist.md` on `main`, so
the post-merge edit hit a `git stash pop` numbering conflict that had to be hand-resolved
(keep theirs, renumber mine to #16). Doing the agent updates inside the feature branch
avoids both the extra PR and the divergence.

The reuse-existing-review-signal step in codify already assumes the review and the codify
share a session — completing the agent updates before merge keeps that assumption true and
lets one reviewer see the change *and* the rule it produced.

## Exceptions

- The solution-DB docs (`npm run solutions:db:add`) can be written anytime — they live in
  the `ocrecipes_solutions` DB, not git, so they need no PR and aren't subject to this
  ordering. Only the git-tracked `.claude/agents/*.md` edits are.
- A deliberate post-merge codify of *someone else's* just-merged change (one you didn't
  branch from) legitimately needs its own PR — but expect the divergence-conflict risk and
  branch off **fresh** `origin/main`.

## Related Files

- `.claude/skills/codify/SKILL.md` — Step 7 commits the agent updates
- `.claude/agents/*.md` — the self-improvement targets

## See Also

- [isolate into a worktree when the concurrent-session guard warns](isolate-into-worktree-when-concurrent-session-guard-warns-2026-06-27.md) — the broader shared-state hygiene rule from the same session
