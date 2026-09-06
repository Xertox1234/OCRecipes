---
title: "lib/cmd-detect.sh: two defects in cmd_words_vanished — a bare-paren subshell desynchronises the shared scanner, and the deletable-form allow-list is incomplete against its own criterion"
status: done
priority: critical
created: 2026-09-06
updated: 2026-09-06
assignee:
labels: [security, harness, cmd-detect]
github_issue:
---

## OUTCOME (2026-09-06)

**Defect A closed for the bare-paren mechanism; Defect B closed in full. 60 corpus rows
closed, 0 opened.** `precise-path gaps 93 -> 33`, `all-path 145 -> 113`, attributed BY ID by
running the current corpus against both the pre-change hook (`b01fcff2`) and the current one.

### The finding that changed this todo's scope

**Acceptance criterion (B) was not achievable as written, and the reason was one level below
the allow-list.** `guard-outward-cli.sh`'s STAGE 3 prefilter declined its cheap exit only for
`${`, `$(` and a backtick. `$!`, `$1`, `$@`, `$*` and `$'…'` carry none of them, so
`e$1as update --branch preview` missed stages 1 and 2 and **took the cheap exit before
`cmd_words_vanished` was ever computed**. The 21 `r4*-tool-*` rows could not have been closed
by any lib change. Verified by running the real `cmd_fastpath_has` and the real stage-3
`case`, not by reading.

The guard shipped that mistake as a claim in tracked code — its DOCUMENTED RESIDUALS said
"the fix is in lib/cmd-detect.sh's allow-list". Necessary, not sufficient. Corrected in this
change. **Generalisable: a correct fix in the right file is still unreachable when a prefilter
upstream of it declines on a NARROWER signal than the fix's own grammar.**

The prefilter was widened on a **measured** cost, since the guard's own note declined it on
cost grounds: over 28,469 harvested Bash calls the three original digraphs match 13.0%, the
additions match 1.2%, and only **0.8% (238) are newly on the slow path** — about +0.7 ms on
the average call. "`$` alone appears in a large share of real commands" is true of a bare `$`
and false of this narrow set.

### Scope decisions taken with the owner

1. **STAGE 3 widened** so the lib fix is reachable.
2. **Bare-paren closed; the `case`-arm half deliberately deferred.** A paren counter cannot
   see `case x in a)` — an unmatched closer with no opener — and the obvious keyword tracker
   is a deny→ALLOW regression generator (`e$(echo case)as update` DENIES today and would
   render EMPTY under it). 17 rows stay visible gaps under
   `todos/P0-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md`.
3. **The degraded mirror (`_out_crude_vanish`) was NOT widened** — stated, not absorbed. The
   corpus's `ok` is the precise column only; tool-position rows remain degraded-dirty.

### What shipped

- **Per-level paren counter** in BOTH scanner-shaped functions in one change —
  `cmd_extract_substitutions` and `cmd_words_vanished`. Gated to state 0, so a paren inside a
  quoted span still cannot move depth. Emission is untouched: the counter changes only the
  close decision.
- **Arithmetic exempted in the same edit**, because the counter creates the hazard: `$((expr))`
  would otherwise read as a balanced substitution and be DELETED, manufacturing `foo` from
  `f$((1+2))oo` whose real argv is `f3oo` — the `${#x}` class. Copied verbatim, interior never
  re-scanned. `cmd_extract_substitutions` deliberately does NOT mirror this: a substitution
  inside arithmetic genuinely executes (`$(( $(printf 1) + 1 ))` → 2), so the extractor must
  still descend. The shared invariant is agreement on COMMAND-substitution liveness.
- **Special parameters deletable**: `$!`, `$@`, `$*`, `$1`–`$9` (one digit — bare `$10` is `$1`
  then a literal `0`). **Never deleted**: `$?`, `$$`, `$#`, `$0`, `$-`, none of which can be
  empty; `$_` is excluded structurally as an ordinary greedy identifier.
- **ANSI-C decoded in `cmd_words_vanished`, NOT in `cmd_words`** — criterion (B) asked for this
  to be stated. That rendering is deny-shaped-consumers-only, so a decoder there can never
  manufacture a flag that GRANTS a carve-out (`cmd_words` feeds the one grant-shaped check via
  `$WORDS`), and the blast radius is one rendering rather than all seven fast-path hooks. Its
  output is re-scanned by `cmd_words`, so only characters inert to both `cmd_words` state and
  every consumer boundary class are emitted literally; every other decoded byte becomes the
  placeholder — a structural closure of the injection surface, not an enumeration.

### Three defects found by EXECUTION that review had passed

1. **`\0` must delete, not placeholder.** Verified by `od`: bash builds the three bytes `eas`
   for `e$'\0'as` — the NUL is dropped and the token REJOINS. Emitting a placeholder rendered
   `exas`, matching no deny pattern. That was a live bypass in the first draft of the decoder.
2. **The arithmetic span-end test was wrong**, so `$(( $(printf 1) ))` fell into the rescan
   branch and the inner substitution was deleted independently — the reversed-pass-order
   regression the function's own header warns about.
3. **A test row was a decoration.** `echo $'\x27'` → `echo x` stayed GREEN when the
   safe-character filter was deleted. Replaced with rows carrying trailing text, where the
   difference is the point: unfiltered, the decoded quote opens a span and the rest collapses
   to `echo xghxprxmergex42x`, losing the `gh pr merge` deny. Found by mutation testing.

### Verification performed

- Reproduced every row of both tables on the pre-change tree first, including the inverted
  precise/degraded asymmetry. Constructions fed as JSON; **no outward CLI was ever executed**.
- Smoke-tested the load-bearing assumption end-to-end before building the rest, reading the
  deny **REASON**: `e$1as update` denies as "command-position 'eas update/publish/submit'",
  the intended check — not an ambiguity fallback.
- ANSI-C decoder ground-truthed against real bash argv byte-by-byte via an argv-printing shell
  function: **24 rows exact, 1 documented divergence** (`\u`, which zsh decodes and bash 3.2
  does not — decoding is the deny direction).
- **8 mutations, all caught**, 22 named assertions red across them; restore verified.
- Suites: `test-cmd-detect.sh` 496 → **530**, `test-guard-outward-cli.sh` 462 → **483**, both 0
  failed. The guard suite's deliberate assertion-total pin was updated by hand, as intended.
- **False positives measured by execution, not estimated**: 1,658 unique real commands from
  this project's transcripts (the decision-relevant subset), diffed per command against the
  pre-change hook, with a **known flip injected first to validate the harness**. Result: **1
  flip in 1,658 (0.06%)**, ALLOW → DENY, and it is the already-documented heredoc-prose class
  (`` `patch-package` `` followed by the word `run` in a commit message). Recorded on
  `todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`, which is `human_led` and
  blocked on a decision that was deliberately not taken here.

### Landmine for the next editor

`cmd_words_vanished`'s awk program lives inside a **bash single-quoted string**. A literal
apostrophe anywhere in its comments closes that string and makes the whole lib unsourceable —
the guard then fails closed with "broken install", which reads like a guard bug rather than a
syntax error. `bash -n .claude/hooks/lib/cmd-detect.sh` after every edit. This cost a round.

# Two defects in `cmd_words_vanished`, both in `lib/cmd-detect.sh`

Filed as one todo because both are defects of the **same function in the same file**, both are
fixed by the same kind of change (the deletion grammar), and both are covered by the identical
Scope Contract and test/corpus files below. Splitting them would produce two todos that must be
worked in one session anyway.

- **Defect A — bare-paren desync.** The scanner mis-locates where a `$(...)` span ENDS.
- **Defect B — incomplete allow-list.** The scanner correctly locates spans but refuses to
  delete whole families of expansion that satisfy its own stated eligibility rule.

Defect A is below in full (it was this todo's original subject). Defect B is in its own section
after it.

## Summary — Defect A

`lib/cmd-detect.sh`'s substitution scanner counts depth for `$(` but not for a **bare** `(`,
so the first `)` of an inner subshell is read as closing the OUTER `$(...)`. Every consumer
built on that scanner then renders the command wrongly, and
`.claude/hooks/guard-outward-cli.sh` silently **ALLOWS** a real OTA publish:

```
e$( (:) )as update --branch preview     ->  ALLOW   (argv: eas update --branch preview)
```

Found by `security-auditor` during the round-3 review of PR #926 (finding C4), reproduced
independently by execution. **Not a regression** — `main` allows it identically — and **not
closed by PR #926**, whose vanishing-sigil work is what makes the gap reachable to fix.

## Background

`guard-outward-cli.sh` is the PreToolUse gate that stops an agent invoking outward-facing
CLIs unattended. This repo has a real incident from exactly that class (an accidental OTA
publish caused by an agent executing a PATH-resolved outward CLI —
`project_ota_accidental_publish_2026_08_16`), so a silent ALLOW here is critical, not
theoretical.

PR #926 added `cmd_words_vanished`, a rendering that DELETES constructs provably capable of
expanding to empty so a verb split by a vanishing sigil rejoins into the word bash actually
builds (`e` + `$(:)` + `as` -> `eas`). That closed the split-binary-name class for every
mechanism tested. This todo is the one spelling it does **not** close, and the cause is one
level below it, in the scanner the rendering is built on.

### The mechanism, measured

The scanner tracks quote state and increments depth on `$(`, but a bare `(` is an ordinary
character to it. In `$( (:) )` the first `)` therefore closes the outer construct three
characters early, and everything after it is re-scanned as if it were outside the
substitution.

Both scanner-derived functions desynchronise identically (executed, not inferred):

```
cmd_words_vanished 'e$( (:) )as update --branch preview'
  ->  'e )as update --branch preview'          # stray ')', 'eas' never forms
cmd_words_vanished 'e$(: $(:))as update --branch preview'
  ->  'eas update --branch preview'            # NESTED $( ) is handled correctly

printf '%s' 'e$( (:) )as update' | cmd_extract_substitutions
  ->  ' (:'                                    # want ' (:) '
```

The `cmd_extract_substitutions` half is **present on `main`** and mis-parses there too, so
this is a property of the shared scanner shape and not of the new rendering.

`cmd_words_deep` consumes `cmd_extract_substitutions` and therefore inherits the truncation —
but measured, it is **not exploitable through that path today**, and the todo should not claim
otherwise. Because deep APPENDS the extracted body, losing the trailing `) ` does not lose the
verb inside it:

```
cmd_words_deep 'echo $( (eas update --branch preview) )'
  -> appends ' (eas update --branch preview'    # truncated, verb intact
guard verdict: DENY
```

So the exploitable consumer is the SUBTRACTIVE one. That asymmetry is the point worth carrying
into the fix: an appending rendering degrades gracefully under a truncated extraction, a
deleting one does not, because what it deletes is decided by where it thinks the span ends.
Fix the scanner regardless — a consumer that is safe today is one refactor from not being.

### Guard impact, all four execution paths

Measured at `bf5b782e` (re-measured after the round-3 repair landed, not copied forward):

| construction                          | precise   | no-jq     | no-lib    | no-awk    | real argv                   |
| ------------------------------------- | --------- | --------- | --------- | --------- | --------------------------- |
| `e$( (:) )as update --branch preview` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | an OTA publish to end users |
| `g$( (:) )h pr merge 42`              | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | a PR merge                  |
| `n$( (:) )pm publish`                 | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | a package publish           |
| `rail$( (:) )way up`                  | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | a deploy                    |

A `case` arm's `)` is the same defect through a different grammar and behaves identically:
`e$(case x in a) : ;; esac)as update --branch preview` -> ALLOW on all four.

Control, isolating the bare paren as the only variable — the same shape with the inner
subshell removed DENIES on all four paths:

```
e$(:)as update --branch preview          ->  DENY  ('eas update/publish/submit')
e$(: $(:))as update --branch preview     ->  DENY  (a NESTED $( ) is handled correctly)
```

An earlier draft of this table recorded no-jq/no-lib as DENY. That was real at the time but
came from a `_OUT_CRUDE_GREEDY` rendering in `guard-outward-cli.sh` which the round-3 repair
then deleted as unsound — it was the only rendering reconstructing the needle, so its
over-deletion was itself a miss. The table above is the post-repair measurement. **Re-measure
rather than trusting either version**: this row's verdict has already moved twice for reasons
unrelated to the defect itself.

## Summary — Defect B: the deletable-form allow-list is incomplete against its own criterion

`cmd_words_vanished`'s stated rule is that **an expansion form must be PROVEN capable of
evaluating to EMPTY before it may be deleted**. Measured against that rule, the allow-list is
missing two whole families that satisfy it, so a verb or binary name split by one of them never
rejoins and the guard **ALLOWS** the invocation.

Found by `security-auditor` in the round-4 review of PR #926, reproduced independently by
execution with controls. **Not a regression** — `main` allows them identically — and explicitly
**not closed by PR #926**, whose body now states the narrowed claim ("closes the class for the
forms ON the allow-list").

### B1 — SPECIAL parameters

`$!`, `$@`, `$*`, `$?`, `$$`, `$#`, `$1`–`$9`. Each is **one character** long and therefore
_terminates_ against a following letter instead of absorbing it, so it splits a token exactly
the way `${UNSET}` does. Each can be empty (`$1` with no positional args; `$!` in a fresh
shell), which is precisely the allow-list's own eligibility test.

This is worth stating loudly because PR #926 shipped a comment asserting the opposite — that a
bare `$name` "greedily consumes following alphanumerics, so it cannot rejoin two halves of a
verb". **That is true only of an ORDINARY identifier** (`$RUNNER`); it was generalised to the
whole syntax class and is false for every special parameter. The claim has been retracted in
`guard-outward-cli.sh`; this todo is the fix it was wrongly used to defer.

### B2 — ANSI-C quoting

`$'\x61'` and friends. A `$'...'` construct is not empty, but it _respells a character_, which
splits the token just as effectively: `e$'\x61's update` never renders `eas`. Note this is a
respelling, not a deletion, so the fix may belong in `cmd_words`' quote handling rather than in
the vanishing allow-list — decide from the code, and say which in the fix.

### Measured, all four execution paths

| construction                    | precise   | no-jq     | no-lib    | no-awk    | real argv         |
| ------------------------------- | --------- | --------- | --------- | --------- | ----------------- |
| `e$!as update --branch preview` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | an OTA publish    |
| `e$1as update --branch preview` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | an OTA publish    |
| `g$1h pr merge 42`              | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | a PR merge        |
| `e$'\x61's update --branch p`   | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | an OTA publish    |
| `eas up$!date --branch preview` | **ALLOW** | DENY      | DENY      | DENY      | an OTA publish    |
| `gh pr me$!rge 42`              | **ALLOW** | DENY      | DENY      | DENY      | a PR merge        |
| `npm pub$1lish`                 | **ALLOW** | DENY      | DENY      | DENY      | a package publish |

Controls, isolating the SPELLING as the only variable — both DENY on all four:

```
e${UNSET}as update --branch preview      ->  DENY
eas up${UNSET}date --branch preview      ->  DENY
e$'a's update --branch preview           ->  DENY
```

**Read the last three rows carefully — the asymmetry INVERTS.** For a split VERB the _precise_
path ALLOWs while all three degraded paths DENY, because the degraded mirror keys on a gated
binary near a `$` sigil and the precise path has no equivalent. Every other finding in this
chain went the other way. Do **not** assume "degraded fails closed" while working this todo;
it is a per-check property, not an invariant.

### Corpus rows already exist

`repro-outward-cli-corpus.sh` carries 42 rows for this defect (`r4spec-*`, `r4dig-*`,
`r4ansic-*` — 3 mechanisms × 2 glue positions × 7 families), all with **DENY** expectations and
all currently reporting as gaps. They are part of the documented `precise-path gaps=73`. When
this todo lands, those 42 must flip to `ok` **and the corpus's NOTE6 gap attribution must be
updated in the same change**, or the file will contradict itself.

## Acceptance Criteria

Criteria below marked **(A)** apply to the bare-paren defect, **(B)** to the allow-list defect,
and unmarked ones to both.

- [ ] **(B)** Reproduce every row of Defect B's table on the current tree before changing
      anything, and confirm the three controls DENY. If the inverted precise/degraded asymmetry
      does not reproduce, that is itself a finding — report it rather than fixing past it.
- [ ] **(B)** `cmd_words_vanished` deletes every SPECIAL parameter that can expand to empty, so
      `cmd_words_vanished 'e$1as update'` renders `eas update`. Decide and DOCUMENT the
      treatment of forms that can be non-empty (`$$`, `$?` are never empty in practice) — the
      allow-list's criterion is "provably capable of being empty", and a form that cannot be
      empty must NOT be deleted.
- [ ] **(B)** ANSI-C respelling is handled, so `e$'\x61's update` renders `eas update`. State
      in the fix whether this belongs in the vanishing allow-list or in `cmd_words`' quote
      handling, and why.
- [ ] **(B)** The 42 `r4spec-*` / `r4dig-*` / `r4ansic-*` corpus rows flip to `ok`, and the
      corpus NOTE6 gap attribution (currently `14 + 56 + 2 + 1 = 73`) is recomputed in the same
      change. Do NOT hand-edit the total — re-run and attribute BY ID.
- [ ] **(B)** The retracted claim in `guard-outward-cli.sh`'s DOCUMENTED RESIDUALS (the
      special-parameter entry, and residual 3/5 in PR #926's body) is updated to say the gap is
      CLOSED rather than merely retracted-and-open.
- [ ] **(A)** Reproduce first, on the current tree, before changing anything: run each construction
      above through the hook and record the ACTUAL exit code. If any does not reproduce, that
      is a finding — report it rather than fixing something that is not broken.
- [ ] **(A)** The scanner tracks bare-paren depth (or otherwise resolves the desynchronisation) so
      that `cmd_words_vanished 'e$( (:) )as update'` renders `eas update` and
      `cmd_extract_substitutions` on the same input yields `(:)`.
- [ ] The fix is applied to **every** function sharing the scanner shape, not just the one
      named in the reproduction. `cmd_extract_substitutions` and `cmd_words_vanished` both
      desynchronise today; check `cmd_words_deep` and every other consumer, and fix them in
      ONE change. Widening a detector without its sibling consumers is this file's documented
      recurring defect (`occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md`).
- [ ] Quote state is preserved: a `(` or `)` inside single quotes, double quotes or ANSI-C
      quoting must not affect depth. The existing differential pins in `test-cmd-detect.sh`
      (`cmd_words_vanished` vs `cmd_extract_substitutions` on the same input) must stay green
      and be EXTENDED to the bare-paren cases — the two functions must agree.
- [ ] Two-sided, mutation-tested regression coverage: revert the fix, confirm the NAMED
      assertions fail, restore, confirm they pass. Per row, never in aggregate.
- [ ] All four execution paths re-checked (precise / no-jq / no-lib / no-awk), each deny
      **attributed by its REASON string** — a DENY is not evidence the intended check fired.
- [ ] False-positive population measured by EXECUTION, not estimated: a bare `(` inside
      `$(...)` is ordinary shell (`x=$( (cd /tmp && pwd) )`), so a depth change here can
      alter renderings for real commands. Harvest historical commands and diff decisions
      before/after; validate the harness on a known flip before trusting a zero.
- [ ] **(A)** Corpus rows added to `repro-outward-cli-corpus.sh` for the bare-paren mechanism at the
      TOOL, VERB and FLAG positions — generated from the mechanism axis, not hand-listed.
      (Defect B's rows already exist; see its section.)
- [ ] `docs/solutions/` entry via `/codify` if the root cause generalises.

## Implementation Notes

- **Never execute an outward-facing CLI**, including `--help` or `--version`. Feed
  constructions to the hook as JSON text:
  `jq -cn --arg cmd '<construction>' '{tool_name:"Bash",tool_input:{command:$cmd}}' | bash .claude/hooks/guard-outward-cli.sh`
  Where real argv must be proven, shadow a binary with an argv-printing stub on `PATH` —
  never strip `PATH`.
- Writing about these constructions trips the guard's own heredoc-prose false positive
  (`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`), and `ALLOW_OUTWARD_CLI=1`
  clears only the single check that fired. Use file tools (`Write`/`Edit`), never route the
  content through a shell command string.
- The scanner is BSD `awk` under bash 3.2. `cmd_words_vanished`'s header already documents
  why quote states are gated the way they are (a `)` met inside a double-quoted span nested in
  an outer `$(...)` body does NOT close the outer construct) — read that before touching the
  close conditions; an earlier draft that shared the close condition across states corrupted
  everything after the first `)`.
- `cmd_words_vanished`'s header also states "NO BALANCED-BRACE WALK IS NEEDED, and that is
  not an oversight" — that claim is about `${...}` BODIES being brace-free by construction.
  It says nothing about parentheses, and must not be read as covering this case. If the fix
  changes what that paragraph asserts, update it in the same change.
- Deletion is the dangerous direction here. `cmd_words_vanished` is SUBTRACTIVE, so a wider
  deletion can DISARM a presence check — see
  `docs/solutions/logic-errors/deletion-pass-must-prove-construct-can-be-empty-2026-09-02.md`
  and the "UNIONED IN, never SUBSTITUTED FOR" rule now stated on the function itself.

## Scope Contract

- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/test-cmd-detect.sh`,
  `.claude/hooks/repro-outward-cli-corpus.sh`, `.claude/hooks/test-guard-outward-cli.sh`,
  and this todo.
- **Mechanism:** fix the depth/quote tracking in the shared scanner. Do NOT add a second
  hand-rolled scanner, and do NOT compensate for it inside `guard-outward-cli.sh` — a
  guard-local workaround would leave every other consumer of the lib wrong while reading as
  though the class were closed.
- No new mechanisms, files, or abstractions beyond those listed.

## Related

- PR #926 (merged `4113d3ac`) / `todos/archive/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md`
  — the folded repair that introduced `cmd_words_vanished` and closed the allow-listed spellings
  of the split-binary-name class. **Archived, so read it from `todos/archive/`.**
- `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` — a
  separate, also-open critical gap in the same guard. Different mechanism (an interior
  redirect, not a substitution scanner); do not fold them.
- `todos/P0-2026-09-06-outward-cli-guard-brace-range-splits-token-with-no-sigil.md` — the
  round-4 sibling. Same review round and the same "a token is split and the guard cannot see
  it" symptom, but a brace range carries no `$` at all, so the fix is a **guard-side narrow
  deny**, not a lib scanner change. Deliberately not folded here. Both todos edit
  `repro-outward-cli-corpus.sh` and its NOTE6 gap attribution, so **whichever lands second must
  re-run the corpus and re-attribute BY ID** rather than assuming the first one's totals.
- `docs/solutions/logic-errors/quoted-command-substitution-always-executes-2026-08-17.md`
