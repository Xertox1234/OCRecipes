# Two-session coordination verification

Proves the v2 coordination layer end to end on a live machine:

- collision asks between sessions, including over Remote Control;
- cross-worktree warnings;
- Bash write coverage;
- sibling-subagent warnings;
- checkpoint recovery;
- a negative control.

Nothing is pushed and no PRs are opened. Spec:
`docs/superpowers/specs/2026-09-27-session-coordination-v2-design.md` §9.5 (local-only). Shipped in
#1132, #1134, #1136, #1137.

Two things differ from the spec:

- **Siblings warn, never ask** (user decision 2026-09-28). A sibling subagent of the _same_ session
  gets the warning text, never an ask, because nothing signals that a subagent has finished.
  Scenario 4 below expects a warning.
- **Known order-dependence**:
  [`todos/P2-2026-09-28-coord-collision-ask-order-dependent.md`](../../todos/P2-2026-09-28-coord-collision-ask-order-dependent.md).
  When a file has more than one holder, the first in the (unordered) snapshot decides. If a stale
  or sibling holder is listed first, a scenario that expects an **ask** may show a **warning**.
  Scenarios 1 and 3 have one live holder each, so they should ask reliably. Record any
  warn-instead-of-ask as evidence for that todo.

## Setup (one terminal)

```bash
cd ~/projects/OCRecipes
git worktree add .claude/worktrees/probe-coord-a -b probe/coord-a origin/main
git worktree add .claude/worktrees/probe-coord-b -b probe/coord-b origin/main
for w in a b; do mkdir -p .claude/worktrees/probe-coord-$w/scratch/coord-probe
  printf 'one\n' > .claude/worktrees/probe-coord-$w/scratch/coord-probe/one.ts
  printf 'two\n' > .claude/worktrees/probe-coord-$w/scratch/coord-probe/two.ts
  printf 'three\n' > .claude/worktrees/probe-coord-$w/scratch/coord-probe/three.ts; done
START=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "START=$START"
```

Launch **session A** in `.claude/worktrees/probe-coord-a` and **session B** in
`.claude/worktrees/probe-coord-b`, each with `claude --permission-mode auto --remote-control`.
Keep your phone on Remote Control.

## Scenarios

Let `A=<absolute path of probe-coord-a>`, `B=<absolute path of probe-coord-b>`.

| #   | Send to               | Prompt                                                                                                                                                                        | Expected                                                                                                                                                                        |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A                     | `Append the line "a1" to $A/scratch/coord-probe/one.ts.`                                                                                                                      | runs normally                                                                                                                                                                   |
| 1   | B (wait ≥ 60 s first) | `Append the line "b1" to $A/scratch/coord-probe/one.ts.`                                                                                                                      | **ask** naming A's session, on the terminal and the phone                                                                                                                       |
| 2   | B                     | `Append the line "b2" to $B/scratch/coord-probe/one.ts.`                                                                                                                      | warning: same file in another worktree                                                                                                                                          |
| 3   | B                     | `Run: rm $A/scratch/coord-probe/one.ts`                                                                                                                                       | **ask** naming A (deny it)                                                                                                                                                      |
| 4   | A                     | `Dispatch a background general-purpose subagent to append "s1" to $A/scratch/coord-probe/two.ts; then dispatch a second background subagent to append "s2" to the same file.` | the second subagent gets a **warning** naming the first subagent ("…in this same session…"), **no ask**                                                                         |
| 5   | A                     | `Append "c1" to $A/scratch/coord-probe/three.ts, dispatch a general-purpose subagent to read that file, then run: git checkout -- scratch/coord-probe/three.ts`               | afterwards `bash scripts/checkpoint.sh list` shows a checkpoint whose tree has "c1", and `git restore --source=<ref> --worktree -- scratch/coord-probe/three.ts` brings it back |
| 6   | A and B               | A: `Append "n" to $A/scratch/coord-probe/three.ts.` B: `Append "n" to $B/scratch/coord-probe/two.ts.`                                                                         | **negative control:** no ask, no warning                                                                                                                                        |

Scenario 5 must use a literal `git`. `/usr/bin/git checkout …` takes no checkpoint; this is a
documented residual in `docs/harness-residuals.md`. The Agent-dispatch checkpoint still covers it.

## Evidence (observed / attempted)

```bash
psql -X -qtA -d postgresql://localhost/ocrecipes_lab -c "SELECT event, count(*) FROM harness.coordination_log WHERE ts >= '$START' GROUP BY 1 ORDER BY 1"
git for-each-ref refs/checkpoints/ --format='%(refname) %(committerdate:iso8601)'
```

The run passes when all of the following hold:

- `ask-collision` ≥ 2 of the 2 attempted (scenarios 1 and 3);
- `warn-collision-sibling` ≥ 1 of 1 (scenario 4), with **no** ask shown for scenario 4;
- `warn-worktree` ≥ 1 of 1 (scenario 2);
- a checkpoint ref exists and restores scenario 5's line;
- scenario 6 added **no** ask or warning rows. Take the counts just before and just after it and
  compare.

Record the phone observations for scenarios 1 and 3. Also count any `ask-downgraded` rows and
their `reason` (in the `detail` JSON):

```bash
psql -X -qtA -d postgresql://localhost/ocrecipes_lab -c "SELECT detail->>'reason', count(*) FROM harness.coordination_log WHERE ts >= '$START' AND event = 'ask-downgraded' GROUP BY 1"
```

## Cleanup

```bash
git worktree remove --force .claude/worktrees/probe-coord-a
git worktree remove --force .claude/worktrees/probe-coord-b
git branch -D probe/coord-a probe/coord-b
psql -X -q -d postgresql://localhost/ocrecipes_lab -c "DELETE FROM harness.coordination_log WHERE ts >= '$START'"
```
