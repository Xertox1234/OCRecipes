---
title: "guard-outward-cli.sh: brace RANGE expansion splits a binary or verb with no $ or backtick anywhere, defeating every sigil-keyed check on all four paths"
status: backlog
priority: medium
created: 2026-09-06
updated: 2026-09-06
assignee:
labels: [deferred, security, harness, outward-cli-guard]
github_issue:
---

# A brace RANGE splits a token with no sigil for any check to key on

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

Bash brace-range expansion (`{e..e}`) splits a command token exactly the way a vanishing
substitution does, but carries **no `$` and no backtick anywhere in the command**. Every
mechanism the guard uses to notice a split token is keyed on one of those sigils, so all four
execution paths **ALLOW**:

```
{e..e}as update --branch preview     ->  ALLOW  (argv: eas update --branch preview)
```

Found by `security-auditor` in the round-4 review of PR #926, reproduced independently by
execution with controls. **Not a regression** — `main` allows it identically — and explicitly
**not closed by PR #926**, whose body now states the narrowed closure claim.

## Background

`guard-outward-cli.sh` is the PreToolUse gate that stops an agent invoking outward-facing CLIs
unattended. This repo has a real incident from exactly that class (an accidental OTA publish
caused by an agent executing a PATH-resolved outward CLI —
`project_ota_accidental_publish_2026_08_16`), so a silent ALLOW here is critical, not
theoretical.

### Why this is not "one more spelling"

Three review rounds on PR #926 were spent closing spellings of ONE mechanism: an expansion that
evaluates to empty, spelled `${UNSET}`, `$()`, backticks, and (still open, see the sibling
todo) special parameters and ANSI-C quoting. Every fix and every prefilter decision in that
chain keys on a **sigil**: the fast path declines its cheap exit when `$CMD` contains `${`,
`$(` or a backtick; the degraded mirror denies a gated binary near a `$` or backtick.

A brace range contains **neither**. It is a _second expansion mechanism_, not a missing spelling
of the first, and that is the durable lesson: **no enumeration of `$`-spellings at the fast path
can ever be complete.** Adding `{` to the sigil list is not the fix either — `{` is extremely
common in ordinary commands (`${VAR}` aside, think `find -exec {} \;`, JSON, awk programs), so
keying the decline on it would move most commands onto the slow path for no benefit.

### Measured, all four execution paths

| construction                       | precise   | no-jq     | no-lib    | no-awk    | real argv              |
| ---------------------------------- | --------- | --------- | --------- | --------- | ---------------------- |
| `{e..e}as update --branch preview` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | an OTA publish         |
| `eas up{d..d}ate --branch preview` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | an OTA publish         |
| `gh pr me{r..r}ge 42`              | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | a PR merge             |
| `{g..g}h api repos/o/r -X POST`    | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | an authenticated write |

Control, isolating the _range sharing a token with the verb_ as the variable — the already
documented form, where the brace FOLLOWS an intact verb, correctly DENIES on all four:

```
gh pr merge{1..3} 42     ->  DENY
```

That control matters: it shows the guard already handles a brace adjacent to a gated verb. What
it does not handle is a brace whose expansion is _part of_ the verb or binary name.

Note this is the only round-4 mechanism that also defeats the **degraded** paths. The special
parameter family at the verb position is caught there (the mirror sees a gated binary near a
`$`); a brace range gives that mirror nothing to see either.

### Corpus rows already exist

`repro-outward-cli-corpus.sh` carries 14 rows (`r4brange-*` — 2 glue positions × 7 families),
all with **DENY** expectations and all currently reporting as gaps. They are part of the
documented `precise-path gaps=73`. When this todo lands those 14 must flip to `ok` **and the
corpus's NOTE6 gap attribution must be updated in the same change**, or the file contradicts
itself.

## Acceptance Criteria

- [ ] Reproduce first, on the current tree, before changing anything: run each construction
      above through the hook and record the ACTUAL exit code, plus the `gh pr merge{1..3} 42`
      control. If any does not reproduce, that is a finding — report it rather than fixing
      something that is not broken.
- [ ] A **narrow deny** on a brace RANGE (`{X..Y}`) that shares a token with a gated binary or
      a gated verb. Narrow means: the range must be glued to gated-command text, not merely
      present in the command.
- [ ] **Do NOT implement this as another deleting rendering.** A brace-deleting rendering
      re-opens the span-end problem that took three review rounds to close on PR #926 (deciding
      where a construct ENDS from raw text, at a point where the stateful scanner is
      unavailable). If a rendering seems unavoidable, stop and escalate rather than writing a
      fourth hand-rolled scanner — see the "STOP OPTIMIZING A PARSER YOU CANNOT WRITE" note in
      `guard-outward-cli.sh`.
- [ ] Decide and DOCUMENT the treatment of a _multi-value_ range (`{a..z}as update`), which
      real bash expands to many words rather than one. The single-value range `{e..e}` is the
      dangerous shape because it reconstructs exactly one token; a multi-value range may deserve
      a different verdict. State the ruling either way.
- [ ] Bounds are pinned by `assert_allow`, not only denies: ordinary brace use must not start
      denying. At minimum `echo {1..3}`, `mkdir -p /tmp/x/{a,b}`, `find . -name '*.ts' -exec
  grep -l x {} +`, and a brace range in a NON-command position.
- [ ] Two-sided, mutation-tested regression coverage: revert the fix, confirm the NAMED
      assertions fail, restore, confirm they pass. Per row, never in aggregate.
- [ ] All four execution paths re-checked (precise / no-jq / no-lib / no-awk), each deny
      **attributed by its REASON string** — a DENY is not evidence the intended check fired.
      Note the degraded mirror needs its own change here; it keys on `$`/backtick and will not
      inherit a precise-path fix.
- [ ] False-positive population measured by EXECUTION, not estimated. Braces are common in real
      commands, so this is the highest-FP-risk change in the whole guard chain. Harvest
      historical commands, diff decisions before/after, and **validate the harness on a known
      flip in BOTH directions before trusting a zero**.
- [ ] Per-call latency measured before and after. The fast path exists for latency alone and a
      prior fix in this chain was correct and 8x slower; measuring decision flips without
      measuring cost has already produced one wrong change here.
- [ ] The 14 `r4brange-*` corpus rows flip to `ok`, and the corpus NOTE6 gap attribution
      (currently `14 + 56 + 2 + 1 = 73`) is recomputed in the same change. Do NOT hand-edit the
      total — re-run and attribute BY ID.
- [ ] The DOCUMENTED RESIDUALS entry for brace range in `guard-outward-cli.sh`, and residual 4
      in PR #926's body, updated to say CLOSED rather than open.
- [ ] `docs/solutions/` entry via `/codify` if the root cause generalises. The candidate lesson
      is "enumerating spellings of one mechanism cannot cover a second mechanism".

## Implementation Notes

- **Never execute an outward-facing CLI**, including `--help` or `--version`. Feed
  constructions to the hook as JSON text:
  `jq -cn --arg cmd '<construction>' '{tool_name:"Bash",tool_input:{command:$cmd}}' | bash .claude/hooks/guard-outward-cli.sh`
  Where real argv must be proven, shadow a binary with an argv-printing stub on `PATH` — never
  strip `PATH`.
- Writing about these constructions trips the guard's own heredoc-prose false positive
  (`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`), and `ALLOW_OUTWARD_CLI=1`
  clears only the single check that fired. Use file tools (`Write`/`Edit`), never route the
  content through a shell command string.
- Bash 3.2 (stock macOS), `set -uo pipefail`, BSD awk. Brace expansion happens BEFORE parameter
  expansion in bash's order of operations, which is why no substitution-oriented rendering sees
  it.
- `$WORDS` must stay byte-identical — it has one grant-shaped reader (the `gh pr merge --auto`
  CLAUSE) that must not see a synthesized token. Any new rendering is deny-shaped only.
- The generated corpus axis for this mechanism is already written (`R4_RSP_IDS` /
  `r4brange` in `repro-outward-cli-corpus.sh`); extend it rather than hand-listing rows.

## Scope Contract

- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`, and
  this todo. `.claude/hooks/lib/cmd-detect.sh` is **out of scope** — this is a guard-side narrow
  deny, and the lib defects have their own todo.
- **Mechanism:** a narrow deny keyed on a brace range glued to gated text. No new renderings, no
  new hand-rolled scanners, no widening of the fast path's sigil class.
- No new mechanisms, files, or abstractions beyond those listed.

## Related

- PR #926 — the folded repair. Its body carries this gap as residual 4, with the measured table
  and the narrowed closure claim.
- `todos/P0-2026-09-06-cmd-detect-bare-paren-subshell-breaks-substitution-scanners.md` — the
  sibling critical, also from this chain. **Different file and different fix shape** (a lib
  scanner fix vs. a guard-side narrow deny), so they are deliberately not folded; but both touch
  `repro-outward-cli-corpus.sh` and its NOTE6 gap attribution, so **whichever lands second must
  re-run the corpus and re-attribute by ID rather than assuming the first one's totals**.
- `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` — a third
  open critical in the same guard. Different mechanism again (an interior redirect); do not fold.
