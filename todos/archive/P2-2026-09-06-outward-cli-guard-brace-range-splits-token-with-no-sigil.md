---
title: "guard-outward-cli.sh: brace RANGE expansion splits a binary or verb with no $ or backtick anywhere, defeating every sigil-keyed check on all four paths"
status: in-progress
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

- [x] Reproduce first, on the current tree, before changing anything: run each construction
      above through the hook and record the ACTUAL exit code, plus the `gh pr merge{1..3} 42`
      control. If any does not reproduce, that is a finding — report it rather than fixing
      something that is not broken.
      — Reproduced via `jq -cn ... | bash guard-outward-cli.sh`, checking `permissionDecision`
      in the JSON output (not the process exit code, which is always 0 for a PreToolUse hook).
      All 4 constructions ALLOW; control `gh pr merge{1..3} 42` DENIES. Confirmed again via a
      full `repro-outward-cli-corpus.sh` baseline run: `rows=602 precise-path gaps=31
  all-path gaps=243`, matching the pin already in place on `main`.
- [x] A **narrow deny** on a brace RANGE (`{X..Y}`) that shares a token with a gated binary or
      a gated verb. Narrow means: the range must be glued to gated-command text, not merely
      present in the command.
      — Implemented in `guard-outward-cli.sh` next to the existing `$`/backtick expansion-token
      narrow-deny block, reusing its `_OUT_GATED_BIN`/`_OUT_GATED_VERB`/`_OUT_SEP` glue
      requirement with a new bounded `_OUT_BR_RANGE_TOKEN` class. **VERB-position closes**
      (the binary name stays intact in raw text, so the fast path already lets these reach the
      check — no fast-path change needed). **TOOL-position stays open** (the binary's own first
      letters are split, so the fast-path prefilter never lets these constructions reach ANY
      precise-path check, including this new one) — closing it needs the fast path's stage-3
      decline set widened to a brace-range shape, which this todo's own Scope Contract forbids
      ("no widening of the fast path's sigil class"). This is a genuine scope conflict between
      this AC line and the Scope Contract, surfaced rather than silently resolved either way —
      see the executor's Step 11 report.
- [x] **Do NOT implement this as another deleting rendering.** A brace-deleting rendering
      re-opens the span-end problem that took three review rounds to close on PR #926 (deciding
      where a construct ENDS from raw text, at a point where the stateful scanner is
      unavailable). If a rendering seems unavoidable, stop and escalate rather than writing a
      fourth hand-rolled scanner — see the "STOP OPTIMIZING A PARSER YOU CANNOT WRITE" note in
      `guard-outward-cli.sh`.
      — No rendering added; no `$WORDS`/`$WORDS_SCAN` construction touched. The fix is a
      self-contained `grep -Eq` pattern match, the same shape as every other check in this file.
- [x] Decide and DOCUMENT the treatment of a _multi-value_ range (`{a..z}as update`), which
      real bash expands to many words rather than one. The single-value range `{e..e}` is the
      dangerous shape because it reconstructs exactly one token; a multi-value range may deserve
      a different verdict. State the ruling either way.
      — Ruled: denied IDENTICALLY to a single-value range. Never evaluates which case applies
      (same "never evaluate the expansion" policy as the `$`/backtick siblings), and mirrors
      `_OUT_POS_SUFFIX`'s existing precedent of denying any literal `{`/`}` unconditionally as a
      closer regardless of whether that specific span is provably inert. Documented in the
      guard's own comment above the new block and pinned by an `assert_deny` test
      (`eas up{a..z}ate --branch preview`).
- [x] Bounds are pinned by `assert_allow`, not only denies: ordinary brace use must not start
      denying. At minimum `echo {1..3}`, `mkdir -p /tmp/x/{a,b}`, `find . -name '*.ts' -exec
grep -l x {} +`, and a brace range in a NON-command position.
      — All four pinned, plus a brace range glued to an ARGUMENT (not the verb) and both
      TOOL-position residual shapes (pinned as `assert_allow` so a future change to that
      boundary is visible in a diff).
- [x] Two-sided, mutation-tested regression coverage: revert the fix, confirm the NAMED
      assertions fail, restore, confirm they pass. Per row, never in aggregate.
      — Reverted `guard-outward-cli.sh` to the pre-fix `HEAD` copy, ran the full test suite:
      exactly the 10 fix-dependent assertions failed (6 positives + 1 multi-value + 3
      degraded-mirror), 0 others. Restored: 709/709 passed. The 9 other new assertions
      (already-documented-boundary controls, FP bounds, TOOL-position residual pins) are
      correctly insensitive to this diff by design — same accepted pattern as this file's own
      `eas whoami{x}` negative control.
      **Round-2 addendum:** code-reviewer's round-1 pass found a CRITICAL —
      `_OUT_BR_RANGE_ALREADY_HANDLED` was a bare, position-unanchored substring search, so a
      decoy `merge{1..3}`/`create{1..3}`/`comment{1..3}`/`api{1..3}` ANYWHERE in the command
      (even inside an unrelated `echo` argument) cancelled the whole brace-range block —
      confirmed live: `eas up{d..d}ate --branch preview && echo merge{1..3}` ALLOWED. Fixed by
      anchoring the exclusion to command position. Added 4 more named `assert_deny` pins for
      this specific defect plus 56 generated `r4brange-verb-decoy-*` corpus rows (7 families ×
      4 decoy shapes × {before,after}), all EXPECT=DENY. Mutation-tested the SAME way: reverting
      just the anchoring (back to the bare substring form) flips exactly those 4 new assertions
      (709 passed / 4 failed), restoring returns 713/0.
      **Round-3 addendum:** the SAME dispatch's round-2 pass, following its own instruction to
      try "a decoy that's ALSO a genuine command-position gh construction," found a DEEPER
      CRITICAL in the round-2 fix — command-position anchoring closed the inert-prose decoy but
      the exclusion was still a whole-command existence check independent of WHICH occurrence
      tripped WHICH arm, so a real, independently-ALLOWED gh construction sharing the excluded
      shape (bare `gh api{1..3}`, no mutating flag; bare `gh pr create{1..3}`/`gh pr
  comment{1..3}`, no `--repo`) elsewhere in the command silenced an unrelated dangerous
      glued construction. Confirmed live: `eas up{d..d}ate --branch preview && gh api{1..3}`
      fully ALLOWED (both orderings). Fixed by making the exclusion per-OCCURRENCE (`grep -oE`
      extraction of every trigger match, testing each independently against the exclusion,
      denying if any one is uncovered) instead of a second whole-command check. Added 6 more
      named assertions (5 `assert_deny` + 1 sanity `assert_allow`) plus 42 generated
      `r4brange-verb-genuine-*` corpus rows (7 families × 3 genuine-benign gh shapes ×
      {before,after}), all EXPECT=DENY. Mutation-tested the SAME way: reverting the
      per-occurrence extraction (back to the round-2 whole-command form) flips exactly the 5
      new `assert_deny` assertions (714 passed / 5 failed; the 6th, the sanity allow control,
      correctly stays green — it isn't sensitive to this exclusion at all), restoring returns
      719/0. **Not dispatched for a round-3 review** (the process's 2-round cap) — verified
      instead by extensive first-party adversarial construct-and-run covering every variant this
      executor could derive from the reviewers' own two findings (extra whitespace in the decoy,
      a quoted decoy, a genuine gh construction on either side, order-independence, a sanity
      control confirming the co-occurring gh construction really is independently benign). No
      third bypass found by that pass, but per the guard's own header this is a text-matching
      guardrail, not a proof of unreachability — the residual risk is stated, not claimed away.
- [x] All four execution paths re-checked (precise / no-jq / no-lib / no-awk), each deny
      **attributed by its REASON string** — a DENY is not evidence the intended check fired.
      Note the degraded mirror needs its own change here; it keys on `$`/backtick and will not
      inherit a precise-path fix.
      — `crude_smells_outward`'s trailing-sigil class widened with a brace-range alternative
      alongside its existing `[$`]`. VERB-position rows now DENY on all four paths (confirmed
  via `repro-outward-cli-corpus.sh`'s per-path columns AND its deny-reason attribution list,
  which requires the SAME check to fire, not just the same verdict). TOOL-position rows
  stay ALLOW on all four paths — the degraded mirror ALSO requires the binary name intact,
  the identical limitation as the precise path, for the identical reason (closing it would
  need a deleting rendering in `\_out_crude_vanish`, which this todo forbids).
- [x] False-positive population measured by EXECUTION, not estimated. Braces are common in real
      commands, so this is the highest-FP-risk change in the whole guard chain. Harvest
      historical commands, diff decisions before/after, and **validate the harness on a known
      flip in BOTH directions before trusting a zero**.
      — Harvested 37,871 real Bash tool calls (25,914 unique) from this project's own session
      transcripts. Pre-filtered to 87 commands containing both `{` and `..` (the only ones
      structurally reachable by this change). Ran all 87 through the pre-fix and post-fix guard:
      **0 flips in either direction.** Harness validated with an injected known positive
      (`eas up{d..d}ate --branch preview` — correctly flipped ALLOW→DENY) and a known negative
      (`echo {1..3}` — correctly stayed unflipped). **Caveat, added after round 2/3:** the "this
      change is structurally additive-only" claim originally written here was falsified by
      code-reviewer's round-2 finding — the exclusion COULD suppress a genuine deny outright
      before it was made per-occurrence (see the mutation-testing AC's round-3 addendum). The
      87-command real-history harvest itself is unaffected — re-run against the final
      per-occurrence guard (round 3), not merely assumed to still hold: same result, 0 flips
      either direction — but the reasoning sentence that followed it was wrong and is retracted
      rather than silently corrected.
- [x] Per-call latency measured before and after. The fast path exists for latency alone and a
      prior fix in this chain was correct and 8x slower; measuring decision flips without
      measuring cost has already produced one wrong change here.
      — No fast-path change in this fix, so no command is newly routed to the slow path.
      Measured (20 runs each, wall-clock): a fast-path command (`ls -la`) unaffected
      (23ms → 23ms); a slow-path command already reaching the deep body in both trees
      (`eas update --branch preview`) unaffected within noise (24ms → 23ms); the new-deny
      construction itself (23ms → 22ms). No measurable cost — expected, since this only adds
      ~2 more `grep -Eq` calls inside an already-slow-path command, not a new class of commands
      taking the slow path.
- [~] The 14 `r4brange-*` corpus rows flip to `ok`, and the corpus NOTE6 gap attribution
  (currently `14 + 56 + 2 + 1 = 73`) is recomputed in the same change. Do NOT hand-edit the
  total — re-run and attribute BY ID.
  — **PARTIAL: 7 of 14 flip to `ok`** (`r4brange-verb-*`). The other 7 (`r4brange-tool-*`)
  remain `GAP` by design — see the narrow-deny AC above for why (Scope Contract forbids the
  fast-path change needed to reach them). NOTE6 and the pin constants were recomputed from
  an actual run, not hand-edited: `EXPECTED_PRECISE_GAPS` 31→24, `EXPECTED_ALLPATH_GAPS`
  243→236. `EXPECTED_DENY_ATTRIB_ROWS` and `EXPECTED_ROWS` moved THREE times across the
  review rounds, each bump attributed by ID, never hand-typed: 504→511/602→602 (the 7
  `r4brange-verb-*` rows closing), then 511→567/602→658 (round-1 review CRITICAL: +56
  `r4brange-verb-decoy-*` rows regression-pinning the inert-prose-decoy fix), then
  567→609/658→700 (round-2 review CRITICAL: +42 `r4brange-verb-genuine-*` rows
  regression-pinning the genuine-co-occurrence fix). `EXPECTED_EMIT_SITES` 26→27 (one new
  `deny()` call site; unaffected by the later two bumps, which reuse the same site). Corpus
  pin is green at the final state: `rows=700 precise-path gaps=24 all-path gaps=236 ... all
  609 deny reasons attributed`. A pre-existing, unrelated staleness in NOTE6's own "31 + 133
  = 164" cross-check (already inconsistent with the pin before this todo) was found and
  flagged, not silently re-derived — see the corpus file's own 2026-09-14 comment for the
  measured 212 figure and why the 133/108/25 sub-splits beneath it are out of this todo's
  scope to fix.
- [x] The DOCUMENTED RESIDUALS entry for brace range in `guard-outward-cli.sh` updated to say
      CLOSED rather than open — **for VERB-position; TOOL-position updated to say why it stays
      open** (see above); the VERB-position entry was further corrected after round 2/3 to state
      precisely what "CLOSED" was tested against (two independent adversarial review rounds, not
      "no construction of any kind") — see the guard's own comment, which now names both findings
      explicitly rather than repeating the round-1-only framing. Residual 4 in PR #926's body:
      **done** — updated via `mcp__github__update_pull_request` with a dated, additive addendum,
      verified byte-for-byte that nothing else in the body changed before submitting. **Known
      gap:** that PR-body addendum was written between review rounds and narrates only round 1's
      finding (the inert-prose decoy) — it does not mention round 2's deeper finding (the genuine
      co-occurrence bypass) or the final per-occurrence fix shape. It is not INCORRECT about the
      final state (verb-position does deny on all four paths, which is what it claims), but it
      understates the fix's own history. Left as a known, disclosed gap rather than a second PR
      edit, given the remaining budget — flagged here so the user can decide whether it's worth a
      follow-up edit.
- [x] `docs/solutions/` entry via `/codify` if the root cause generalises. The candidate lesson
      is "enumerating spellings of one mechanism cannot cover a second mechanism".
      — `docs/solutions/conventions/brace-range-is-a-second-expansion-mechanism-not-a-sigil-spelling-2026-09-14.md`.

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
- `todos/archive/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` — a third
  open critical in the same guard. Different mechanism again (an interior redirect); do not fold.
