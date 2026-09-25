---
title: "todo-executor commits the archive and the codification AFTER its review step, so no /todo PR is ever stamp-clean at its head and the merge review gate denies every one"
status: done
priority: medium
created: 2026-09-20
updated: 2026-09-24
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

- [x] A `/todo` PR produced by a clean executor run arrives at its head with a stamp whose SHA
      equals that head and whose verdict is clean — demonstrated end-to-end on a real run, not
      argued from the step list.
- [x] The chosen mechanism is recorded with its trade-off (see Implementation Notes — the three
      candidates cost very different amounts, and picking the cheapest silently is the failure mode
      this criterion exists to prevent).
- [x] The second anomaly is either explained or explicitly deferred with a reason: determine why the
      round-2 (clean) reviews left no stamp. If it is a malformed `REVIEWED-SHA` block, the fix
      belongs with the reviewer contract, not here.
- [x] A regression check exists that would catch a future reordering of Steps 6–10 reintroducing the
      drift. A fix that only works until someone moves a step pins nothing.
- [x] Verified without weakening the gate. `merge-review-guard.sh` is fail-closed by design; a
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

### 2026-09-20 (investigation — the second anomaly is EXPLAINED, and it re-sequences this todo)

**The round-2 no-stamp anomaly is residual 6 / the hand-back wrapper, confirmed per-case —
not a malformed `REVIEWED-SHA` block.** Measured against the reviewer subagent transcripts at
`~/.claude/projects/-Users-williamtower-projects-OCRecipes/bb8e9f55-*/subagents/`, which is
where executor-dispatched reviewer replies actually live (they are NOT in the parent session
transcript — every record there is `isSidechain: false`).

#999's round-2 review (`agent-ab196e1c051f8e5cd.jsonl`) is **fully contract-compliant**:
exactly one `SubagentHandback`, `REVIEWED-SHA: 51c0df0ab0ba6ceacf4e87cd652d2716bde6bef2`,
last non-empty line `No findings.`. It wrote no record because the **delivered wrapper** reads:

> Both prior findings (CRITICAL on the Scope Contract, WARNING on the mutation-discrimination
> gap) are resolved, verified empirically rather than by trusting the implementer's writeup.

Running `review-stamp-writer.sh`'s literal arm-2 predicate over that wrapper under bash 5.3.15
FIRES; the control wrapper `Report delivered to caller.` does not. The block is reached because
the wrapper lacks `^REVIEWED-SHA:`, which is the documented gate on guard (a).

**Population, one session, 36 roster hand-backs each carrying a contract-compliant
`REVIEWED-SHA`.** Every one was delivered asynchronously — in all 36 the final assistant text
is a wrapper, never the report — so guard (a) governed every stamp decision in the run:

|                         | own record written | none |
| ----------------------- | ------------------ | ---- |
| wrapper trips guard (a) | 4                  | 8    |
| wrapper does not trip   | 19                 | 5    |

The 4 top-left cells are **not** counter-examples and must not be read as "the guard sometimes
allows": all four sit at the single SHA `902b6ecc`, which was reviewed repeatedly by the same
two agent types, and each has a same-SHA same-agent NON-tripping sibling that wrote the record.
Excluding that SHA the guard is exact — **8 of 8 tripping wrappers produced no record from that
reviewer.** The 5 bottom-right cells all carry `clean=0` (no `No findings.` last line), i.e.
residual 3 (WARNING-only findings), a different and already-documented cause.

**Exactly one of the 8 was a genuinely clean review** — #999's round 2. That is the whole cost
here: one denied merge per clean confirmation round.

**Consequence for sequencing.** Of the 36 hand-backs, **16 carried a clean `No findings.`
verdict; 15 of those wrote their record and 1 did not** — the one that tripped is #999's round 2.
Of the two identifiable round-2 confirmation reviews, **one tripped (`51c0df0a`) and one did not
(`52032f28`, code + mobile — those two carry `clean=0` and fall under residual 3 instead)**. So
the rate is 1/16 over clean reviews and 1/2 over confirmation-shaped ones; do NOT read either as
"confirmation reviews usually trip". What IS an argument rather than a rate: a confirmation
wrapper naturally summarises the findings it just verified resolved, and naming them is exactly
what arm 2 matches — which is the mechanism behind the single observed case.

This makes `todos/P3-2026-09-15-reviewer-contract-does-not-cover-the-handback-wrapper-line.md`
a **behavioural dependency, not a blocker**: the two todos share no line of text, and a stamping
mechanism here succeeds in 15 of 16 measured clean cases without P3. The residual is closed
cheaply by a runtime property check (below) plus one re-dispatch. Worth deciding explicitly: the
_dispatch-prompt half_ of P3 — one paragraph telling the reviewer to keep the text it writes
after the hand-back free of the three severity words — lands in `docs/AI_WORKFLOW.md`, which is
already in this todo's scope, and it is what makes this todo's first acceptance criterion
reliable rather than 15/16. P3 also now has the per-case wrapper attribution its own "Observed
rate" section asked a future reader to capture before concluding.

**Also measured, and not in the original filing:** under `todo-executor.md` as written the
implementation is _uncommitted_ at Step 6 (Step 5a says so explicitly; Step 6 diffs `HEAD -- .`),
so a spec-following run reports `REVIEWED-SHA` = the **base** commit, which does not contain the
reviewed code. A second consequence follows **by construction** from `review_stamp_dir` keying the
directory on the SHA alone plus the writer's non-atomic `> "$DIR/${AGENT_TYPE}.json"`, and was NOT
observed in this run: up to 4 concurrent executors branching from one base would share a single
stamp directory, one file per `agent_type`, and overwrite each other. The outcome is still
fail-closed — their digests differ, so the gate denies on scope rather than allowing.
The `wip:` commits in #999/#1000 appear nowhere in `todo-executor.md` or `todo-fast/SKILL.md`
(`grep -n 'wip:'` returns nothing in either); the executors improvised them. "3 commits past" is
therefore the improvised-BETTER case, and any fix must also mandate commit-before-dispatch.

### 2026-09-20 (DECISION + implementation)

**Direction 2, minimized** — one `code-reviewer` confirmation pass at the final head, placed after
push + PR creation, skipped when auto-merge is armed. Chosen by the user after the analysis below;
recorded here with its cost, which is the point of acceptance criterion 2.

**Why not Direction 1 (reorder).** Not "cheap but incomplete" — _structurally incapable_. The gate
digests `gh pr diff --name-only`, i.e. **every** file in the PR, and the archive move and the
solution file are PR files. A record written before Step 9 can therefore never carry a matching
digest no matter where the review sits. It also inverts a real dependency: Step 9 consumes
`review_output` to decide what to codify, so codify cannot precede review.

**Why not Direction 3 (carry the stamp forward).** It is an allowlist inside a deny predicate —
the shape that failed open in #995 and is codified in
`docs/solutions/logic-errors/an-allowlist-inside-a-deny-predicate-fails-open-2026-09-19.md`. And it
is unimplementable as written: Step 9 also writes `.claude/agents/*.md` and `docs/rules/*.md`, so
the carry-forward allowlist would have to whitelist the **reviewer definitions themselves**.

**What Direction 2 actually costs, corrected.** The todo priced it as "a full roster dispatch to
every todo". Measured against the gate: the record loop never filters `agent_type` and matches on
**any single** clean record with the right digest (`merge-review-guard.sh` scope test), so the pass
is **one** reviewer, not three — and it is skipped entirely whenever auto-merge is armed, since
that path never consults the local gate. Residual cost: one `code-reviewer` dispatch per
`held`/`unknown`/`review-required` todo. It also buys coverage that did not exist: Step 9's
codification, written by `kimi-write` and read back by future executors at Step 3a, has until now
shipped **completely unreviewed**.

**Also fixed, beyond the original filing.** `todo-executor.md` left the implementation uncommitted
at Step 6, so a spec-following run stamped the base commit. A new **commit gate** between Steps 5a
and 5b commits before any reviewer is dispatched, Step 6 became a branch review of `$BASE...HEAD`,
Step 7 commits fixes before re-review, and Step 8 is archive-only.

**Files changed** (three beyond the Scope Contract's four, all disclosed):
`.claude/agents/todo-executor.md`, `docs/AI_WORKFLOW.md` — in scope.
`.claude/skills/todo-fast/SKILL.md` — **out of the stated contract**, three stale enumerations that
mirror the steps changed here (Phase 6's sub-step list, Phase 10's Step-10 item list, Phase 11's
field list). Left alone they would describe a pipeline that no longer exists.
`todos/P3-2026-09-15-reviewer-contract-does-not-cover-the-handback-wrapper-line.md` — **out of the
stated contract**, narrowed to its remaining half after the user's decision to absorb its
dispatch-prompt paragraph here; its own 2026-09-20 entry records the split.
This todo file — the Updates entries above.

That list was originally written by hand and came out **one path short** — it omitted the P3 todo
and said "two beyond" where the diff shows three. Caught in review. The irony is the point and is
left recorded rather than quietly corrected: this is the PR that adds "never hand-assemble that
list", and the hand-assembled list in its own todo reproduced the exact defect, one path short, in
the same direction as PR #994's.
`merge-review-guard.sh` and `review-stamp-writer.sh` were **not touched at all**, which is the
strongest available form of acceptance criterion 5.

**Acceptance criterion 1 is NOT met by this PR and is deliberately left unchecked.** It requires an
end-to-end demonstration on a real `/todo` run; this change is to the instructions that drive that
run. The first `/todo` execution after merge is the demonstration, and Step 11's new
`REVIEW_STAMP:` field is where it reports. Close this todo only once a real run has shown
`REVIEW_STAMP: clean at <sha>`.

**On the regression check (criterion 4), stated without overclaim.** It is the runtime property
check in Step 10 step 7c: the executor asserts a clean record exists at the PR's head SHA with a
digest equal to the gate's own formula, and reports honestly when it does not. It pins the property
the gate keys on rather than the position of a heading, so it survives rewording and fails on the
very next run if a commit-producing step is moved after it. It is enforced **by the agent at
runtime, not by CI** — nothing in the test suite executes this markdown.

### 2026-09-24 (acceptance criterion 1 MET on a real run; one drift fixed; closed)

**Criterion 1 is shown by PR #1008**, a `/todo` executor run that reported `MERGE_ELIGIBLE: held`,
so the Step 10.7 confirmation pass ran. Each property was checked against its primary source,
not against the executor's own report:

```
$ gh pr view 1008 --json state,headRefOid
MERGED  5962512b78e77796c5893257aebf10b6184a0c94
$ jq -c '{verdict,head_sha,reviewed_files_digest,unresolved,agent_type}' \
    /tmp/ocrecipes-review-stamps-07d4e12e42b1/5962512b78e77796c5893257aebf10b6184a0c94/code-reviewer.json
{"verdict":"clean","head_sha":"5962512b78e77796c5893257aebf10b6184a0c94","reviewed_files_digest":"2acd83b4c4556b4f","unresolved":[],"agent_type":"code-reviewer"}
$ gh pr diff 1008 --name-only | sed '/^$/d' | sort -u | shasum | cut -c1-16    # the gate's formula
2acd83b4c4556b4f
```

The head SHA equals the merged head, the verdict is clean with nothing unresolved, and the digest
equals the gate's own formula. That digest covers the archived todo and the solution file, so the
record can only have come from a review taken after Step 9. The outputs are pasted here because the
record lives in `/tmp` and a reboot wipes it. A second instance is #1049 (`held`): head `3cc6cebb`
equals its merged head and digest `d8b6643607c4c61c` matches, but the verdict is `advisory`, so it is
not the evidence for a criterion that says "clean".

**Drift fixed in this PR.** The 2026-09-22 one-review-pass ruling (#1015) widened
`merge-review-guard.sh` to accept `advisory` as well as `clean` (pinned by the advisory case in
`test-merge-review-guard.sh`), and `docs/AI_WORKFLOW.md` was updated with it. `todo-executor.md`
Step 10.7 was not. Its step-c check still selected `.verdict=="clean"` only, so on an advisory-only
review a spec-following executor would get an empty match, spend the re-dispatch for nothing, and
report `none at` for a PR the gate would admit. Executors improvised around the gap:
#1038 reported `advisory at …`, #1049 reported `clean at … verdict advisory`, and #1039/#1040/#1047/#1055
reported `clean at` for records that are `advisory` on disk. The fix changes the 7b prose and the 7c
jq to `clean or advisory`, makes 7c print the verdict, and adds `advisory at` to the Step 11
`REVIEW_STAMP` enum. Measured by extracting both jq programs literally from the old and new files and
running them against the real records (3 rows, 1 record each):

```
3cc6cebb digest=d8b6643607c4c61c records=1 old=[]              new=[advisory code-reviewer]
5962512b digest=2acd83b4c4556b4f records=1 old=[code-reviewer] new=[clean code-reviewer]
5962512b digest=0000000000000000 records=1 old=[]              new=[]      <- wrong-digest control
```

Synthetic controls: `findings` with an empty `unresolved`, and `advisory` with a non-empty
`unresolved`, both still select nothing.

**Observed, not filed.** #1047 and #1055 ran the 7b confirmation pass although step 5 reported
`MERGE_ELIGIBLE: yes`. That is a wasted dispatch with no effect on the gate. #1055 also reported a
stamp at `21c01cec`, which is not its merged head `6847234f`, so a report taken before the head
moved does not describe the PR as merged. For #1009/#1038/#1039/#1040 the head moved past the
executor's record at merge time, which is outside the executor, and the gate correctly asked for a
fresh record each time.
