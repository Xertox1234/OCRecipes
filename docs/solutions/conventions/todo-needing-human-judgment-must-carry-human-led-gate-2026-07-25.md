---
title: A todo whose acceptance criteria need a human decision — or verification an executor cannot reach — must carry human_led, not just a priority
track: knowledge
category: conventions
tags: [todos, automation, workflow, human-led, gating, todo-executor, verification]
module: shared
applies_to: ["todos/*.md"]
symptoms: ["An autonomous run reports a todo 'done' against criteria nobody could have verified", "A decision record exists for a choice no human made", "A todo asks the executor to pick between options with materially different costs", "Acceptance criteria require a physical device, a cloud build, or real-world data"]
created: '2026-07-25'
---

# A todo whose acceptance criteria need a human decision — or verification an executor cannot reach — must carry human_led, not just a priority

## Rule

Before filing a todo, read its own acceptance criteria back and ask: **could an
autonomous executor actually satisfy every one of these?** If any criterion
requires a human judgment, or evidence that only exists on hardware or
infrastructure an executor cannot reach, the todo must carry
`human_led: true` plus a `blocked_reason` explaining what the human has to
supply.

`priority:` and `status:` do **not** gate anything. `scripts/todo-gate-check.sh`
reads `blocked_until` and `human_led` **directly, bypassing `status` entirely**.
A `priority: medium` / `status: backlog` todo is fully dispatchable by an
overnight `/todo` run no matter how obviously human-shaped its contents read.

## Smell patterns

Any of these in the acceptance criteria means the gate is probably required:

- A criterion phrased as a decision — "A decision is recorded on which option is
  taken, and why", "Choose between…", "Decide whether…"
- An **Implementation Notes** section offering options with materially different
  costs (wait on upstream / patch a dependency / replace a library). Options are
  a decision the author declined to make; an executor will make it anyway.
- Verification requiring a **physical device**, a **cloud build** (EAS), real
  photos/recordings, an external dashboard, or a third-party account
- Anything the local toolchain currently cannot do (e.g. our iOS build being
  blocked on fmt vs clang 21) — an executor cannot route around that
- "Verify X still works end-to-end" where X is a hardware or ML pipeline

## Why

The dangerous outcome is **not** a bad merge. `scripts/todo-automerge-guard.sh`
HOLDs anything touching off-allowlist paths (`ios/`, `scripts/`,
`package.json`), so a native-dependency todo would be surfaced for human review
regardless. The real cost is quieter and worse:

1. The executor **invents** an answer to the decision the todo asked for, and
2. writes it into the todo's own decision record as though it were considered, and
3. reports "done" against criteria that were never verifiable,

which converts an open question into a fabricated settled fact in the repo's
own history. A wasted cycle is recoverable; a decision record nobody made is
the kind of thing that gets cited months later.

`human_led: true` never expires — unlike `blocked_until`, it does not clear on
a date. The **only** legal override is a human, in an interactive session,
explicitly naming that specific todo after seeing the gate reason. A generic
automation directive (`/goal`, a batch run, "clear the backlog", Auto Mode's
"make the reasonable call") is never sufficient, and an agent must never edit
`status`/`blocked_until`/`human_led` to work around the gate.

## Examples

Filed without the gate, then corrected in review (PR #717):

```yaml
# ✗ Before — dispatchable overnight despite needing a human decision
priority: medium
status: backlog
```

```yaml
# ✓ After
priority: medium
status: backlog
human_led: true
blocked_reason: "Acceptance criterion #1 is a human judgment across three options with very different costs (wait upstream / patch a podspec across an MLKit major / replace the OCR library). Verification also needs a physical device, an EAS Build, and real label photos — none reachable by an autonomous executor."
```

**Verify the gate actually fires** rather than trusting the frontmatter — a
typo'd key is silently ignored:

```bash
bash scripts/todo-gate-check.sh todos/<file>.md; echo "exit=$?"
# gate-check: GATED todos/<file>.md — human_led: true (<reason>)
# exit=1        ← non-zero means correctly gated
```

The `blocked_reason` is surfaced **verbatim** in `/todo` and `/todo-fast` run
summaries, so write it for the human who will read it there — name what they
have to supply, not just that they're needed.

## Exceptions

- **Date-gated, not judgment-gated** → use `blocked_until` alone (e.g. a
  telemetry window that has to elapse). It clears on the date.
- Both may be set together; `human_led` is the one that never auto-clears.
- A todo needing a device only for **optional** confirmation, where the
  acceptance criteria are otherwise mechanically checkable, does not need the
  gate — but be honest about which criteria are load-bearing.

## Related Files

- `todos/README.md` — "Date & Human-Led Gates", the canonical field semantics
- `todos/TEMPLATE.md` — carries both fields commented out
- `scripts/todo-gate-check.sh` — the deterministic enforcement; exit-code contract in its header
- `scripts/todo-automerge-guard.sh` — the separate safe-path allowlist that HOLDs sensitive PRs
- `todos/P2-2026-07-25-mlkit-9-unblock-visioncamera-511.md` — the todo this rule came from

## See Also

- [A dispatched subagent must run its own verification synchronously](subagent-verification-must-run-synchronously-2026-07-06.md) — the sibling failure where automation reports completion it cannot back
- [A dependency version held only by the lockfile is not pinned](lockfile-only-version-hold-is-not-a-pin-2026-07-25.md) — the other finding from the same review
