---
title: "lib/cmd-detect.sh: a `case` arm's unmatched `)` closes the enclosing $(...) early, and no paren counter can reach it"
status: backlog
priority: medium
created: 2026-09-06
updated: 2026-09-06
assignee:
labels: [deferred, security, harness, cmd-detect]
github_issue:
---

# A `case` arm's `)` closes the enclosing `$(...)` early

## RECLASSIFIED 2026-09-07 — model B, documented residual (was P0)

The owner ruled that `guard-outward-cli.sh` is accountable for **Model A only**: an agent
MISFIRING, not defeating a deliberate evader. See
`todos/archive/P1-2026-09-07-outward-cli-guard-threat-model-decision.md`.

This mechanism is **model B** — it requires deliberate construction, and no accident produces
it. Under the ruling that makes it a documented residual rather than a critical defect:

- **It stays measured.** Its corpus rows keep their DENY expectations and report as gaps on
  every run, so the gap is never invisible.
- **It is not in the critical queue.** A text-matching guard cannot enumerate shell grammar,
  and the guard's own header concedes it ("guardrail, not a sandbox — a determined bypass is
  always possible").
- **The structural answer is filed separately**:
  `todos/P1-2026-09-07-outward-cli-path-wrapper.md` attacks PATH resolution rather than command
  text, so it covers this mechanism and every unfound sibling without reading the command at all.

Everything below is the original filing and its measurements, which remain accurate. Nothing
here is retracted — only its priority changed.

## Summary

`e$(case x in a) : ;; esac)as update --branch preview` is **ALLOWED on all four execution
paths** and is a real OTA publish to end users. The `)` that terminates the `case` arm pattern
`a)` has **no matching opener**, so `lib/cmd-detect.sh`'s substitution scanners read it as the
closer of the enclosing `$(...)`, the verb never re-forms, and the guard sees nothing.

Split out of `todos/archive/P0-2026-09-06-cmd-detect-bare-paren-subshell-breaks-substitution-scanners.md`
by an explicit scope decision, not by oversight — see Background.

## Background

The bare-paren sibling of this defect (`e$( (:) )as update`) was closed by giving both
scanner-shaped functions — `cmd_extract_substitutions` and `cmd_words_vanished` — a per-level
paren counter, so the `)` of an inner subshell decrements a depth instead of closing the outer
construct.

**That counter cannot reach a `case` arm, and the reason is structural rather than an
incomplete implementation.** `case x in a)` has one `)` and zero `(`, so there is no depth for
the counter to hold: any arithmetic that treats the arm's `)` as a closer is indistinguishable
from the construct's real closer.

### The obvious fix is a deny→ALLOW regression generator, measured

Tracking the `case` … `esac` keywords was considered and deliberately rejected. A naive
tracker sets "inside a case" on the literal word `case` and refuses to close until `esac`:

```
e$(echo case)as update --branch preview
```

DENIES today (the `$(...)` is deleted and `eas` re-forms). Under a naive tracker the word
`case` opens a construct that never closes, `depth` never returns to 0, `cmd_words_vanished`
hits its `if (depth >= 1) exit` guard and emits NOTHING — so the rendering silently stops
contributing and that coverage is lost. A guard that loses a real deny to close a rarer one is
a net regression.

Any accepted fix therefore needs the `case` keyword recognised at a genuine **command
position** (and `esac` likewise), which is a grammar addition, not a depth fix. This file's own
history says that position is unforgiving: three successive attempts to out-clever a
span-boundary question each shipped a live OTA-publish bypass (see `guard-outward-cli.sh`'s
STAGE 3 block, which records the sequence).

## Measured, this tree, after the bare-paren fix landed

Fed to the hook as JSON; no outward CLI was executed.

| construction                                           | precise | nojq  | nolib | noawk |
| ------------------------------------------------------ | ------- | ----- | ----- | ----- |
| `e$(case x in a) : ;; esac)as update --branch preview` | ALLOW   | ALLOW | ALLOW | ALLOW |

Control, isolating the case arm as the only variable — the bare-paren spelling of the same
shape now DENIES on the precise path:

```
e$( (:) )as update --branch preview   ->  DENY  (command-position 'eas update/publish/submit')
```

## Corpus rows already exist

`repro-outward-cli-corpus.sh` carries **17** rows for this mechanism, all EXPECTED-DENY and all
currently reporting as gaps: `toolvcasearm-*` (7), `verbvcasearm-*` (7) and `flagvcasearm-*`
(3 of 4). They are part of the documented `precise-path gaps=33`.

**`flagvcasearm-ghadmin` is the fourth flag-position row and reports `ok` — do not read that as
this mechanism being handled there.** It denies from a DIFFERENT check: its base command is
`gh pr merge 42 --auto --admin`, the construct breaks the `--auto` spelling, and the
"`gh pr merge` without a REAL `--auto`" rule fires instead. Attribution, not verdict — the same
rule NOTE6 states for `co-mask-c1`.

## Acceptance Criteria

- [ ] Reproduce the table above on the current tree before changing anything, and confirm the
      bare-paren control still DENIES. If it does not reproduce, report it rather than fixing
      past it.
- [ ] `cmd_words_vanished 'e$(case x in a) : ;; esac)as update'` renders `eas update`, and
      `cmd_extract_substitutions` on the same input yields the whole `case` body.
- [ ] **The deny→ALLOW regression named above is pinned as a two-sided test before the fix is
      written**: `e$(echo case)as update --branch preview` must still DENY, and reverting the
      new grammar must make a NAMED assertion fail. `case` appearing as an ARGUMENT, in a
      quoted span, or as part of a longer word (`casexyz`, `lowercase`) must not open anything.
- [ ] Bash's optional leading-paren arm form (`case x in (a) : ;; esac`) is handled — it is
      balanced, so it must not double-count against the paren counter already in place.
- [ ] The fix is applied to **every** function sharing the scanner shape in ONE change, not
      just the one named in the reproduction — `cmd_extract_substitutions` and
      `cmd_words_vanished` both desynchronise today.
- [ ] The existing differential pins in `test-cmd-detect.sh` stay green, and the bare-paren
      exact-value pins added by the sibling todo stay green.
- [ ] All four execution paths re-checked, each deny **attributed by its REASON string**.
- [ ] The 17 `*vcasearm-*` corpus rows flip to `ok`, and NOTE6's gap attribution is recomputed
      **by ID** in the same change — never by subtracting totals.
- [ ] False-positive population measured by EXECUTION over harvested command history, not
      estimated; validate the harness on a known flip before trusting a zero.

## Implementation Notes

- **Never execute an outward-facing CLI**, including `--help`/`--version`. Feed constructions
  to the hook as JSON:
  `jq -cn --arg cmd '<construction>' '{tool_name:"Bash",tool_input:{command:$cmd}}' | bash .claude/hooks/guard-outward-cli.sh`
- Writing about these constructions trips the guard's own heredoc-prose false positive. Use
  file tools (`Write`/`Edit`); never route the content through a shell command string.
- The scanner is BSD `awk` under bash 3.2 — no `strtonum`, no `gensub`.
- **`cmd_words_vanished`'s awk program lives inside a bash single-quoted string.** A literal
  apostrophe anywhere in its comments closes that string and makes the whole lib unsourceable
  (the guard then fails closed with "broken install"). `bash -n .claude/hooks/lib/cmd-detect.sh`
  after every edit is the cheap gate; this cost a round during the sibling todo.
- Deletion is the dangerous direction: `cmd_words_vanished` is SUBTRACTIVE, so a wider deletion
  DISARMS presence checks — see
  `docs/solutions/logic-errors/deletion-pass-must-prove-construct-can-be-empty-2026-09-02.md`.

## Scope Contract

- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/test-cmd-detect.sh`,
  `.claude/hooks/repro-outward-cli-corpus.sh`, `.claude/hooks/test-guard-outward-cli.sh`,
  `.claude/hooks/guard-outward-cli.sh` (its DOCUMENTED RESIDUALS entry only), and this todo.
- **Mechanism:** command-position-anchored `case`/`esac` recognition in the shared scanner. Do
  NOT add a second hand-rolled scanner, and do NOT compensate inside `guard-outward-cli.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Related

- `todos/archive/P0-2026-09-06-cmd-detect-bare-paren-subshell-breaks-substitution-scanners.md`
  — the sibling that closed the bare-paren half and added the paren counter this builds on.
- `todos/P0-2026-09-06-outward-cli-guard-brace-range-splits-token-with-no-sigil.md` and
  `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` — the other
  two open criticals in the same guard. All three edit NOTE6, so **whichever lands last
  re-runs the corpus and re-attributes BY ID** rather than trusting an earlier total.
