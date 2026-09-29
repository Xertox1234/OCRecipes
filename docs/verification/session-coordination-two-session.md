# Two-session coordination verification

Proves the v2 coordination layer end to end on a live machine:

- a collision block between two sessions;
- cross-worktree warnings;
- Bash write coverage;
- sibling-subagent warnings;
- checkpoint recovery;
- a negative control.

Everything happens at the laptop, in three terminal windows. Nothing is pushed and no PRs are
opened. Spec: `docs/superpowers/specs/2026-09-27-session-coordination-v2-design.md` §9.5
(local-only). Shipped in #1132, #1134, #1136, #1137; the ask became a block on 2026-09-28.

Four things differ from the spec:

- **A block, not an ask.** The first run of this runbook (2026-09-28) showed the ask prompt with
  no reason, so the user approved it blind. Now the first edit is blocked, the block's reason goes
  to Claude, and Claude tells you in its chat reply which session holds the file and asks whether
  to go ahead. If you say yes, the retry goes through.
- **Siblings warn, never block** (user decision 2026-09-28). A subagent of the _same_ session gets
  the warning text, because nothing signals that a subagent has finished. Scenario 4 expects a
  warning.
- **Spec §9.5's scenario 4 is replaced.** Its version had a subagent edit the other session's file.
  This runbook's scenario 4 exercises the same-session sibling branch instead, which otherwise has
  no live check.
- **Known order-dependence**:
  [`todos/P2-2026-09-28-coord-collision-ask-order-dependent.md`](../../todos/P2-2026-09-28-coord-collision-ask-order-dependent.md).
  When a file has more than one holder, the first in the (unordered) snapshot decides. If a stale
  or sibling holder is listed first, a scenario that expects a **block** may show a **warning**.
  Scenarios 1 and 3 have one live holder each, so they should block reliably. Record any
  warn-instead-of-block as evidence for that todo.

## Setup (terminal 1)

The fixture files are committed, so scenario 5's `git checkout --` has a committed version to
restore.

```bash
cd ~/projects/OCRecipes
git worktree add .claude/worktrees/probe-coord-a -b probe/coord-a origin/main
git worktree add .claude/worktrees/probe-coord-b -b probe/coord-b origin/main
for w in a b; do d=.claude/worktrees/probe-coord-$w
  mkdir -p $d/scratch/coord-probe
  for n in one two three four five; do printf '%s\n' $n > $d/scratch/coord-probe/$n.ts; done
  git -C $d add scratch/coord-probe && git -C $d commit -q --no-verify -m "probe fixtures"; done
START=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "START=$START"
```

Keep terminal 1 open; the evidence and cleanup steps run there and need `$START`.

Open **terminal 2** and start session A:

```bash
cd ~/projects/OCRecipes/.claude/worktrees/probe-coord-a && claude
```

Open **terminal 3** and start session B:

```bash
cd ~/projects/OCRecipes/.claude/worktrees/probe-coord-b && claude
```

Any permission mode works: a block applies in every mode, including auto.

## Scenarios

Type each prompt into the session named in "Send to". Replace `$A` and `$B` with the full paths
(`~/projects/OCRecipes/.claude/worktrees/probe-coord-a` and `…/probe-coord-b`) before sending.
A result marked "in B's reply" appears as Claude's chat text in terminal 3, not as a permission
prompt.

| #   | Send to               | Prompt                                                                                                                                                                                         | Expected                                                                                                                                                                                                                                                                          |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A                     | `Append the line "a1" to $A/scratch/coord-probe/one.ts and to $A/scratch/coord-probe/five.ts.`                                                                                                 | runs normally                                                                                                                                                                                                                                                                     |
| 1   | B (wait ≥ 60 s first) | `Append the line "b1" to $A/scratch/coord-probe/one.ts.`                                                                                                                                       | **blocked.** In B's reply, Claude names A's session (its first 8 characters, branch `probe/coord-a`) and asks whether to go ahead. **Answer no.**                                                                                                                                 |
| 2   | B                     | `Append the line "b2" to $B/scratch/coord-probe/one.ts.`                                                                                                                                       | runs; Claude mentions a warning that the same file is being edited in another worktree                                                                                                                                                                                            |
| 3   | B                     | `Run: rm $A/scratch/coord-probe/five.ts`                                                                                                                                                       | **blocked**, naming A, as in scenario 1. **Answer no.** (A different file from scenario 1, because a file is only blocked once per 15 min.)                                                                                                                                       |
| 4   | A                     | `Dispatch a background general-purpose subagent to append "s1" to $A/scratch/coord-probe/two.ts. Wait 30 seconds, then dispatch a second background subagent to append "s2" to the same file.` | the second subagent is **not blocked**, and gets a warning naming the first ("…in this same session…"). The 30 s wait matters: each check reads a snapshot of other agents' edits that is refreshed only when it is over 25 s old, so an edit made seconds earlier can be missed. |
| 5   | A                     | `Append "c1" to $A/scratch/coord-probe/three.ts, dispatch a general-purpose subagent to read that file, then run: git checkout -- scratch/coord-probe/three.ts`                                | afterwards, in terminal 1, `bash scripts/checkpoint.sh list` shows a checkpoint whose tree has "c1", and `git restore --source=<ref> --worktree -- scratch/coord-probe/three.ts` (run in `probe-coord-a`) brings it back                                                          |
| 6   | A and B               | A: `Append "n" to $A/scratch/coord-probe/three.ts.` B: `Append "n" to $B/scratch/coord-probe/four.ts.`                                                                                         | **negative control:** no block, no warning. B uses `four.ts`, which nothing earlier touched.                                                                                                                                                                                      |

Scenario 5 must use a literal `git`. `/usr/bin/git checkout …` takes no checkpoint; this is a
documented residual in `docs/harness-residuals.md`. The Agent-dispatch checkpoint still covers it.

## Evidence (terminal 1)

```bash
psql -X -qtA -d postgresql://localhost/ocrecipes_lab -c "SELECT event, count(*) FROM harness.coordination_log WHERE ts >= '$START' GROUP BY 1 ORDER BY 1"
git for-each-ref refs/checkpoints/ --format='%(refname) %(committerdate:iso8601)'
```

The run passes when all of the following hold:

- `block-collision` ≥ 2 of the 2 attempted (scenarios 1 and 3), and in both, B's reply named A's
  session before anything was changed;
- `warn-collision-sibling` ≥ 1 of 1 (scenario 4), with **no** block for scenario 4;
- `warn-worktree` ≥ 1 of 1 (scenario 2);
- a checkpoint ref exists and restores scenario 5's line;
- scenario 6 added **no** block or warning rows. Take the counts just before and just after it and
  compare.

Also count any `block-downgraded` rows and their `reason` (in the `detail` JSON):

```bash
psql -X -qtA -d postgresql://localhost/ocrecipes_lab -c "SELECT detail->>'reason', count(*) FROM harness.coordination_log WHERE ts >= '$START' AND event = 'block-downgraded' GROUP BY 1"
```

## Cleanup (terminal 1, after exiting both sessions)

```bash
git worktree remove --force .claude/worktrees/probe-coord-a
git worktree remove --force .claude/worktrees/probe-coord-b
git branch -D probe/coord-a probe/coord-b
psql -X -q -d postgresql://localhost/ocrecipes_lab -c "DELETE FROM harness.coordination_log WHERE ts >= '$START'"
```
