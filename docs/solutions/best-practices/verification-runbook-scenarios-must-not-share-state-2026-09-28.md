---
title: 'A verification runbook''s scenarios carry state into each other — trace every marker and time-window row a step leaves, or a correct system fails a later step'
track: knowledge
category: best-practices
module: shared
tags: [harness, pg-lab, verification, runbook, testing]
applies_to: [docs/verification/**/*.md, scripts/pg-lab/**, .claude/hooks/test-*.sh]
created: '2026-09-28'
---

# A verification runbook's scenarios carry state into each other

## When this applies

Writing a manual or semi-manual verification runbook, meaning a numbered sequence of scenarios
run against one live system, where the system keeps state between scenarios. Examples are
approval markers, time-window rows (like "touched in the last 15 min") and caches. Every
scenario can be correct on its own while the **sequence** makes a later expectation false.

## Rule

For each scenario, list the state it **leaves behind** and check it against every **later**
scenario's expectation. Where one step would change a later step's outcome, isolate them:

- give each scenario its own fresh file or key;
- add an explicit step that sets the state the next scenario needs (e.g. "deny it").

A negative control needs a key that **no earlier scenario touched**.

## Why

Measured on the session-coordination runbook (#1139). Its review probed the doc against a
correct tree, and two expectations turned out false as sequenced:

- **An approval leaked forward.** Scenario 1 asked, and the natural action is to approve.
  Approving wrote `approved` for (file, holder, agent). Scenario 3 targeted the same file,
  holder and agent, so ask-once correctly suppressed its ask. The criterion "`ask-collision` ≥ 2
  of 2" then failed on a bug-free system.
- **A time-window row leaked into the negative control.** Scenario 4 left a fresh row on
  `two.ts` in worktree A. Scenario 6's "no ask, no warning" control edited `two.ts` in worktree
  B, which shares the relative path, so the worktree tier correctly warned. The control failed
  on a correct system.

Both were fixed in #1142: scenario 1 now says **deny it**, and scenario 6 uses a fresh `four.ts`.
A runbook that false-fails is worse than none, because the operator either stops trusting it or
"fixes" the working system to match it.

## Examples

- Table each scenario as *leaves → affects*: "1: pending→(deny) purged at 3 · 2: B row on
  one.ts · 4: A rows on two.ts (15 min) · 5: checkpoint ref".
- Put the reason next to any required operator action, so nobody "optimises" it away: "**Deny
  it.** Approving would suppress scenario 3's ask (ask-once)".
- Have the runbook's reviewer run it against the real mechanism, with a control per claim,
  rather than just read it. Both leaks here came from constructed probes.

## Exceptions

A scenario that deliberately tests carry-over (e.g. "approve once, then the second edit is not
asked") should **depend on** the earlier state. Label that dependency in the scenario, and don't
reuse its keys elsewhere.

## Related Files

- `docs/verification/session-coordination-two-session.md`

## See Also

- [pending approval marker promoted into a silent approval](../logic-errors/pending-approval-marker-promoted-into-a-silent-approval-2026-09-28.md): the marker lifecycle behind the first leak
