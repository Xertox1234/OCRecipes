---
title: "DECISION: should guard-outward-cli.sh deny by default when an unquoted expansion sits in command position?"
status: backlog
priority: critical
created: 2026-09-02
updated: 2026-09-03
assignee:
labels: [security, harness, decision]
github_issue:
---

# DECISION: deny-by-default for expansions in command position?

**RULED 2026-09-03 — option (c), NARROW DENY.** The `human_led` gate is lifted and this todo is implementable. Full ruling, including what it does NOT settle, at the bottom of this file.

## Summary

`.claude/hooks/guard-outward-cli.sh` can be bypassed by constructing the gated verb — or a
gated flag — so that it never appears as literal text anywhere in the command string. The
guard is a static-text matcher; the shell produces the real token at expansion time. No
boundary-class widening can close this, because there is no boundary to widen: the string
`merge` simply is not present.

Closing it requires a **scope decision only a human should make**, because both arms have a
real cost.

## Background

Confirmed live on 2026-09-02 by `security-auditor` during the PR #910 review wave, using
this repo's construct-and-run standard: every ALLOW below is the hook's actual exit code,
and every "real invocation" claim was ground-truthed via a PATH-stubbed binary printing its
own argv. No real outward-facing CLI was executed.

**All five gated verb families are bypassable**, on `main` and on every branch in flight, via
each of these mechanisms:

- `${var:-verb}` — default-value expansion
- `${var-verb}` — no-colon form
- `${!indirect}` — indirect expansion
- `$(printf verb)` — command substitution
- `` `printf verb` `` — backtick substitution

**It also fails open on the degraded path.** `crude_smells_outward()`'s `[^a-zA-Z]+`
separator class is broken by the letters inside the expansion, so the no-`jq` fallback —
which exists precisely to fail closed — does not catch it either. This is not a
precise-path-only gap: it fails open on every layer of the guard.

Note this is a _different_ mechanism from the existing tested case `echo $(eas update)`,
which keeps the verb as literal text inside the substitution. Here the verb text never
appears in the source at all, which is why existing coverage does not reach it.

### Why this is not fixable the usual way

Every other guard gap found in this wave (see
`todos/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md`) was a boundary
character class that needed widening, or a redirect that needed absorbing — mechanical, and
mutation-testable. This one is structural. The two available mechanisms are:

1. **Evaluate the expansion.** Ruled out: this repo's own doctrine forbids executing
   outward-CLI fragments, including for inspection, and doing so would itself be the
   vulnerability.
2. **Deny by default** whenever an unquoted `${...}` / `$(...)` / backtick construct appears
   in command position ahead of a gated verb — i.e. treat "I cannot see what this resolves
   to" as "I must not allow it."

## The decision

**Option (a) — deny by default in command position.**
Fails closed, which is the correct default for a security gate and matches the guard's
existing behaviour when `jq` is missing or the lib is unsourceable.
_Cost:_ false positives on legitimate commands. Any developer or script writing something
like a variable-driven CLI path, a `$(...)`-computed argument ahead of a gated verb, or a
wrapper that composes a command from parts would be denied and need `ALLOW_OUTWARD_CLI=1`.
The size of that population is **unmeasured** — measuring it is part of the work, not an
assumption to make now.

**Option (b) — accept and document as a residual.**
Zero false positives; the gap is recorded in `DOCUMENTED RESIDUALS` alongside the others and
the guard continues to defend against the literal-text cases that make up ordinary agent
behaviour.
_Cost:_ a confirmed, trivially-constructed bypass stays open in the gate whose failure
already caused one real incident here. An agent that ever emits an expansion-composed
outward command — deliberately or not — is not stopped.

**Option (c) — narrow deny.** Deny only when an expansion sits in command position _and_ the
surrounding command shape already smells outward-facing (e.g. a gated binary name is present
but the verb is not literal). Smaller false-positive surface than (a); more complexity, and
the narrowing itself needs the same construct-and-run scrutiny.

## Acceptance Criteria

- [ ] A human rules between (a), (b), and (c), and the ruling is recorded here with its
      rationale — in the deciding human's own words, not an agent's paraphrase.
- [ ] If (a) or (c): before implementing, **measure the false-positive population by
      execution** against real historical commands rather than estimating it. A "decline to
      act" branch is only safe for inputs the OLD code did not act on — run the old code to
      learn that set. One unverified sentence of this shape previously cost this repo 144
      real denies.
- [ ] If (b): the residual is written into the guard's `DOCUMENTED RESIDUALS` section with
      the exact constructions above, and this todo closes as documented-and-accepted.
- [ ] Whichever arm: the no-`jq` degraded path (`crude_smells_outward()`) is fixed or
      explicitly documented as sharing the gap — it currently fails open, which is a defect
      against its own stated fail-closed purpose regardless of which option is chosen.
- [ ] Zero follow-ups.

## Implementation Notes

- **Do not let an agent settle this autonomously.** `human_led: true` is set deliberately.
  The 2026-07-16 incident was an autonomous chain treating a broad automation directive as
  authorization to override a gate; a security-guard scope decision invented by an unattended
  run and written up as a settled decision record is the same failure with a worse blast
  radius.
- The `crude_smells_outward()` fail-open is arguably separable and cheaper than the main
  decision — it is a defect against that function's own contract, not a scope question. If
  the main decision stalls, that piece can be lifted out and fixed on its own.
- Relevant prior art in this repo, same shape (a mechanism question where every
  off-the-shelf option was ruled out and the human had to rule):
  `todos/archive/P1-2026-08-17-quoted-command-substitution-inert.md`.

## Scope Contract

- **Mechanisms to use:** a human ruling, then either a documented residual (option b) or a
  deny-by-default / narrow-deny rule inside the existing guard (options a/c). Never
  expansion evaluation.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, and this todo file.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. Independent of
  `todos/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md`, though both
  touch the same two files, so coordinate merge order if they run close together.

## Risks

- **Choosing (a) without measuring the false-positive population** would trade a security gap
  for a workflow blocker, and this repo has already paid for exactly that mistake once.
- **Choosing (b) silently** — i.e. letting it lapse rather than deciding — leaves a confirmed
  live bypass in the gate that already permitted one real incident. Option (b) is a legitimate
  ruling; drifting into it by inaction is not.

## Updates

### 2026-09-02

- Filed at the user's request after the PR #910 review wave. Finding C3 from
  `security-auditor`, rated CRITICAL: constructed and executed against the real hook, all
  five verb families, five expansion mechanisms, plus a confirmed fail-open on the no-`jq`
  degraded path.
- Reproduction fixtures lived in a session scratchpad and are NOT durable — regenerate from
  the mechanism list above.

## RULING (2026-09-03) — option (c), NARROW DENY

The repository owner ruled in favour of **option (c), narrow deny**, selected from the three
priced options above. The `human_led: true` gate and its `blocked_reason` are lifted; this
todo is now implementable.

**Recording the rationale honestly:** the ruling was made by selecting option (c) as
presented, not by writing separate prose. The rationale is therefore option (c)'s own text
as it stood above — deny only when an expansion sits in command position **and** the
surrounding command shape already smells outward-facing (a gated binary name is present but
the verb is not literal) — chosen over blanket deny-by-default and over accepting the gap.
This note exists so a later reader does not mistake an agent's paraphrase for the owner's
words. If more detail is wanted on the reasoning, ask the owner rather than inferring it
from here.

### What the ruling settles, and what it does not

Settled: the guard will NOT accept this as a residual, and it will NOT deny on every
expansion in command position.

**Explicitly NOT settled by the ruling — these are engineering work, and the todo's
Acceptance Criteria still bind in full:**

- Where exactly the "already smells outward-facing" line is drawn. The narrowing predicate
  is the deliverable and needs the same construct-and-run scrutiny as a blanket change would
  — this option's own cost note says so.
- **The false-positive population must still be measured by EXECUTION, not estimated.** A
  narrower rule has a smaller false-positive surface, not a zero one. This repo has already
  lost 144 real denies to one unverified claim of exactly this shape.
- The **no-`jq` degraded path** must be closed too. `crude_smells_outward()` was verified to
  fail OPEN for this mechanism, against its own fail-closed contract. A narrow deny that
  exists only on the precise path leaves the degraded path exactly as open as option (b)
  would have.

### Sequencing note

This work and the vanishing-sigil todo
(`todos/P0-2026-09-02-outward-cli-guard-vanishing-sigil-boundary-decision.md`, also ruled
2026-09-03) both touch `_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX` and both were ruled to CHANGE the
anchors. They must not be implemented as two independent unattended runs against the same
regex pair — the second would be reviewing a file the first has already moved. Land one,
re-run the full hook suite, then start the other; or scope them into one change with a
single corpus covering both mechanisms.
