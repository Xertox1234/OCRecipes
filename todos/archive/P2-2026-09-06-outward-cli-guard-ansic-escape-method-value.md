---
title: "guard-outward-cli.sh: an ANSI-C escape-encoded gh api method value is silently ALLOWED"
status: done
priority: medium
created: 2026-09-06
updated: 2026-09-06
assignee:
labels: [security, harness]
github_issue:
---

# An ANSI-C escape-encoded `gh api` method value evades both C2 branches

## Summary

A mutating HTTP method supplied to `gh api` as an ANSI-C escape sequence rather than literal
text (`-X $'\x50\x4f\x53\x54'`, which bash expands to `POST`) is silently **ALLOWED** on the
precise path. It slips between the two branches of the `gh api` method check: the literal
branch finds no `POST`, and the "method value is not literal text" branch finds no surviving
`$` or backtick to key on.

## Background

Disclosed as a residual on 2026-09-05 (commit `3131de37`) during the C2 work, and given an
executable counterpart on 2026-09-06 (PR #926) as the corpus row `c2-ansic-hex`, whose
expectation is deliberately left at `DENY` so it keeps reporting as a gap. This todo is the
tracked follow-up; the corpus row is its regression fixture.

### Measured cause

Not inferred from reading the regex — measured by running the command text through the
rendering functions directly:

```
raw                : gh api repos/o/r -X $'\x50\x4f\x53\x54'
cmd_words          : gh api repos/o/r -X xx50xx4fxx53xx54
cmd_words_vanished : gh api repos/o/r -X xx50xx4fxx53xx54
```

The shared word-splitting in `.claude/hooks/lib/cmd-detect.sh` renders each `\xNN` escape as
an alphanumeric placeholder and **consumes the `$`**. So by the time either branch of the
check runs, the clause contains neither the literal method text nor a sigil:

- the mutating-method branch looks for literal `POST`/`PUT`/`PATCH`/`DELETE` — absent;
- the C2 "unreadable method" branch looks for a `$` or backtick anywhere in the clause once a
  method flag is present — also absent, because the placeholder ate it.

Octal (`\NNN`) and unicode (`\uHHHH` / `\UHHHHHHHH`) ANSI-C escapes are the same mechanism.
They were **not** individually re-verified, and that should be treated as unmeasured rather
than assumed equivalent.

**The degraded paths deny this**, which inverts the usual relationship — so this row must not
be read from a summary gap count alone. `precise=ALLOW, nojq/nolib/noawk=DENY`.

### Severity

`medium`. It is a confirmed live ALLOW on a mutating-API check, which argues for higher — but
against that: it requires deliberately hex-encoding a method (not a shape anyone writes by
accident or convenience), all three degraded paths already catch it, and it has been an
explicitly documented residual since 2026-09-05 rather than an unknown. Promote it if the
threat model shifts from "stop an agent doing this accidentally" toward "stop a determined
bypass" — the guard's own header currently states the former.

## Acceptance Criteria

- [ ] Reproduced first against unmodified `main` (or the then-current tip): construct the
      input, run the hook, record its actual exit code.
- [ ] The gap is closed for hex escapes **and** the octal and unicode spellings, each
      verified individually by execution rather than assumed to follow from the hex case.
- [ ] Two-sided regression tests in `test-guard-outward-cli.sh`, with the **deny reason
      asserted** — this family already has several branches that can deny for unrelated
      reasons, so a bare deny assertion would pin nothing.
- [ ] Mutation-tested: revert/stub the fix, confirm the named assertions FAIL, restore.
- [ ] The corpus row `c2-ansic-hex` in `.claude/hooks/repro-outward-cli-corpus.sh` flips from
      GAP to `ok`, and rows are added for the octal and unicode spellings.
- [ ] **False-positive check by execution.** A read-only `gh api` call must stay allowed, and
      so must ordinary ANSI-C quoting elsewhere in a command. This is the branch to watch:
      the existing C2 predicate already carries a documented ACCEPTED OVER-DENIAL (a literal
      `-X GET` with an unrelated `$` anywhere in the clause denies), and a careless widening
      here compounds it.
- [ ] The `DOCUMENTED RESIDUALS` entry in `guard-outward-cli.sh` (search `ANSI-C`) and the
      `NOTE6` block in the corpus are updated from open to closed — append/amend, never
      silently delete.

## Implementation Notes

- **Two candidate approaches, and the cheap one is probably wrong.**
  1. _Decode the escapes_ in the rendering so the real method text appears. Correct but
     invasive: it changes `.claude/hooks/lib/cmd-detect.sh`'s shared word-splitting, which
     every other hook consumes. It needs its own design and false-positive review, which is
     exactly why the folded repair excluded it.
  2. _Treat the placeholder as a third "unreadable" signal_ — i.e. deny when a method flag's
     value is present but is not one of the known literal methods. This is guard-local and
     much smaller, but it inverts the predicate from "deny on a detected sigil" to "deny
     unless recognised", which is a materially wider deny surface across every `gh api` call
     in the repo. It needs its own harvested false-positive sweep, not a same-commit patch.
- Whichever is chosen, note that the C2 branch is already mutation-tested and shipped; the
  change must not silently relax what it currently catches. Re-run the existing C2 assertions
  and confirm they still fail under their own mutation, not just that they pass.
- Never execute a real outward-facing CLI. Use argv-printing stubs on `PATH`.
- Writing about these constructions trips the guard's own heredoc-prose false positive; use
  file tools, not shell command strings.

## Scope Contract

- **Mechanisms to use:** exactly one of the two approaches above, chosen and stated before
  implementation. No new dependency.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`, and
  `.claude/hooks/lib/cmd-detect.sh` **only** if approach 1 is chosen — in which case every
  other consumer of the changed function must be enumerated and re-tested.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- **Land PR #926 first**, then rebase — it introduces the `c2-ansic-hex` fixture row and the
  C2 branch this todo modifies.
- Independent of
  `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md`, though
  both touch the same two files and should not run as concurrent unattended jobs.

## Risks

- Approach 2's inverted predicate is the risk: "deny unless recognised" over-denies by
  construction, and `gh api` is used routinely in this repo's own tooling. The false-positive
  sweep is the deliverable, not a formality.
- Approach 1 changes a shared lib function that several hooks depend on; a rendering change
  there can silently alter unrelated guards' behaviour. Enumerate consumers first.

## Updates

### 2026-09-06

- Filed at the user's request. Pre-existing residual (disclosed 2026-09-05, commit
  `3131de37`); PR #926 added its executable counterpart and re-confirmed it still open by
  measurement rather than carrying the earlier claim forward.
