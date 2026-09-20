---
title: "todo-executor commits the archive and the codification AFTER its review step, so no /todo PR is ever stamp-clean at its head and the merge review gate denies every one"
status: backlog
priority: medium
created: 2026-09-20
updated: 2026-09-20
assignee:
labels: [deferred, harness]
github_issue:
---

# Every `/todo` PR reaches the merge gate with an unreviewable head

## Summary

`merge-review-guard.sh` is fail-closed and keys a review record to an **exact head SHA**. But
`todo-executor.md` runs its review at Step 6 and then creates **two more commits** — Step 8
(Commit & Archive) and Step 9 (Codify) — before Step 10 pushes and opens the PR. The head the gate
inspects therefore never equals any SHA a reviewer stamped. This is structural, not a bad run: it
happens on a flawless execution, every time.

## Measured, 2026-09-20

From a 5-todo `/todo` run. Reviewed SHA → head, with the commits that landed in between:

```
#999   reviewed 75e7ee7f  ->  head de1de3bc   (3 commits past)
  51c0df0a wip: address review round 1
  58ac9281 chore: archive ... as done            <- Step 8
  de1de3bc docs: codify ...                      <- Step 9

#1000  reviewed 45174d1f  ->  head 681b2b7e   (4 commits past)
  52032f28 wip: address round-1 review findings
  4a29625d wip: address round-2 review findings
  82fd5ba5 chore: 3 of 8 BottomSheetModal sites ... <- Step 8
  681b2b7e docs: codify ...                         <- Step 9
```

Root cause, measured directly:

```
$ grep -n -iE "stamp|merge-review|REVIEWED-SHA|re-review" .claude/agents/todo-executor.md
(no matches)
```

The executor has **no awareness of the merge review gate at all** — it never re-reviews after Step
8/9 and never checks whether a stamp covers the SHA it is about to push.

Consequence: an agent asked to merge a `/todo` PR is denied by the gate and must run a **fresh full
roster review** at the head first. On 2026-09-20 that meant 4 extra reviewer dispatches across two
PRs, after both had already been properly reviewed. Note the blast radius is the **agent merge
path** only — GitHub-native auto-merge armed by the executor does not consult this local gate, which
is why guard-eligible low-priority PRs still land unaided and this stayed invisible until someone
asked an agent to merge a `review-required` PR by hand.

## Background — a second, separate anomaly found alongside it

Only the **first** review round left a stamp. `45174d1f` and `75e7ee7f` each carry one, and both
`code-reviewer.json` files read `"verdict": "findings"` — the rounds that found the problems. The
round-2 reviews (which returned clean, per both executor reports) left **no stamp at any SHA**:

```
$ find /tmp/ocrecipes-review-stamps-*/ -name '*.json'
45174d1f/code-reviewer.json      findings
75e7ee7f/code-reviewer.json      findings
75e7ee7f/security-auditor.json   clean
902b6ecc/code-reviewer.json      clean      <- an unrelated main-branch review
902b6ecc/mobile-reviewer.json    clean
```

So even a PR whose head DID match a stamp could be denied, because the stamp on file records the
pre-fix verdict. Why round 2 wrote nothing is **not diagnosed** — a plausible cause is a reply whose
`REVIEWED-SHA:` block was malformed (a missing or marked-up label writes no stamp), but that was not
confirmed. Investigate before fixing; do not assume.

## Acceptance Criteria

- [ ] A `/todo` PR produced by a clean executor run arrives at its head with a stamp whose SHA
      equals that head and whose verdict is clean — demonstrated end-to-end on a real run, not
      argued from the step list.
- [ ] The chosen mechanism is recorded with its trade-off (see Implementation Notes — the three
      candidates cost very different amounts, and picking the cheapest silently is the failure mode
      this criterion exists to prevent).
- [ ] The second anomaly is either explained or explicitly deferred with a reason: determine why the
      round-2 (clean) reviews left no stamp. If it is a malformed `REVIEWED-SHA` block, the fix
      belongs with the reviewer contract, not here.
- [ ] A regression check exists that would catch a future reordering of Steps 6–10 reintroducing the
      drift. A fix that only works until someone moves a step pins nothing.
- [ ] Verified without weakening the gate. `merge-review-guard.sh` is fail-closed by design; a
      change that makes "no record" anything other than a deny is a regression, not a fix.

## Implementation Notes

Three candidate directions, with honestly different costs. This is a design choice, not a one-liner:

1. **Reorder** — move Step 9 (Codify) and the Step 8 archive commit BEFORE the Step 6 review, so
   the review covers the final tree. Cheapest, but the reviewer then also reviews the codification
   doc and the archive move, which widens every review's scope, and a review finding at Step 7 still
   produces a post-review commit — so this narrows the window without closing it.
2. **Re-review at Step 10** — after Step 9, dispatch a confirmation review at the final head purely
   to produce a stamp. Closes it completely, but adds a full roster dispatch to every todo, which is
   exactly the cost the 2026-09-17 batching decision exists to contain.
3. **Scope the stamp to reviewed FILES rather than the head SHA** — the gate already records a
   `reviewed_files_digest`. If Steps 8/9 only touch `todos/**` and `docs/solutions/**`, and those
   paths are provably outside the reviewed set, a stamp could legitimately carry forward. Most
   precise and cheapest at runtime, but it is a change to a **security gate's** matching rule, and a
   carry-forward rule that is too loose lets a real code change ride an old stamp. If this direction
   is chosen it needs adversarial review of its own.

Relevant files: `.claude/agents/todo-executor.md` (Steps 6–10), `.claude/hooks/merge-review-guard.sh`,
`.claude/hooks/review-stamp-writer.sh`, `docs/AI_WORKFLOW.md` (Review Policy — the reviewer prompt
that emits `REVIEWED-SHA`/`REVIEWED-FILES`).

Note that `todos/P3-2026-09-15-reviewer-contract-does-not-cover-the-handback-wrapper-line.md` already
touches the same reviewer-contract surface — check for overlap before starting, and sequence rather
than collide.

## Scope Contract

- **Mechanisms to use:** the existing review-stamp and merge-gate mechanisms. No new gate, no new
  stamp store.
- **Files in scope:** the four listed under Implementation Notes.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None hard. Overlaps the reviewer-contract todo named above; sequence them.

## Risks

- Direction 3 edits the matching rule of a fail-closed **security** gate. A too-permissive
  carry-forward silently re-opens the hole the gate exists to close, and would not show up as a test
  failure — it shows up as a merge that should not have happened.
- Direction 2's cost lands on every todo, including the low-priority ones that currently auto-merge
  with no human in the loop at all.
- Editing `.claude/hooks/**` triggers the Outward-CLI guard corpus check; expect the slow CI path.

## Updates

### 2026-09-20

- Filed at the user's request after the gap blocked an agent-driven merge of #999 and #1000. Step
  ordering, the zero-match grep, the per-PR commit drift, and the stamp inventory were all measured
  before filing.
