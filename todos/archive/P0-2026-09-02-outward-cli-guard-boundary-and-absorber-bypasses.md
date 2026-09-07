---
title: "guard-outward-cli.sh: four confirmed live bypasses from boundary-class and redirect-absorber gaps"
status: done
priority: critical
created: 2026-09-02
updated: 2026-09-06
assignee:
labels: [security, harness]
github_issue:
---

# Four confirmed live bypasses of the outward-CLI guard, all boundary/absorber gaps

## Summary

> **CLOSED 2026-09-06.** All four findings are fixed on branch
> `todo/P0-2026-09-05-outward-cli-guard-folded-repair`, which folds this todo with the two
> sibling decision todos into one change under one generated corpus. See **Updates →
> 2026-09-06** at the bottom of this file for the per-finding disposition, the measured
> counts, and the three claims in this file that had to be RETRACTED.

`.claude/hooks/guard-outward-cli.sh` silently **ALLOWS** real invocations of gated
outward-facing CLIs through four distinct static-text gaps. All four were constructed and
executed against the live hook on `main` during the PR #910 review wave (2026-09-02); none
is hypothetical.

> **RETRACTED 2026-09-06 — the sentence above originally ended "…and none appears in the
> guard's own `DOCUMENTED RESIDUALS` section." That was false for two of the four.**
> Verified by direct read of `main`'s own copy of the file, not from memory:
> `git show main:.claude/hooks/guard-outward-cli.sh` line 227 already carried
> _"A verb GLUED TO A REDIRECT, no space required, on EITHER side"_ with explicit
> `trailing:` (finding A) and `leading:` (finding B) sub-bullets. Only C1 and C2 were
> genuinely undocumented. The claim is struck rather than deleted, per this repo's
> `a-retracted-claim-survives-in-every-artifact-you-did-not-grep-2026-09-03.md`.
> The general lesson, now recorded in memory: **"this is new/undocumented" is itself a
> structural claim** and must be grepped before it is written.

The four share one fix shape — widen a boundary character class, or absorb a redirect — so
they belong in one pass. The structurally different fifth finding (verb synthesis via
expansion) is deliberately **not** here; it needs a scope decision and lives in
`todos/P0-2026-09-02-outward-cli-guard-command-position-expansion-decision.md`.

> **Working on this todo trips the guard's own heredoc-prose false positive**
> (`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`). Merely _writing this
> file_ was denied twice — once by the PR-merge check and once by the cross-repo `--repo`
> check — because the reproduction strings appear in its text. `ALLOW_OUTWARD_CLI=1`
> bypasses only the single check that fired, so a body containing several trigger shapes
> needs a write path that does not route the content through a shell command string at all.
> Expect this when quoting these constructions in commits, PR bodies, or heredocs.

## Background

`guard-outward-cli.sh` is the PreToolUse gate that stops an agent invoking outward-facing
CLIs unattended. This repo has a real incident on record from exactly this class — an
accidental OTA publish caused by an agent executing a PATH-resolved outward-facing CLI
(`project_ota_accidental_publish_2026_08_16`). A silent ALLOW here is therefore treated as
critical, not theoretical.

All findings below meet this repo's construct-and-run standard: every ALLOW/DENY quoted is
the hook's actual exit code (JSON built with `jq -nc --arg`, piped to the hook exactly as
`test-guard-outward-cli.sh`'s own `run_hook` does), and every "real argv" claim was
ground-truthed via a PATH-stubbed binary printing its own argv. No real outward-facing CLI
was ever executed.

### C1 (CRITICAL) — default-value expansion defeats every boundary-guarded flag check

The boundary regex `(^|[^-A-Za-z0-9])--flag` requires the character immediately preceding
the flag text to be non-dash/letter/digit. Bash's **default-value** operators (`:-` and bare
`-`) consume exactly one `-` from the source and leave the rest of the word as the
expansion. So `${x:---admin}` places a literal `-` immediately before a real, two-dash
`--admin` in the raw command string — defeating the boundary check while argv genuinely
carries `--admin`.

The defect is specific to the default-value operator family. `${x:+--admin}` and
`${x:=--admin}` correctly DENY, because `+` and `=` pass the boundary class. That contrast
isolates the root cause rather than leaving it a regex-reading guess.

Verified matrix (all run against the real hook; `PRMERGE` = the command-position PR-merge
invocation, `EASBUILD` = the EAS build invocation, written as placeholders here only so this
file can be handled by tooling that inspects command strings):

| construction                                     | real argv (verified via stub) | hook      |
| ------------------------------------------------ | ----------------------------- | --------- |
| `PRMERGE 42 --auto --admin` (baseline, literal)  | `--admin` present             | DENY      |
| `PRMERGE 42 --auto ${x:---admin}` (x unset)      | `--admin` present             | **ALLOW** |
| `PRMERGE 42 --auto ${x---admin}` (no-colon form) | `--admin` present             | **ALLOW** |
| `PRMERGE 42 --auto ${x:+--admin}` (x set)        | `--admin` present             | DENY      |
| `PRMERGE 42 --auto ${x:=--admin}`                | `--admin` present             | DENY      |
| `EASBUILD ${x:---auto-submit}`                   | `--auto-submit` present       | **ALLOW** |
| `PRCOMMENT 5 --body hi ${x:---repo} other/org`   | `--repo other/org` present    | **ALLOW** |

Impact: a real administrator-override merge (bypasses branch-protection required checks —
the exact thing the carve-out near `guard-outward-cli.sh:82` exists to prevent), a real
app-store submission, and a real cross-repo `--repo` egress with the PAT all receive a
silent ALLOW.

> **RETRACTED 2026-09-06 — the administrator-override third of that Impact sentence is
> FALSE, and so are the three `PRMERGE` rows of the matrix above.** They are kept verbatim
> as the historical record; the correction is here.
>
> `gh pr merge 42 --auto ${x:---admin}` DENIES on `main` and always did — but for an
> unrelated reason. Attribution measured live (2026-09-05, re-measured 2026-09-06),
> exactly the technique this file's own preamble demands:
>
> | command                                                           | verdict | reason                                             |
> | ----------------------------------------------------------------- | ------- | -------------------------------------------------- |
> | `gh pr merge 42 --auto --admin` (literal)                         | DENY    | `'gh pr merge --admin' uses administrator privil…` |
> | `gh pr merge 42 --auto ${x:---admin}`                             | DENY    | `'gh pr merge' without a REAL --auto flag…`        |
> | `gh pr merge 42 --auto ${x:-hello}` **[control, no flag at all]** | DENY    | `'gh pr merge' without a REAL --auto flag…`        |
> | `gh pr merge 42 --auto $HOME` **[control, no flag at all]**       | DENY    | `'gh pr merge' without a REAL --auto flag…`        |
>
> The two controls carry no `--admin` text whatsoever and produce the **identical** reason,
> while the literal baseline produces a **different** one. So the deny comes from the
> coarse `grep -qF '$'` on the merge clause (any `$` ⇒ `--auto` unverifiable), not from the
> `--admin` boundary check the finding is about. **A DENY is not evidence the intended
> check fired.**
>
> Two consequences, both acted on:
>
> 1. `--admin` via a default-value expansion was **never a live bypass**. Fixing the
>    boundary was still correct — uniformity across the three sites, and the masking guard
>    is coarse enough that a future narrowing would expose it — but it is defence in depth,
>    not closure of an open hole. The other two thirds of the sentence (`eas build
--auto-submit`, `gh pr create/comment --repo`) were genuinely live and are genuinely
>    closed.
> 2. **No C1 regression test may use the `gh pr merge` family** — such a test passes on the
>    unfixed tree and pins nothing. C1's assertions therefore live on `eas build
--auto-submit` and `gh pr create|comment --repo/-R`, which have no masking guard.
>    The corpus row `c1-threedash` was corrected for the same reason (commit `eca7cc3`,
>    and `NOTE5` in `repro-outward-cli-corpus.sh`).

Control: the literal three-dash form (no expansion) produces a _different_ argv token and is
not itself a bypass — confirming this is an expansion-driven defeat, not a misread regex.

### C2 (CRITICAL) — default-value expansion on a flag's VALUE defeats the method check

`gh api repos/o/r -X ${x:-POST}` (x unset) yields real argv `[-X, POST]`. The literal `-X`
is present and correctly located, but the mutating-method check requires the literal string
`POST`/`PUT`/`PATCH`/`DELETE` immediately after it, and the expansion is not that literal
text. Result: **ALLOW**, versus a correct DENY for the spaced literal `-X POST`.

### A (HIGH) — `_OUT_POS_SUFFIX` lacks `<` and `>` as closers

Redirect operators tokenize regardless of adjacent whitespace, so a verb glued directly to a
trailing redirect is a genuine invocation the suffix class does not close. Silent **ALLOW**
at all five `_OUT_POS_SUFFIX`-gated verb families: the PR-merge, EAS update, npm publish,
railway up, and EAS build `--auto-submit` forms, each with the redirect glued directly to
the verb with no intervening space (e.g. the update verb immediately followed by
`>/dev/null`, or the merge verb immediately followed by `</dev/null`).

The spaced form correctly DENIES — the gap is specifically the no-space glue.

### B (HIGH) — `_OUT_POS_PREFIX` lacks the shared lib's `_CMD_REDIR` absorption

A leading redirect before the verb is not absorbed, so the position anchor never matches.
Silent **ALLOW** at all five sites — each of the same five verb families prefixed with
`2>/dev/null ` or `>/dev/null `.

### Verified NON-findings (do not re-investigate)

Constructed, executed, and confirmed **correctly denied** — recorded so this ground is not
re-covered: ANSI-C quoting, locale quoting, backslash-newline continuation mid-verb, and tab
separators (the literal substring survives `cmd_bare` / `cmd_words` normalisation).
Vertical-tab control bytes are **not** default-IFS separators — a verb split by them
collapses into a single non-existent command name, so that dimension yields no exploitable
construction at all, independent of the guard.

## Acceptance Criteria

- [ ] Each of C1, C2, A, B is **reproduced first** against unmodified `main` — construct the
      input, run the hook, record its actual exit code. If any does not reproduce, that is a
      finding: report it instead of fixing something that is not broken.
- [ ] C1 fixed: the boundary class no longer treats a `-` contributed by a default-value
      expansion operator as a legitimate preceding character, for every `scan_renderings` (named `scan_both` at the time)
      boundary-guarded flag check — not only the administrator-override one.
- [ ] C2 fixed: the `gh api` method check is not defeated by an expansion standing in for
      the literal method token.
- [ ] A fixed: `_OUT_POS_SUFFIX` closes on `<` and `>`.
- [ ] B fixed: `_OUT_POS_PREFIX` absorbs a leading redirect, matching the shared lib's
      `_CMD_REDIR` handling.
- [ ] Every fix carries a **two-sided** regression test in
      `.claude/hooks/test-guard-outward-cli.sh`: a positive that fails without the fix, and a
      negative control that would catch over-matching. A control that stays green under
      mutation is not a control.
- [ ] **Mutation-tested**: for each new assertion, revert/stub its fix, confirm the assertion
      FAILS, restore, confirm it passes. Quote before/after counts with the corpus.
- [ ] **False-positive direction checked by execution**: a "decline to act" branch is only
      safe for inputs the OLD code did not act on — run the old code to learn that set.
      Confirm everyday idioms stay allowed, at minimum `mkdir -p dir/{a,b,c}`,
      `cp file.txt{,.bak}`, `eslint --fix 'client/src/*.{ts,tsx}'`, `for i in {1..3}`, and
      ordinary redirect use that does not front a gated verb.
- [ ] Full `.claude/hooks/test-guard-outward-cli.sh` and `scripts/run-hook-tests.sh` pass;
      real counts quoted.
- [ ] The guard's `DOCUMENTED RESIDUALS` section reflects what is now closed and what
      remains — append/amend, never silently delete a prior claim.

## Implementation Notes

- Fix **C1 first** — highest impact, most contained. The isolation work is already done:
  `:+` and `:=` pass the boundary class and correctly deny, so the fix targets the
  default-value operator family specifically.
- A and B are the smallest changes and should reuse the shared lib's existing `_CMD_REDIR`
  construct rather than a second hand-rolled redirect pattern. A hand-rolled copy diverging
  from the shared one is exactly how `GH_API_CLAUSE` came to be missed.
- **Widen the detector AND its consumers in the same change.** PR #910 widened
  `_OUT_POS_SUFFIX` but left `GH_API_CLAUSE`'s hardcoded-space cut behind, so the occurrence
  counter entered the branch while clause extraction returned empty and the deny never
  fired — this repo's own
  `docs/solutions/logic-errors/occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md`
  pattern. Enumerate every consumer of any class you widen.
- Corpus must be **generated from dimensions** (verb family x glue mechanism x flag
  sub-check x precise/no-jq path), not hand-listed. A cross product picks one value per axis,
  so a guard firing only on CO-OCCURRENCE goes unreached and passes by agreeing — construct
  co-occurrence cases deliberately.
- Check the **degraded paths too**. These four were not separately confirmed against the
  fail-closed fallbacks, and the sibling expansion finding showed the no-`jq` path can fail
  open for a related mechanism. Do not assume the fallbacks cover you.
- Never execute a real outward-facing CLI. Use argv-printing stubs on `PATH`; shadow a binary
  rather than stripping `PATH`.

## Scope Contract

- **Mechanisms to use:** widen existing boundary character classes; reuse the shared lib's
  existing `_CMD_REDIR` absorber. No new parsing layer, no expansion evaluation, no new
  dependency.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, and `.claude/hooks/lib/cmd-detect.sh` only if
  the shared absorber genuinely needs to change.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Coordinate with PR #910 and its `GH_API_CLAUSE` repair — both touch
  `guard-outward-cli.sh` and `test-guard-outward-cli.sh`. Land #910 first, then rebase.
- Independent of the command-position expansion decision todo; that one is structural and may
  never land.

## Risks

- **Over-denial is the real risk here, not under-denial.** Widening a boundary class can
  block legitimate commands. This repo has been burned: one unverified "the old code did not
  act on this" sentence cost 144 real denies. Run the old code to learn its acting set.
- C1's fix touches the shared boundary construct used by _every_ flag check, so its blast
  radius is wider than the other three. Give it the largest corpus.

  > **CORRECTED 2026-09-06 — "every flag check" is wrong, and the blast radius is
  > SMALLER than this paragraph claims.** Counted in the implemented tree, not estimated:
  > the shared constant `_OUT_FLAG_LEAD` feeds **3** consumer sites —
  > `_OUT_REPO_FLAG_RE`, the `eas build --auto-submit` scan, and the `gh pr merge --admin`
  > scan — out of **6** `scan_renderings` (named `scan_both` at the time) callers in the file. The other flag checks keep their
  > own boundary text and were not touched.
  >
  > The instruction that followed ("give it the largest corpus") was still followed, so the
  > correction changes the justification, not the work: C1 carries per-form coverage for
  > every bash PARAM shape that can precede `:-`/bare `-`, each paired with a three-dash
  > negative control (`c1-*`, `c1g-*` rows).

## Updates

### 2026-09-02

- Filed at the user's request after the PR #910 review wave. C1/C2 found by
  `security-auditor`; A/B originally surfaced by the `cmd-pos-anchor-widening-stale-comments`
  executor and independently reproduced by `security-auditor` against current `main`.
- Audit corpus: ~80 constructed variants executed end-to-end against the real hook on both
  `main` and the PR branch. Reproduction fixtures (guard copies with correct relative `lib/`
  layout, plus argv-printing stubs) lived in a session scratchpad and are NOT durable —
  regenerate them from the constructions described above.

## Additional findings (added 2026-09-02, after this todo was first written)

### Split out: the vanishing-sigil gap is NOT in this todo

A sixth bypass — a bash sigil that expands to nothing (unset `$VAR`, empty `$(...)` or
`${...}`) not being treated as a command-position boundary — was found during the
`GH_API_CLAUSE` repair on PR #910, after this todo was first written. It looked like a
sibling of A and B, but it is not: the suffix side is a one-character class widening, while
the prefix side needs a **new regex alternative** (bash consumes the whole balanced sigil, so
there is no single boundary byte to add). That asymmetry makes it a scope decision rather
than a mechanical fix.

It now lives in
`todos/P0-2026-09-02-outward-cli-guard-vanishing-sigil-boundary-decision.md` (`human_led`).

**Do not fix the suffix side as part of this todo.** Shipping the cheap half alone would
produce exactly the overclaiming-by-implication defect the PR #910 repair chain existed to
correct — a guard that looks closed on the side people test. If your work here touches
`_OUT_POS_SUFFIX`, leave the empty-expansion case alone and let the decision todo own both
sides.

> **FENCE LIFTED by the repository owner, 2026-09-05.** The three todos were folded into
> one branch and one corpus, at which point the fence's own condition was satisfied rather
> than violated: it existed to stop the cheap half shipping ALONE, and both halves now ship
> together. The suffix side is closed by the closer-class widening; the prefix and
> mid-token sides are closed by `cmd_words_vanished`, a new rendering in
> `lib/cmd-detect.sh` that deletes every construct provably capable of expanding to empty
> so a split verb rejoins. All three positions are covered, which is what the sigil
> decision todo ruled (option (a), 2026-09-03).

### Severity note on finding A, strengthened 2026-09-02

Round 3 of the PR #910 repair re-verified finding A (`_OUT_POS_SUFFIX` missing `<`/`>`) and
found it is worse than first recorded: against the merge clause specifically it is a **total
detection failure**, not a partial gap. Treat A as CRITICAL rather than HIGH when sequencing
this work.

### Two more live bypasses were found and ALREADY FIXED on PR #910 — do not re-file them

Recorded here only so a future reader does not mistake them for open items:

1. A swallowing clause-cut in the `gh pr merge --auto` carve-out produced a working FALSE
   ALLOW in the zero-argument case (found and fixed in round 3 of the repair).
2. That round-3 fix was itself **incomplete** — the argument-present case reopened the
   identical swallow for `)` and backtick (live bypasses) and for `{`/`}` (conservative, not
   live). Fixed in round 5 by widening branch 1 to match branch 2's boundary set exactly,
   after a full 16-shape `{zero-arg, arg-present} x {;, &, |, ), backtick, {, }, EOS}` sweep
   before and after. Mutation: 268/268 → 264 passed/4 failed on revert (exactly the 4 new
   assertions) → restored to 268/268.

The lesson worth carrying into this todo's own work: **a fix to one branch of a two-branch
boundary check must be applied to both branches in the same change.** Round 3 fixed one and
left the other, and round 5 had to find it. That is the same
`occurrence-ambiguity-guard-applied-selectively-not-uniformly` shape already cited in the
Implementation Notes above — it recurred twice inside a single repair chain.

### 2026-09-06 — CLOSED

Implemented on `todo/P0-2026-09-05-outward-cli-guard-folded-repair`, which folds this todo
with `…-vanishing-sigil-boundary-decision` and `…-command-position-expansion-decision` into
one branch under one generated corpus (`.claude/hooks/repro-outward-cli-corpus.sh` — the
durable replacement for the scratchpad fixtures the Updates entry above records as lost).

**Per-finding disposition.** Every AC's "reproduce first" requirement was met: each row was
measured on the unmodified tree before its fix was written, and each fix was mutation-tested
by reverting it and confirming the named assertions fail.

| Finding                                              | Disposition                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 — default-value expansion donates a flag boundary | **Fixed.** `_OUT_FLAG_LEAD`, routed to its 3 consumer sites. Live for `eas build --auto-submit` and `gh pr create/comment --repo`; **never live** for `--admin` (see the RETRACTED note above). |
| C2 — expansion defeats the `gh api` method check     | **Fixed** — an unreadable method denies. One spelling remains open: ANSI-C hex, see below.                                                                                                      |
| A — `_OUT_POS_SUFFIX` lacks `<`/`>`                  | **Fixed** on both anchors and both branches of the merge clause, with one disclosed accepted over-denial.                                                                                       |
| B — `_OUT_POS_PREFIX` lacks `_CMD_REDIR` absorption  | **Fixed** by reference to the lib's construct, which required relocating the anchor definitions below the lib source.                                                                           |

**Also closed here, from the two folded decision todos:** the vanishing-sigil class at the
suffix / prefix / mid-token positions **of the VERB** via the new `cmd_words_vanished`
rendering, and the narrow-deny rule for a synthesized verb on both the precise and degraded
paths.

> **CORRECTED 2026-09-06 — this paragraph originally read "the vanishing-sigil class at all
> three positions", which was false.** The security review of PR #926 established that the
> class has a TOOL position and a FLAG position too, and both were open: `e${UNSET}as update
--branch preview` (an OTA publish to real users) was ALLOWED on all four execution paths,
> and `--re${UNSET}po` / ``--ad`​`min`` defeated the `--repo` and `--admin` checks. Four
> CRITICALs, none a regression — all pre-existing gaps this PR claimed to have closed. The
> claim was made from a corpus whose glue axis varied the sigil MECHANISM while holding the
> POSITION fixed at the verb, so it could not have seen them. Fixed on this same branch; the
> corpus now generates the position axis (`rows=125 → 163`), the guard suite is
> `435 passed, 0 failed`, and both "closes the class" comments in the hook and the lib are
> reworded to say what they actually establish. "Three positions" was never the whole class —
> counting the positions someone happened to test is not the same as enumerating them.

**Measured counts** (real, quoted from the runs — not estimates):

- `.claude/hooks/test-guard-outward-cli.sh`: `280` (spec baseline) → **`414 passed, 0 failed`**
- `.claude/hooks/test-cmd-detect.sh`: **`492 passed, 0 failed`**
- `scripts/run-hook-tests.sh`: **`24 passed, 0 failed`; `✓ 34 hook self-tests passed`**
- `repro-outward-cli-corpus.sh`: `rows=125`, precise-path gaps **`32 → 3`**, all-path
  **`52 → 23`**. Both "before" numbers are the same 125-row corpus measured at the start of
  the final work session (with the C1/C2/A/B fixes already committed but the sigil and
  narrow-deny work not yet), so they are a like-for-like before/after of Tasks 7–9, **not**
  a comparison against `main` — the corpus did not exist on `main`.

**The remaining `gaps=3` is deliberate and is the corpus's correct output**, not unfinished
work. Each is a real, reachable bypass that is out of this repair's Scope Contract, and each
keeps its `DENY` expectation so it stays visible — flipping a reachable-but-unfixed row to
match current behaviour would encode the bypass as acceptable. They are:

- `nssufx-ghmerge` / `nssufx-ghcomment` — an **interior redirect**, glued where the anchors
  require whitespace between two words (`gh pr>/dev/null merge 42`, which real bash tokenizes
  to a genuine merge). A _separator_ problem, not a _boundary_ problem, so no character-class
  widening reaches it; it needs one interior absorber applied uniformly.

  > **SCOPE CORRECTED 2026-09-06, and it is much wider than these two rows.** This entry
  > first described the gap as specific to the namespace word before a multi-word `gh pr`
  > verb. That was read off the two corpus rows that happened to exist, before any
  > cross-family measurement, and it **understated the finding**. Measured against the live
  > hook, the same glue defeats **every gated family**, including single-word-verb families
  > via the tool→verb position: `eas>/dev/null update` (this repo's own OTA-incident command
  > class), `npm>/dev/null publish`, `railway>/dev/null up`, `gh>/dev/null api … -X POST`,
  > plus `gh release`, `gh repo`, `railway variable set` and `railway service delete`. Every
  > spaced baseline denies, so each is a **total detection failure** — no check runs at all,
  > which is why even the `--repo` egress check is skipped.
  >
  > **Do not read the corpus gap count as this gap's size**; the two rows cover two of ten
  > measured families. Now tracked as its own `critical` todo:
  > `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md`, with
  > the full matrix. Also written up in
  > `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`.

- `c2-ansic-hex` — an **ANSI-C hex method value** (`-X $'\x50\x4f\x53\x54'`). Measured cause:
  the shared word-splitting renders it `-X xx50xx4fxx53xx54`, so C2's "not literal text"
  branch sees no surviving sigil and the literal branch sees no `POST`. Needs an escape
  decoder — a new parsing layer the Scope Contract forbids. Tracked as
  `todos/archive/P2-2026-09-06-outward-cli-guard-ansic-escape-method-value.md`.

Neither was patched into this branch: each needs its own false-positive review, and the
interior-redirect one has the widest blast radius of any change yet made to this file.

**False-positive measurement**, required by the narrow-deny ruling and forbidden from being
estimated: 17,913 unique historical Bash commands were harvested from this project's
transcripts; the 4,525 containing a `$` or backtick (the only ones the new predicate can
match) were run against both the pre-change and post-change hooks — **0 decision flips**.
The harness was validated against a known flip first. Reported honestly as evidence about
the construct's _frequency_: a raw-text census found the shape essentially absent from real
work (3 of 4 raw matches are this repo's own prior probe artifacts or prose; the one real
command's match sits inside a quoted argument that `cmd_words` blanks).
