---
title: "A resumed reviewer never writes a merge stamp — re-adjudicate a finding by dispatching a FRESH reviewer that carries the evidence"
track: knowledge
category: conventions
module: shared
tags: [harness, agents, tooling, code-review, merge-gate, review-stamp]
applies_to: [".claude/hooks/**", ".claude/agents/*.md", ".claude/skills/**"]
created: '2026-09-22'
---

# A resumed reviewer never writes a merge stamp — re-adjudicate a finding by dispatching a FRESH reviewer that carries the evidence

## Rule

When a roster reviewer files a finding you have evidence against, do **not** resume that reviewer
(`SendMessage` to its agent id) to argue it. Dispatch a **new** reviewer whose prompt carries the
evidence and the prior round's settled questions as context, and let it decide. A resumed reviewer
can withdraw the finding and reply with a contract-perfect clean report — both machine-parsed
blocks present, a literal `No findings.` last line — and the merge gate will still see **no
record**.

Corollary for every dispatch prompt: tell the reviewer to deliver its report **once, in a single
hand-back**.

## Smell patterns

- A `SendMessage` to a reviewer's agent id after that agent has already handed a report back.
- A clean `No findings.` reply visible in the conversation while `review_stamp_dir <sha>` prints
  a directory that does not exist.
- "The reviewer agreed it was fine" offered as the reason a merge should now pass.

## Why

`.claude/hooks/review-stamp-writer.sh` (SubagentStop) takes the report from the agent's
`SubagentHandback`, and only when the transcript contains **exactly one**. A resumed reviewer's
transcript holds two: hand-back #1 (the finding) and hand-back #2 (the withdrawal). Taking the
last would silently drop an objection — the fail-OPEN direction for a gate whose whole purpose is
to refuse a merge nobody cleared — so the writer refuses to choose and writes nothing. The
writer's own comment block ("EXACTLY ONE HANDBACK") records this as deliberate: otherwise any agent
could launder a finding away by simply being asked again.

Measured 2026-09-22 on PR #960. `code-reviewer` filed one finding at head `fb1ae735`. Resumed with
git evidence, it withdrew the finding on the merits and replied with `REVIEWED-SHA`,
`REVIEWED-FILES` and `No findings.` as its last line — and
`review_stamp_dir fb1ae73582d1b9a10ab36b9c75a88d02a3b77601` did not exist. A fresh `code-reviewer`
dispatched with the same evidence stamped `verdict: clean` on its first and only hand-back (digest
`a5e33964ee10a937`, matching `gh pr diff 960 --name-only`). Cost of not knowing this: one extra
review round of roughly five minutes.

This is a **second, independent** failure mode. The older one — a resumed reviewer drops the two
machine-parsed blocks unless explicitly re-asked — was avoided here by re-asking; the blocks were
present and correct, and the record was still refused.

## Examples

Wrong — argues with the agent that filed it:

```
SendMessage(to: "<reviewer agent id>", message: "Evidence A, B, C says the finding is not a
contradiction. Please re-adjudicate and re-issue the two blocks.")
```

Right — a fresh dispatch that carries the same evidence and may still disagree:

```
Agent(subagent_type: "code-reviewer", prompt: "<canonical dispatch prompt from
docs/AI_WORKFLOW.md> ... Context: a previous round raised X. Evidence A, B, C says it is not a
contradiction; you are free to disagree if the tree says otherwise, but do not re-derive it just
to demonstrate effort. ... Deliver your report ONCE, in a single hand-back.")
```

Then measure, never assume:

```bash
. .claude/hooks/lib/review-stamp-path.sh; ls "$(review_stamp_dir <40-char sha>)"
```

## Exceptions

- Resuming a reviewer is still fine for a **question** whose answer you will act on yourself
  ("which probe did you run?", "which line?"). It is never the path to a record.
- If the finding is **real**, fix it and push. The push invalidates every stamp on the old head
  anyway, and the confirmation pass at the new head is a fresh dispatch by construction.

## Related Files

- `.claude/hooks/review-stamp-writer.sh` — the one-hand-back refusal and its rationale
- `.claude/hooks/merge-review-guard.sh` — the reader that then reports "no record"
- `docs/AI_WORKFLOW.md` → Review Policy → Confirmation pass — the orchestrator-side rule, and the
  dispatch prompt's "deliver once" sentence

## See Also

- [an archive move git reads as delete plus add](../code-quality/an-archive-move-git-reads-as-delete-plus-add-mis-scopes-the-review-stamp-2026-09-17.md) — the other way a flawless review yields no usable record (the scope digest)
- [a path move leaves sibling citations stale](../code-quality/a-path-move-leaves-sibling-citations-stale-grep-the-old-path-2026-09-22.md) — the finding the re-adjudication round was about
