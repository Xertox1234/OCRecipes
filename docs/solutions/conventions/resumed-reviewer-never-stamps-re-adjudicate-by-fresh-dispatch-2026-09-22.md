---
title: "Never resume a reviewer to re-adjudicate a finding — a second hand-back is refused, and a plain-text re-issue stamps over its own objection; dispatch a FRESH reviewer that carries the evidence"
track: knowledge
category: conventions
module: shared
tags: [harness, agents, tooling, code-review, merge-gate, review-stamp]
applies_to: [".claude/hooks/**", ".claude/agents/*.md", ".claude/skills/**"]
created: '2026-09-22'
---

# Never resume a reviewer to re-adjudicate a finding — a second hand-back is refused, and a plain-text re-issue stamps over its own objection; dispatch a FRESH reviewer that carries the evidence

## Rule

When a roster reviewer files a finding you have evidence against, do **not** resume that reviewer
(`SendMessage` to its agent id) to argue it. Dispatch a **new** reviewer whose prompt carries the
evidence and the prior round's settled questions as context, and let it decide.

A resumed reviewer's second report lands in one of two shapes, and both are wrong for you:

- **It hands back a second time.** The writer requires exactly one hand-back per agent transcript
  and refuses to choose between an objection and a later withdrawal, so it writes **nothing** —
  even when the second report carries both machine-parsed blocks and a literal `No findings.`
  last line. Measured live on PR #960.
- **It re-issues the contract as plain text, with no second hand-back.** The writer takes
  delivered text that carries `REVIEWED-SHA:` directly and never reaches the hand-back count, so
  that text is stamped as-is — and because records are one file per agent type per head, it
  **overwrites the same agent's earlier objection record** with a clean verdict. Measured on
  constructed transcripts against the live hook during PR #1010's review (a live resumed reviewer
  doing this was not observed); the structure is confirmed in the writer, where the whole
  hand-back fallback sits inside the `! grep -q '^REVIEWED-SHA:'` branch.

The first shape costs a review round. The second is the laundering the gate exists to refuse —
and it is the orchestrator's resume that makes it possible. Either way, the fresh dispatch is the
only path to a record you can trust.

Corollary for every dispatch prompt: tell the reviewer to deliver its report **once, in a single
hand-back**.

## Smell patterns

- A `SendMessage` to a reviewer's agent id after that agent has already handed a report back.
- A clean `No findings.` reply visible in the conversation while `review_stamp_dir <sha>` prints
  a directory that does not exist — or, worse, one whose record was written **after** an
  objection you can see in the same agent's transcript.
- "The reviewer agreed it was fine" offered as the reason a merge should now pass.

## Why

`.claude/hooks/review-stamp-writer.sh` (SubagentStop) reads the agent's delivered text as `$MSG`.
If `$MSG` already carries `^REVIEWED-SHA:`, it is parsed directly. Only when it does not — the
hand-back case, where the delivered text is a short wrapper line — does the writer fall back to
the transcript: it refuses if the wrapper itself objects, then counts `SubagentHandback` entries
and substitutes the report only when there is **exactly one**. Any other count leaves `$MSG` as
the contract-less wrapper, the sha parse yields nothing, and the hook exits without writing. The
writer's own comment block ("EXACTLY ONE HANDBACK") records the refusal as deliberate: taking the
last hand-back would silently drop an objection, the fail-OPEN direction for a gate whose whole
purpose is to refuse a merge nobody cleared.

Measured 2026-09-22 on PR #960, hand-back shape: `code-reviewer` filed one finding at head
`fb1ae735`. Resumed with git evidence, it withdrew the finding on the merits and replied through a
second hand-back carrying `REVIEWED-SHA`, `REVIEWED-FILES` and `No findings.` — and
`review_stamp_dir fb1ae73582d1b9a10ab36b9c75a88d02a3b77601` did not exist. A fresh `code-reviewer`
dispatched with the same evidence stamped `verdict: clean` on its first and only hand-back (digest
`a5e33964ee10a937`). Cost: one extra review round of roughly five minutes.

Measured the same day on constructed transcripts (PR #1010 review, `REVIEW_STAMP_ROOT` pointed at
a scratch directory, bash 5.3.15), plain-text shape: stop 1 — one objection hand-back plus a plain
wrapper — wrote `verdict: findings, unresolved: 1`; stop 2 — the resumed turn re-issued the clean
contract as plain text, no second hand-back — overwrote the same `code-reviewer.json` with
`verdict: clean, unresolved: 0`. The control, where the resumed turn delivered that same clean
contract through a second hand-back, left the objection record untouched.

This is independent of the older failure where a resumed reviewer drops the two machine-parsed
blocks unless explicitly re-asked. Re-asking fixes that one and lands you in one of the two shapes
above.

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

- Resuming a reviewer for a **question** whose answer you will act on yourself ("which probe did
  you run?", "which line?") is fine — but say in the message that the answer must be prose and
  must not include `REVIEWED-SHA` or `REVIEWED-FILES`. A contract-shaped answer written as text
  is the second shape above.
- If the finding is **real**, fix it and push. The push invalidates every stamp on the old head
  anyway, and the confirmation pass at the new head is a fresh dispatch by construction.
- The writer-side gap that makes the second shape possible (contract-bearing text bypasses the
  one-hand-back check and replaces the same agent's earlier record) is unchanged code, surfaced at
  codify time rather than filed. Until it is closed, this rule is what stands between a resumed
  reviewer and a laundered record.

## Related Files

- `.claude/hooks/review-stamp-writer.sh` — the `! grep -q '^REVIEWED-SHA:'` branch that holds the
  hand-back fallback and its one-hand-back refusal
- `.claude/hooks/merge-review-guard.sh` — the reader that then reports "no record"
- `docs/AI_WORKFLOW.md` → Review Policy → Confirmation pass — the orchestrator-side rule, and the
  dispatch prompt's "deliver once" sentence

## See Also

- [an archive move git reads as delete plus add](../code-quality/an-archive-move-git-reads-as-delete-plus-add-mis-scopes-the-review-stamp-2026-09-17.md) — the other way a flawless review yields no usable record (the scope digest)
- [a path move leaves sibling citations stale](../code-quality/a-path-move-leaves-sibling-citations-stale-grep-the-old-path-2026-09-22.md) — the finding the re-adjudication round was about
