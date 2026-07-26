---
title: A defect spec's acceptance criteria must be derived from the source, not from the reproduction the author happened to hit
track: knowledge
category: conventions
tags: [todos, spec-review, acceptance-criteria, code-review, scope, root-cause]
module: shared
applies_to: ["todos/**/*.md", "docs/superpowers/specs/**/*.md"]
symptoms: ["A todo's ACs each name a specific mechanism drawn from one observed reproduction", "The spec's title states a cause ('when X is a shell variable') narrower than the code path it cites", "An AC pins existing behavior as 'unchanged' for cases the author never tested", "Completing every checkbox would still leave the reported class of failure reachable"]
created: '2026-07-26'
---

# A defect spec's acceptance criteria must be derived from the source, not from the reproduction the author happened to hit

## Rule

When writing or reviewing a todo/spec for a defect, **read the code path it
cites and confirm the stated cause is the root cause — not one instance of a
broader one.** The author's reproduction is a sample of size one. A spec scoped
to that sample produces acceptance criteria that are individually satisfiable
while the defect stays live.

Reviewing a spec for internal coherence is not enough. A spec can have
well-formed ACs, exact file paths, a Scope Contract, and a Risks section — and
still be wrong in a way only visible by opening the file it points at.

## Smell patterns

- The title or Summary names a **mechanism** ("when the branch name is a shell
  variable") rather than the **code behavior** ("the capture group never strips
  quotes"). Mechanisms are how the bug reached the author; behavior is what is
  broken.
- An AC pins current behavior as correct for untested inputs — "the existing
  paths are **unchanged** for literal names" — when the author only ever ran the
  one failing input.
- The proposed fix is a **detector for the observed trigger** rather than a
  correction at the point the value is produced or normalized.
- The existing test suite exercises only the form that happens to work, so
  nothing would have caught the broader case (a strong tell the spec inherited
  the same blind spot).

## Why

Two failure modes compound, and the second is the expensive one.

**The fix misses.** ACs written from a narrow model can all pass while the
defect remains reachable by a different input. The work looks done, closes, and
the bug is rediscovered later as "we already fixed that."

**The test cements the bug.** An AC that says existing behavior is "unchanged"
becomes a test asserting the *unfixed* case behaves as it currently does. The
codebase now has a green test pinning broken behavior as correct — so the real
fix later reads as a regression, and whoever attempts it has to argue against a
passing test. This is the same hazard as a one-sided gate test
(see `gate-test-needs-two-sided-negative-control-2026-07-25.md`): a green suite
that proves nothing about the case that matters.

Deriving from the source costs one file read. Skipping it costs a wrong fix plus
a test defending it.

## Examples

**The incident (PR #721).** The branch-delete advisor in
`.claude/hooks/git-safety.sh` emitted "NO PR found — deleting it may lose
never-pushed work" for a branch whose PR was merged. It surfaced during a
`/todo` cleanup running `git branch -D "$B"`, so the spec was titled *"…when the
branch name is a shell variable"* and its ACs specified a `$`/backtick detector.

Reading the cited line told a different story — the capture group
(`([^[:space:];&|]+)`, line 548) simply never strips quotes:

```
git branch -D "todo/foo"   ->  REF: ["todo/foo"]   # false "NO PR found", no variable involved
git branch -D todo/foo     ->  REF: [todo/foo]     # only the unquoted form ever worked
git branch -D "$B"         ->  REF: ["$B"]
```

Completing all four original ACs would have shipped the `$`-detector, left every
quoted **literal** broken, and added a test asserting that stayed broken. The
correct fix was one line at the normalization point — strip surrounding quotes —
which repairs the literal case outright *and* reduces `"$B"` to `$B` so the
`$`-check operates on a bare token.

**The legitimate contrast (PR #720, same session).** The `setCameraZoom` todo
deliberately excluded a throttling abstraction and said so in its Scope Contract,
documenting the residual instead. That is a *stated, reasoned* narrowing — not
this defect. The distinguishing question:

> Is the spec narrow because someone **decided** it should be, or because that
> is **how the bug happened to surface**?

The first is engineering judgment. The second is an accident that ACs then
harden into a contract.

## Exceptions

- **Deliberate, stated narrowing** — a Scope Contract that names what is excluded
  and why (cost, risk, a separate filed follow-up) is a decision, not
  under-scoping. Judge whether the narrowing is *reasoned* or *inherited*.
- **Spec review is not implementation review.** The check here is "do these ACs
  describe the real defect," not "is the proposed fix optimal." Rewriting an
  adequate approach because a nicer one exists is scope creep in the reviewer.
- **Genuinely unreachable source** — a spec against a third-party service or
  unreleased API cannot be validated this way. Say so in the spec rather than
  implying a source check happened.

## Related Files

- `.claude/hooks/git-safety.sh` — the advisor block (lines 548, 566-572) this rule
  was derived from
- `todos/P3-2026-07-25-git-safety-delete-advisor-quoted-ref.md` — the rescoped
  spec, retitled from the mechanism to the behavior
- `.claude/agents/code-reviewer.md` — the corresponding review checklist item

## See Also

- [todo needing human judgment must carry human_led gate](todo-needing-human-judgment-must-carry-human-led-gate-2026-07-25.md) — the sibling authoring check: ACs an executor cannot reach need a gate, not just a priority
- [gate test needs two-sided negative control](gate-test-needs-two-sided-negative-control-2026-07-25.md) — the same "green test proves nothing" hazard, one layer down in the test itself
- [js-rendered feedback is not evidence a native call succeeded](js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md) — the same session's *legitimate* narrowing, documented as an accepted residual
