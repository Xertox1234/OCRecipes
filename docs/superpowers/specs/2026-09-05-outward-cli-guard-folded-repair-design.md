# Design: folded repair of `guard-outward-cli.sh` — boundary, absorber, expansion and sigil bypasses

- **Date:** 2026-09-05
- **Status:** design, pending implementation
- **Baseline:** `main` @ `3d4f85aa`, hook suite `Results: 280 passed, 0 failed` (exit 0)
- **Authority:** folds three ruled P0 todos into one change at the repository owner's
  direction (2026-09-05), taking the second arm both sequencing notes offer:
  _"or scope them into one change with a single corpus covering both mechanisms."_

> **This file is not the binding record.** `docs/superpowers/` is gitignored
> (`.gitignore:100`). The binding artifacts are the three tracked todo files, which this
> change must amend. Anything recorded only here does not survive the session.

## 1. Scope

Folds, in one branch and one PR:

| Todo                                                                           | Ruling                                             | Contributes                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------- |
| `todos/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md`      | n/a (defect report)                                | C1, C2, A, B                             |
| `todos/P0-2026-09-02-outward-cli-guard-vanishing-sigil-boundary-decision.md`   | 2026-09-03, option (a) — close all three positions | sigil suffix / prefix / mid-token        |
| `todos/P0-2026-09-02-outward-cli-guard-command-position-expansion-decision.md` | 2026-09-03, option (c) — narrow deny               | verb synthesis, `crude_smells_outward()` |

Six mechanism families, all measured live on `main` (§3).

## 2. What changed since the todos were written

All four corrections below were verified by execution or by direct file read on
2026-09-05 against `main` @ `3d4f85aa`. Each must be written back into the tracked todo
that carries the stale claim — a retraction that lives only in a commit message does not
survive.

### 2.1 C1's PR-merge rows no longer reproduce, and the reason matters

The boundary todo's C1 matrix records `PRMERGE 42 --auto ${x:---admin}` as a silent
**ALLOW**, and its Impact paragraph claims _"a real administrator-override merge … receives
a silent ALLOW."_ Measured today:

```
gh pr merge 42 --auto --admin         DENY   'gh pr merge --admin' uses administrator privil…
gh pr merge 42 --auto ${x:---admin}   DENY   'gh pr merge' without a REAL --auto flag…
gh pr merge 42 --auto $UNRELATED      DENY   'gh pr merge' without a REAL --auto flag…   [control]
gh pr merge 42 --auto ${x:-hello}     DENY   'gh pr merge' without a REAL --auto flag…   [control]
gh pr merge 42 --auto                 ALLOW
```

The two controls carry a `$` unrelated to `--admin` and produce the **identical** deny
reason, while the literal baseline produces a **different** one. Attribution is therefore
unambiguous: the deny comes from `guard-outward-cli.sh:928` (`grep -qF '$'` on the merge
clause ⇒ `HAS_REAL_AUTO=no`), not from the `--admin` boundary check at `:965`, which never
fires on these inputs.

Two consequences:

1. **The Impact claim is false and must be retracted.** `--admin` via a default-value
   expansion is not a live bypass today; `:928` masks it. Fixing `:965` remains correct
   (uniformity across the three boundary sites, and `:928` is a coarse guard that a future
   change could narrow), but it is defence-in-depth, not closure of a live hole.
2. **No C1 regression test may use the `gh pr merge` family.** Such a test passes without
   the fix — it would be a decoration, pinned to `:928`. This is the repo's own
   `deny-reason-assertion-goes-stale-when-a-stricter-branch-fires-first` pattern in mirror
   image. C1 assertions must use `eas build --auto-submit` and `gh pr create|comment
--repo/-R`, where no masking guard exists.

### 2.2 C1's Risk paragraph inverts the blast radius

The todo states C1 _"touches the shared boundary construct used by every flag check."_
There is no shared construct. The class is hand-written at exactly three sites:

```
324: _OUT_REPO_FLAG_RE='(^|[^-A-Za-z0-9])(--repo([^-A-Za-z0-9]|$)|-R)'
653:    && scan_both '(^|[^-A-Za-z0-9])--auto-submit'; then
965:  if scan_both '(^|[^-A-Za-z0-9])--admin([^-A-Za-z0-9]|$)'; then
```

covering three flags. Every other flag/token check uses a different mechanism entirely —
awk field equality (`:904`, `:934`) or a whitespace boundary (`:1103`). C1 is the
**narrowest** of the six families, not the widest. The largest false-positive corpus
therefore belongs to C2 and to the narrow-deny predicate (§4.6), not to C1.

### 2.3 Findings A and B are already in `DOCUMENTED RESIDUALS`

The todo's Summary asserts none of the four _"appears in the guard's own `DOCUMENTED
RESIDUALS` section."_ False for A and B, which occupy `guard-outward-cli.sh:227-248` and
close with:

```
#     confirmed repro and the full anchor-by-anchor comparison. NOT fixed
#     here — flagged 2026-09-02 for a human decision.
```

The same claim is duplicated as prose in `test-guard-outward-cli.sh:423-431` (suffix side)
and `:465-471` (prefix side), and again in the two external disclosure sites §4.7 lists. So
the residuals work is **amend five existing sites across four artifacts**, not append new
bullets. Only C1 and C2 are genuinely absent from every copy.

### 2.4 The Dependencies section is stale

_"Independent of the command-position expansion decision todo; that one is structural and
may never land."_ Both siblings were ruled 2026-09-03 and both change the same anchor pair.
That sentence is what this fold supersedes.

## 3. Measured baseline

A 43-construction corpus was executed against the live hook on four execution paths
(precise, no-`jq`, no-lib, no-`awk`) — 172 invocations — plus a 19-row attribution
follow-up. No outward-facing CLI was executed: every construction is passed to the hook as
a JSON string, and the hook only reads text and prints a decision.

| Family                                          | Live precise-path ALLOWs | Degraded paths                         |
| ----------------------------------------------- | ------------------------ | -------------------------------------- |
| A — `_OUT_POS_SUFFIX` lacks `<` `>`             | 6                        | all deny                               |
| B — `_OUT_POS_PREFIX` lacks redirect absorption | 4                        | all deny                               |
| C1 — default-value expansion supplies flag text | 5                        | all deny                               |
| C2 — expansion supplies the method value        | 2                        | all deny                               |
| Sigil — vanishing sigil, 3 positions            | 6                        | boundary 2 deny; **mid-token 3 ALLOW** |
| Expansion — verb never appears literally        | 5                        | **4 ALLOW**                            |

**28 distinct live bypasses. Seven ALLOW on all four execution paths** — the three
mid-token sigil forms and four verb-synthesis forms. Those seven are the only rows with no
defence at any layer.

Nine everyday-idiom controls stay ALLOW on the precise path and form the false-positive
baseline: `mkdir -p dir/{a,b,c}`, `cp file.txt{,.bak}`, `eslint --fix
client/src/*.{ts,tsx}`, `for i in {1..3}`, a plain trailing redirect, `${HOME:-/tmp}`,
`gh pr view`, `gh api` without a method flag, and a commit message _mentioning_ the gated
verbs.

Two rows in the first probe pass were mislabelled by the probe author, not by the todo: the
redirect was glued to an argument (`gh pr merge 42</dev/null`) and to a flag
(`--auto-submit>/dev/null`) rather than to the verb. Corrected, all six verb-glued forms
ALLOW and the spaced control denies — finding A reproduces exactly as recorded.

Degraded-path asymmetry worth stating, because it inverts the usual expectation:
`crude_smells_outward()` has no command-position anchor at all, so it is _stricter_ than
the precise path nearly everywhere — it denies read-only `gh api repos/o/r` and a commit
message quoting the gated verbs. It fails **open** only where an expansion's letters break
its `[^a-zA-Z]+` separator class, which is exactly the mechanism §4.6 must close.

## 4. Architecture

The guard already solves "the shell sees something the matcher does not" with **renderings**:
`$CMD` (raw), `$WORDS` (`cmd_words`, argv-faithful), `$WORDS_DEEP` (`cmd_words_deep` —
`$WORDS` plus every substitution body, newline-joined). Four of the six families are fixed
by widening existing regexes; the fifth needs one new rendering; the sixth needs a
predicate.

Renderings compose safely for one reason only, and it is a precondition, not an
observation: **deny-shaped consumers only.** `scan_both`'s contract at `:613-620` and
`cmd_words_deep`'s at lib `:599-609` both state it. Any new rendering inherits the rule, and
`$WORDS` must stay byte-identical so the single grant-shaped consumer (the `gh pr merge
--auto` carve-out) keeps its contract.

### 4.1 Stage S0 — durable corpus generator (no behaviour change)

All three todos record that their reproduction fixtures "lived in a session scratchpad and
are NOT durable." S0 commits a generator that regenerates them, satisfying AC #1 for all
three ("reproduced first against unmodified `main`") and leaving the artifact behind.

- Corpus is **generated from dimensions**, never hand-listed (§5).
- Envelopes built with `jq -nc --arg`, piped to the hook exactly as `run_hook` does.
- Records the hook's **actual exit code and stdout**, plus the deny-reason fingerprint —
  reason attribution is what caught §2.1 and must not be dropped.
- Never executes an outward CLI. Where real argv must be proven, use an argv-printing stub
  on `PATH` that shadows the binary; never strip `PATH`.

Writing this file is itself subject to the guard's heredoc-prose false positive
(`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`). `ALLOW_OUTWARD_CLI=1`
clears only the single check that fired, so content carrying several trigger shapes must be
written with a file tool, never routed through a shell command string.

### 4.2 Stage S1 — finding A (suffix closers) and finding B (prefix absorber)

**A.** Do not "add two characters". The lib already holds the correct class; make the
guard's match it, so the invariant is checkable rather than remembered:

```
guard :267  _OUT_POS_SUFFIX='([[:space:]]|[);&|`{}]|$)'          ← missing < >
lib   :126  _CMD_POS_SUFFIX='([[:space:]]|[);&|`{}<>]|$)'        ← correct
```

The same closer set must be applied to **both branches** of
`_OUT_POS_SUFFIX_MERGE_CLAUSE` (`:315`, sole consumer `:891`) in the same commit:

```
315: _OUT_POS_SUFFIX_MERGE_CLAUSE='([[:space:]][^;&|)`{}]*|[);&|`{}]|$)'
                                                 ^^^^^^          ^^^^^^
                                                 branch 1        branch 2
```

Widening one branch and not the other is the round-3/round-5 defect that recurred twice
inside the PR #910 repair chain. Note this variable is named as a failing anchor in the
sigil todo but appears in neither sequencing note — the fold is what assigns it an owner.

Widening `_OUT_POS_SUFFIX` moves ~15 code sites, including the `GH_API_RE` (`:1032`) /
`GH_API_CLAUSE` (`:1091`) detector-and-consumer pair. That pair is where the round-2 fix
already went wrong once by widening the detector and leaving the consumer's hardcoded space
behind. **Enumerate every consumer with a disjoint grep** — a naive `grep _OUT_POS_SUFFIX`
also matches `_OUT_POS_SUFFIX_MERGE_CLAUSE`.

**B.** Add the lib's `_CMD_REDIR` (lib `:117`) to `_OUT_POS_PREFIX`'s absorber run **by
reference**. Referencing is free; _changing_ `_CMD_REDIR` is not — it is interpolated into
both `_CMD_POS_PREFIX` and `_CMD_GIT_GLOBALS`, reaching seven lib matchers and four sibling
hooks. This change references only.

> **Ordering trap — a fix that looks right and does nothing.** `_OUT_POS_PREFIX` is defined
> at `:266`; `lib/cmd-detect.sh` is sourced at `:520`. Interpolating `$_CMD_REDIR` at `:266`
> expands to the **empty string** — no error (`set -uo pipefail`, no `-e`), suite still
> green, bypass still open. The anchor definitions must move below the source. Verified
> safe: every `_OUT_POS_*` consumer runs at `:629` or later, and the four degraded
> exit-early branches that fire before `:520` use `crude_smells_outward()` only.

### 4.3 Stage S2 — C1 (boundary alternative)

Bash's default-value operators (`:-` and bare `-`) consume one `-` from the source and leave
the rest of the word as the expansion, so `${x:---auto-submit}` places a literal `-`
immediately before a real two-dash flag. `${x:+…}` and `${x:=…}` deny correctly because `+`
and `=` pass the class — that contrast isolates the operator family as the root cause.

Add one **leading alternative** to each of the three boundary regexes (`:324`, `:653`,
`:965`), matching a default-value operator opening immediately before the flag text.

Why an alternative rather than a normalisation pass: an added alternative is **local**, so it
needs neither recursion nor a proof that the construct can be empty. It therefore sidesteps
both objections that caused the `${…}` deletion pass in `cmd-detect.sh` to be reverted on
2026-09-02. Nesting (`${a:-${b:---repo}}`) matches on the inner span, which is sufficient.

Safety rests entirely on monotonicity — an added alternative to a deny-shaped check can only
add denies. **Verified**, not assumed:

- `:653` and `:965` go through `scan_both`, whose precondition (`:613-620`) is deny-shaped
  callers only.
- `:324` is consumed at `:360` inside `gh_pr_clause_has_repo`, whose two callers (`:749`,
  `:995`) both call `deny()`. The function's own comment at `:356` states it:
  _"`--repo`/`-R` only ever ADDS a deny, it never grants a carve-out."_

Precision check the alternative must satisfy: `${x:----admin}` yields argv `---admin`, which
is **not** the gated flag and must stay allowed. Anchoring the flag match immediately after
the operator gives this for free — a three-dash remainder leaves a `-` before the two-dash
match, which the unmodified class already rejects.

Coverage the alternative must include: `${x:--R}` (short form, no trailing boundary by
design) and the `gh pr create` family, both measured live and neither recorded in the todo.

### 4.4 Stage S2 — C2 (unverifiable method)

Ruled by the repository owner 2026-09-05: a non-literal method is **unverifiable ⇒ deny**.

Reuse the house pattern already in the file at `:928` — a surviving `$` in the extracted
clause means the token cannot be read statically, so the permissive branch is not taken.
Apply it to the `gh api` block (`:999-1106`), whose clause is cut at `:1091` and whose method
literal is tested at `:1103` via `_GH_API_M`.

This block **allows by default** (an empty clause silently allows — `:1016-1025`), which is
the opposite failure mode from the merge block. The `$`-unverifiable branch must therefore be
placed so it denies on an unreadable clause rather than falling through to the allow.

Accepted cost, to be measured not estimated: `gh api -X $METHOD` now denies even when the
variable holds `GET`. `ALLOW_OUTWARD_CLI=1` remains the escape hatch. This is the change's
single largest new over-denial surface and gets the largest false-positive corpus (§6).

### 4.5 Stage S3 — the vanished rendering (sigil, three positions)

Ruled 2026-09-03, option (a): close suffix, prefix **and** mid-token.

Suffix is a closer-class widening. Prefix and mid-token are not: bash consumes the whole
balanced sigil, so there is no boundary byte to add, and mid-token _splits the verb_
(`me` + vanishing sigil + `rge` → argv `merge`, argv-proven 2026-09-03 and re-measured
2026-09-05 as ALLOW on all four execution paths). No character class reaches that.

**Mechanism: one additional rendering** — the command text with every construct _provably
capable of expanding to empty_ deleted.

#### Where it is produced, and where it is consumed

This is the part that decides whether S3 works at all, so it is specified rather than left
to the implementer.

**Produced by a NEW lib function** (working name `cmd_words_vanished`), not by modifying
`cmd_words` or `cmd_words_deep`. Modifying either would reach the lib's five `cmd_words_deep`
predicates and the four sibling hooks behind them. A new function reaches nothing until
something calls it. This also keeps `test-cmd-detect.sh`'s existing pins intact — `:625`
(`git ${x}checkout -b real` ⇒ `no`), `:627` (`${#x}` must not shadow a real later create) and
`:629` (`${a:-${b}}`) all exercise `cmd_is_git_branch_create` /
`cmd_git_branch_create_segment`, which deliberately read plain `cmd_words`. Confirm that
before writing: if a pin does flip, that is a **decision** about the reverted pass's
safe-miss behaviour, not a fix to fold in silently.

**It is the opposite operation to `cmd_words_deep`, and both are wanted.** `cmd_words_deep`
_extracts and appends_ substitution bodies so a verb hiding inside one is still seen
(`echo $(eas update)`); the vanished rendering _deletes_ them so a verb split by an empty one
is still seen (`me$()rge`). They must be separate lines. An implementer "simplifying" one into
the other loses a family.

**Consumed on a split surface, because the guard's `$WORDS_DEEP` consumers are not
interchangeable:**

| Consumer class                                                | Sites                                      | Feed                                         |
| ------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| boolean invocation matchers (`grep -Eqi … <<< "$WORDS_DEEP"`) | `:629`–`:728`, `:972`, `:991`              | union of `$WORDS_DEEP` and the vanished line |
| occurrence counters                                           | `:742`, `:992`, `:1041`                    | see below — **must not** receive the union   |
| clause extraction                                             | `:891` (`$WORDS`), `:1091` (`$WORDS_DEEP`) | unchanged                                    |

> **Why the union must not reach the counters.** Each of `GH_PR_MERGE_OCCURRENCES` (`:742`),
> `GH_PR_CREATE_OCCURRENCES` (`:992`) and `GH_API_OCCURRENCES` (`:1041`) gates a
> `>1 ⇒ deny` ambiguity branch. Appending a whole-command rendering doubles every verb
> occurrence, so an ordinary single invocation would count 2 and deny. That is a mass
> over-denial, and it would be discovered as "the guard suddenly denies everything," not as a
> subtle regression.

But the counters cannot simply be skipped either: the merge and `gh api` blocks are _gated
behind_ them, so a mid-token verb that only the vanished rendering can see must still raise
its block's count from 0 to 1. **Resolution: each counter takes the maximum of its
per-rendering counts** — `max(count(WORDS_DEEP), count(vanished))` — which preserves the
ambiguity semantics (two real invocations still count 2) while letting a
vanished-rendering-only verb reach its block. Clause extraction stays on its existing feed.

Verify by probe, before building on it, that (a) `gh pr me${UNSET}rge 42` actually reaches the
merge block under this composition, and (b) no single-invocation command's count rises —
checking the nine §3 idiom controls plus one plain invocation per verb family.

The allow-list is binding, from `cmd-detect.sh:1243-1244`:

> _"an expansion form must be proven capable of evaluating to EMPTY before it may be
> neutralized, not merely opened with `${`."_

| Form                                           | Can be empty?                | In the rendering? |
| ---------------------------------------------- | ---------------------------- | ----------------- |
| `${x}`, `${x:-}`, `${x-}`, `${x:+}`            | yes                          | delete            |
| `$(…)`, `` `…` ``                              | yes                          | delete            |
| `${x:-TEXT}`, `${x:=TEXT}` with non-empty TEXT | no                           | leave verbatim    |
| `${#x}` (length)                               | **never** — always ≥ 1 digit | leave verbatim    |

Deleting a never-empty form is precisely the 2026-09-02 regression: it manufactures a clean
boundary for text that can never execute. The second half of that lesson binds too — the
reverted pass was a single non-recursive `sed`, which left a dangling `}` on `${a:-${b}}`.
The replacement must be genuinely balanced, which is why the existing stack scanner is the
natural host.

**Reuse assessment, as the ruling requires ("check reuse first, and say why if it does not
fit"):** `cmd_extract_substitutions` (lib `:460-574`) is the file's only balanced scanner. It
balances `$(`/`)` and backtick pairs with an explicit depth stack and per-level quote state —
exactly the machinery needed. But it has **zero `${` awareness**: there is no `{` test
anywhere in the function, and both `$`-opener branches (`:478`, `:561`) require a literal `(`
as the next byte, so `${x}` falls through to the catch-all accumulator as four ordinary
bytes. Extending it is therefore real work, not reuse-as-is — but extending the one existing
balanced scanner is still the sanctioned shape, and materially safer than adding a second
matcher that can diverge from it.

Two consequences of its current `${`-blindness that the corpus must cover: a `$(…)` nested
_inside_ a `${…}` is still extracted (the `${` is invisible), and a `)` inside a `${…}` that
sits inside a `$(…)` closes the substitution early at `:500`.

### 4.6 Stage S4 — narrow deny and the degraded path

Ruled 2026-09-03, option (c). The ruling's own words define the predicate:

> _deny only when an expansion sits in command position **and** the surrounding command
> shape already smells outward-facing (a gated binary name is present but the verb is not
> literal)_

and the ruling is explicit that where the line falls **is the deliverable**, not settled by
the ruling. Never evaluate the expansion — that mechanism is ruled out in both sibling todos
and would itself be the vulnerability.

Measured target set (all ALLOW today, four of them on every execution path):
`gh pr ${v:-merge} 42`, `gh pr ${v-merge} 42`, `gh pr ${!ind} 42`,
`gh pr $(printf merge) 42`, `${e:-eas} update --branch preview`.

**`crude_smells_outward()` must be closed too** — the ruling hardens the todo's disjunctive
AC ("fixed **or** documented") into a requirement. Its verified cause is that the letters
inside an expansion break the `[^a-zA-Z]+` separator class at `:397`.

Two constraints on that fix:

1. The fail-open is **verified for the expansion mechanism only**. The sigil todo makes no
   such claim and says "do not assume the fallback covers this one" — and measurement agrees:
   the boundary sigil forms already deny on all three degraded paths, while the mid-token
   forms allow on all of them. Do not let one verified fail-open become a blanket claim.
2. The crude path is **already immune to C1 and C2**, because `:395` strips `$` before
   matching and the path has no dash-boundary class at all. Introducing a boundary class
   there would _create_ a bypass. Leave it alone for those two families.

### 4.7 Stage S5 — disclosure sweep

One retraction, five sites, four artifacts. Grep the claim; do not edit only the copy in
front of you.

| Site                                                                                                  | Action                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `guard-outward-cli.sh:227-248`                                                                        | amend both sub-bullets from "NOT fixed here" to closed                                                                           |
| `guard-outward-cli.sh` header / `DOCUMENTED RESIDUALS`                                                | record what C1/C2/sigil/expansion now cover, and the new residuals                                                               |
| `test-guard-outward-cli.sh:423-431`, `:465-471`                                                       | amend the "live, unfixed" prose                                                                                                  |
| `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md` | round-4 section                                                                                                                  |
| PR #910 body, gap #6                                                                                  | `mcp__github__update_pull_request` — editing a merged PR body is a GitHub write and will meet this guard; do not reach for a CLI |

Plus the three tracked todo files: the §2 corrections, the corrected matrices, and the
lifted fence (§7.3). Append or amend; never silently delete a prior claim.

## 5. Corpus construction

Generated from dimensions, never hand-listed. Axes:

- **verb family** — eas update/publish/submit · eas build `--auto-submit` · npm publish ·
  npm/yarn/pnpm run update:preview|production · railway up · gh pr merge · gh pr
  create|comment `--repo`/`-R` · gh api
- **glue mechanism** — none (literal baseline) · trailing redirect glued · leading redirect ·
  default-value expansion (`:-`, bare `-`) · non-default expansion (`:+`, `:=`, `#`) ·
  vanishing sigil (`$()`, backtick, `${UNSET}`) · verb synthesis (`${v:-verb}`, `$(printf
verb)`, `${!ind}`)
- **position** — command prefix · verb suffix · mid-token · flag name · flag value
- **execution path** — precise · no-`jq` · no-lib · no-`awk`
- **direction** — must-deny · must-allow (false-positive control)

**A cross product picks one value per axis, so a guard that fires only on CO-OCCURRENCE is
never reached and passes by agreeing.** Co-occurrence cases must be constructed
deliberately. At minimum:

- a leading redirect **and** a glued trailing redirect in one command (B ∩ A);
- a vanishing sigil **and** a default-value expansion in one command (S3 ∩ C1);
- a masking guard **and** the defect it hides — the `gh pr merge --auto ${x:---admin}` shape
  from §2.1, pinned with its _reason_, so a future narrowing of `:928` cannot silently
  reopen C1 unnoticed;
- a detector/consumer pair on one line — `GH_API_RE` (`:1032`) with `GH_API_CLAUSE`
  (`:1091`), the pair that already diverged once.

## 6. Verification protocol

**Mutation, two-sided, per assertion.** For each new assertion: revert or stub its fix,
confirm the assertion **FAILS**, restore, confirm it passes. Quote the real `Results: N
passed, M failed` lines before and after, with the corpus that produced them. A control that
stays green under mutation is not a control.

Baseline to quote from: `Results: 280 passed, 0 failed`, exit 0.

**Pin the total.** The suite's assertion count is not pinned anywhere, so a silently-skipped
assertion produces no failure — only an outright `FAIL:` does. This change should add a
total pin, or the mutation evidence rests on a number nothing defends.

**Strengthen the degraded-path helper, or assert reasons.** `check` (the degraded-path
helper) matches only the generic deny marker with no reason substring, and its allow branch
tests empty stdout alone — no exit code, no stderr, unlike `assert_deny`/`assert_allow`. S4
adds _mandatory_ degraded-path coverage using the suite's weakest helper. Either strengthen
`check` or assert a reason on the new rows. §2.1 is the standing proof that a deny without
attribution can be the wrong deny.

**False positives measured by execution, not estimated.** A "decline to act" branch is only
safe for inputs the old code did not act on — run the old code to learn that set. This repo
lost 144 real denies to one unverified sentence of exactly this shape. Concretely: harvest
real `Bash` command strings from this project's session transcripts, run both the old and new
hook over every one, diff the two decision sets, and report **every command whose decision
flips**, with counts. Estimating the population is not acceptable for any of the three todos.

The harvest needs a stated scope and floor, or it measures nothing:

- **Scope:** `Bash` tool-call command strings from this project's session transcripts
  (`~/.claude/projects/-Users-williamtower-projects-OCRecipes/**/*.jsonl`), deduplicated.
- **Floor:** report the harvested count. A corpus that contains **zero** instances of a
  construct is evidence about that construct's frequency, not about the fix's safety —
  say which conclusion is being drawn before running it, not after.
- **C2 specifically needs `gh api … -X …` invocations.** None of the nine §3 idiom controls
  contains one. If the harvest yields no historical `-X $VAR` form, the honest reading is
  "this shape does not occur in practice here," and the over-denial is accepted on that basis
  — explicitly, in the residuals, rather than reported as a measured-zero false-positive rate.
- Where the harvest is thin, supplement with hand-built idiom controls, and label which rows
  are harvested and which are constructed. The two carry different evidentiary weight.

## 7. Scope amendments — stated, not slipped in

All three scope contracts end with "No new mechanisms, files, or abstractions beyond those
listed." Three deliberate widenings follow, each recorded here and in the amended todos.

### 7.1 The vanished rendering is a new mechanism

No listed mechanism reaches mid-token. The ruling requires closing it, so the ruling implies
the mechanism — but the inference is written down rather than assumed. It is constrained to:
one additional derived rendering, fed only to deny-shaped consumers, with a
provably-can-be-empty allow-list. It performs no expansion evaluation, adds no dependency,
and adds no file.

### 7.2 `lib/cmd-detect.sh` is not in the sigil todo's file scope

Extending `cmd_extract_substitutions` with `${…}` awareness touches a file whose constants
are consumed by four sibling hooks (`branch-preflight.sh`, `commit-verify.sh`,
`drift-detect.sh`, `drift-detect-update.sh`). Hosting the walker in the guard instead would
avoid that, at the cost of being the second hand-rolled balanced matcher the lib header
(`:108-117`) and both sibling todos explicitly forbid.

**Decision: add a new function to the lib; modify no existing one.** `test-cmd-detect.sh`
gains coverage for it, and the lib's `DOCUMENTED RESIDUALS` (`:19-65`, which currently carries
no `${…}` entry) is updated.

**Amended 2026-09-05 during planning — the amendment is smaller than first written.**
`cmd_extract_substitutions` is **not modified and needs no `${` awareness at all.** Every form
on the vanish allow-list (`${name}`, `${!name}`, `${name:-}`, `${name-}`, `${name:+}`,
`${name=}`) is **brace-free by construction**, so scanning to the next `}` and testing the body
against that grammar is provably sufficient — a nested form such as `${a:-${b}}` simply fails
the grammar test and is left verbatim, a safe miss rather than a false match. Only
`$(…)`/backticks need real balancing, and the new function reuses the extractor's
_state-machine shape_ (same four quote states, same depth stack) rather than its code.

The residual risk is that a same-shape copy can still drift from the original — the mechanism
by which `GH_API_CLAUSE` came to be missed. Mitigation is a **differential test**: for a
corpus of strings, assert that every span `cmd_extract_substitutions` reports as live is a span
the new function deleted, and that an inert span is deleted by neither.

One ordering constraint is load-bearing and belongs in the design, not just the code: the
`${…}` grammar test runs **before** the `$(…)` walk descends, never after. Reversed,
`${x:-$(echo hi)}` — which can never be empty — has its inner substitution deleted first,
leaving `${x:-}`, which then matches the empty-default grammar and is deleted too. Two
individually-correct passes composing into exactly the regression this allow-list exists to
prevent.

### 7.3 The boundary todo's fence is lifted

The boundary todo says: _"Do not fix the suffix side as part of this todo… let the decision
todo own both sides."_ That fence exists to prevent a **half**-fix; one change covering all
three sigil positions is its opposite. The repository owner lifted it on 2026-09-05. The
sentence must be amended in the todo in this change — a written instruction that is silently
contradicted by a commit is how the stale-claim pattern starts.

## 8. Risks

- **Over-denial is the primary risk, not under-denial.** C2's `$`-unverifiable branch and
  S4's narrow-deny predicate are where it concentrates. Neither may ship on an estimated
  false-positive population.
- **Widening a detector without its consumers.** `_OUT_POS_SUFFIX` reaches ~15 sites and
  `_OUT_POS_SUFFIX_MERGE_CLAUSE` has two branches that must move together. This exact defect
  recurred twice inside one repair chain.
- **A silent fail-open from definition ordering** (§4.2). It leaves the suite green.
- **The masking interaction of §2.1** is now load-bearing knowledge: a deny is not evidence
  the intended check fired. Every new deny assertion carries its reason.
- **S1 can move the masking shape itself.** Adding `<` `>` to the closer class changes what
  `_OUT_POS_SUFFIX_MERGE_CLAUSE` captures, which changes what `:928`'s `$` test sees — the
  exact mechanism §2.1 rests on. Re-run the §2.1 attribution probe **immediately after S1**,
  not only at the end; if the attribution changes, the C1 test family (§2.1) has to be
  re-chosen before S2 is written.
- **Scale.** Six mechanism families in one branch. Staged commits keep each reviewable; the
  single generated corpus is what the fold buys and must not fragment.

## 9. Out of scope / expected residuals

Carry forward unchanged, and state them rather than let them be inferred as covered.

**Residual entries must distinguish two things a list renders identically.** "Excluded
because the construct can never be live" and "excluded because we do not handle it" read the
same in a bullet list, and only the first is safe. Label every entry below with which it is:

- **UNHANDLED** — backslash-split verbs (`e\as update`, `\gh pr merge`) and backslash-split
  flags (`--ad\min`): renderings hide escapes rather than unescaping them.
- **UNHANDLED** — arg-taking command-position wrappers (`timeout 30 …`, `sudo -u x …`),
  `npx`/`bunx`, absolute-path invocation, interpreter `-c` wrappers.
- **OUT OF SCOPE BY DESIGN** — `gh` namespaces beyond `pr`/`release`/`repo`/`api`; `eas`
  namespaces beyond `update`/`build`/`channel`/`branch`; `migrate:images-r2` and
  `backfill:recipe-images`.
- **UNHANDLED, NEW** — flag _synthesis_ (as opposed to flag-text donation), e.g.
  `${x:-$(printf -- --repo)}`. The narrow-deny predicate targets verbs; the analogous flag
  case is a residual this change creates and must therefore document rather than inherit.
- **NEVER LIVE** — `${#x}`-glued forms. `${#x}` always yields a digit string, so
  `gh pr ${#x}merge` runs `0merge` and is not an invocation at all. It is excluded from the
  vanish allow-list because including it would _manufacture_ a false match, not because the
  walk cannot reach it. Nothing is missed here, and the entry must say so — a reader who
  reads this as an unhandled gap will "fix" it straight back into the 2026-09-02 regression.

## 10. Open question for implementation

Where exactly the narrow-deny predicate draws "already smells outward-facing" (§4.6). The
ruling states this is engineering work it does not settle. The predicate must be designed
against the measured false-positive population, not chosen first and validated after.
