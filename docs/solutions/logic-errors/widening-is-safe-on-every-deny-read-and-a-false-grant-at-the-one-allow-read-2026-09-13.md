---
title: "Widening a shared matcher is the safe direction on every DENY-shaped read and a false GRANT at the one read that allows — the two cannot share a constant"
track: bug
category: logic-errors
tags: [harness, hooks, safety-gate, bash, security, testing]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh"]
symptoms: ["A guard that was widened to close a bypass starts ALLOWING a command its previous version denied", "One constant feeds both deny-shaped and grant-shaped reads of the same text", "A clause capture crosses a command separator and picks up a flag from a neighbouring command", "The reasoning 'widening only ever adds a deny, so it is safe' was applied without checking whether every consumer denies"]
created: 2026-09-13
severity: critical
---

# Widening is safe on every deny-shaped read and a false grant at the one read that allows

## Problem

A text matcher that feeds several checks is widened to close a bypass. The change is
justified with a sentence that is true of almost every consumer:

> Widening a matcher can only ADD matches, which is the safe direction for every DENY
> consumer here.

It is true — for the deny-shaped consumers. If **one** consumer uses the same capture to
decide an **ALLOW**, the identical widening is a false grant there, and it lands in the same
commit as the fix, wearing the fix's justification.

Measured on `guard-outward-cli.sh`, 2026-09-13. `_OUT_GH_GLOBALS` was added to model the
flag slot between `gh` and its namespace, closing a live merge bypass. Its generic arm is
`-[^[:space:]]+`, which does not exclude `;`, `&` or `|`. Six needles consumed it and all six
deny. The seventh consumer is the clause cut feeding the `--auto` carve-out — the one read
in the file whose downstream check *grants*:

```
gh --auto -x;gh pr merge 42
  CLAUSE  [gh --auto -x;gh pr merge 42]
  fields  <gh> <--auto> <-x;gh> <pr> <merge> <42>
```

The globals run swallowed `-x;gh`, so the clause began inside the **previous** command and
that command's standalone `--auto` satisfied the carve-out for a merge that never carried
one. Against the pre-change guard: `ALLOW` after, `DENY` before, on all four separators. The
spaced sibling `gh --auto -x ; gh pr merge 42` denied in both, which is what identifies the
glue as the vector rather than the token.

## Symptoms

- A guard's own test suite is green and the corpus pin is exact, because every row was
  written for the bypass being closed and none for the grant.
- A differential run against the previous revision shows rows moving `DENY → ALLOW` in a
  change whose entire purpose was `ALLOW → DENY`.
- The file already contains a comment explaining this exact asymmetry, written when the
  same false grant was closed on a different side.

## Root Cause

**Direction of the consumer, not width of the matcher, decides whether widening is safe.**
Over-capture adds text to a span. For a check shaped *"deny if this span contains X"*, extra
text can only add denies. For a check shaped *"allow if this span contains X"*, extra text
can only add **grants** — and text pulled across a command separator belongs to a command the
user never intended the check to read.

Two things made it easy to miss:

1. **The justification was inherited.** "Widening only adds a deny" was quoted from the
   sibling constant's header, where it was true, and carried to a constant with a different
   consumer set.
2. **The obvious probe masked it.** Checking whether a *flag value* could spoof the grant
   (`gh -R foo--admin/bar pr merge 42 --auto`) returns "denied" — but by the repo-retarget
   check that runs first, not by the carve-out. The real vector is a dash token that is not a
   repo flag at all.

## Solution

**Split the constant by consumer direction. Do not narrow the deny form to fix the grant.**

```bash
# deny-shaped reads keep the wide form — over-capture only ever adds a deny
_OUT_GH_GLOBALS="$_CMD_GH_GLOBALS"

# the ONE grant-shaped read gets a separator-safe sibling
_OUT_GH_GLOBALS_GRANT='(([[:space:]]+(-R[[:space:]]+[^[:space:];&|]+|--repo[[:space:]]+[^[:space:];&|]+|-[^[:space:];&|]+))|([[:space:]]*'"$_CMD_REDIR"'))*'
```

Narrowing is the safe direction **at the grant and only there**: no clause means the carve-out
flag is absent, which denies. Narrowing the deny-shaped needles instead would re-open the
original bypass (`gh -R=a;b pr merge 42` stops matching and goes back to a silent allow), so
the split has to be per-consumer rather than a single compromise width.

### Narrowing the flag arms was not enough — check every arm the separator can enter

The fix above closed the crossing through the **flag** arms and was reviewed, measured and
shipped. It was still incomplete, and the second round found why: the clause can also begin
in a previous command through the **redirect** arm, which interpolated a shared constant
whose target class admits `(`. A process substitution then reads as *a redirect to a file
named `(gh`*:

    gh --auto >(gh pr merge 42)   ->   CLAUSE [gh --auto >(gh pr merge 42]

Same donation, different arm. The lesson is not "also exclude `(`" — it is that **a
separator can enter the span through any alternative of the grammar**, so narrowing one
alternative and declaring the family closed repeats the original error one level down. The
second fix masked the grant clause on a character class (`[$(\`]`) rather than narrowing the
shared redirect constant, because that constant feeds every other consumer of the library.

Verify executability rather than assuming a shape is theoretical: a stub named so it cannot
collide with the real binary, an **inert outer command** so only the inner call can mark, and
controls for a quoted and a backslash-escaped spelling. The first version of that probe used
the same stub for outer and inner, so its control passed for the wrong reason and it measured
"did anything run".

Pin both directions, and pin the split itself:

- MUST-DENY rows for the glued vector on **every** separator, plus the spaced sibling as the
  control that names glue as the mechanism.
- MUST-ALLOW rows for every sanctioned shape, because narrowing a grant is what breaks real
  usage.
- A mutation row that widens the grant form back to the deny form's class and requires the
  guard to fail closed — otherwise the split can be silently undone.

## Prevention

- Before widening a shared matcher, **enumerate its consumers and label each deny-shaped or
  grant-shaped.** The safety argument is per-consumer; a single sentence cannot cover a
  mixed set.
- Then enumerate the matcher's own **alternatives**, not just its consumers. A separator that
  can cross the span through a flag arm can usually cross through a redirect arm too, and
  closing one reads as closing the family.
- **A residual's direction is a property of the consumer, not of the pattern.** The same
  earlier-anchoring residual that fails CLOSED at a deny-shaped consumer is a false ALLOW at
  a grant-shaped one; a residual list copied between them silently inverts.
- Run a **differential corpus against the previous revision** and read the `DENY → ALLOW`
  column, not only `ALLOW → DENY`. A change that closes a bypass is expected to move rows one
  way; any row moving the other way is a regression until attributed.
- When a file already documents an asymmetry, treat that comment as a checklist item for any
  change to the constants it names — here the block above the clause cut already said it was
  "the ONE clause-cut whose downstream check decides an ALLOW on flag presence".

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — `_OUT_GH_GLOBALS` / `_OUT_GH_GLOBALS_GRANT` and the clause cut
- `.claude/hooks/lib/cmd-detect.sh` — `_CMD_GH_GLOBALS`, the shared source of the wide form
- `.claude/hooks/test-guard-outward-cli.sh` — the glued/spaced rows and the grant-widening mutation row

## See Also

- [widening a permissive text gate reopens the restrictive failure](widening-a-permissive-text-gate-reopens-the-restrictive-failure-2026-09-12.md) — the same matcher's other axis
- [a guard and its mutation test can both be inert while green](../code-quality/a-guard-and-its-mutation-test-can-both-be-inert-while-green-2026-09-13.md) — the fail-closed assertion added alongside this same fix
- [union over renderings does not cover selection within one](union-over-renderings-does-not-cover-selection-within-one-2026-09-07.md)
- [a special case that only prevents a false positive](../code-quality/a-special-case-that-only-prevents-a-false-positive-2026-09-07.md)
