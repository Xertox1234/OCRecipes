# Outward-CLI Guard — subtractive-rendering repair (PR #926 review fallout)

- **Date:** 2026-09-06
- **Status:** **COMPLETE 2026-09-06.** All four CRITICALs and all five WARNINGs fixed on this
  branch (`8d7db56` = the CRITICALs, `708edd2d` = the WARNINGs), pushed, PR body rewritten.
  Suite 414 → 438, cmd-detect 492 → 496, corpus rows 125 → 163 with precise-path gap IDs
  byte-identical, 4,525-command FP sweep with 0 flips on a validated harness, all four
  execution paths verified. Two NEW residuals were found while fixing and are documented in
  the guard's own DOCUMENTED RESIDUALS block (a read-only `gh api -X GET` over-denial behind a
  leading expansion; the `--ad${UNSET}min` attribution residual). Two deviations from §7 below,
  both deliberate and recorded in-line: C1 needed a degraded-path half the plan did not
  anticipate, and C2 was NOT fixed by the union rule.
- **Branch:** `todo/P0-2026-09-05-outward-cli-guard-folded-repair` @ `e2b086e1`
- **PR:** #926 (open, all 10 CI checks green at `a06cf394`; blocked on this review)
- **Decision:** repository owner chose **option A — fix all four CRITICALs on this branch**
  rather than landing and filing follow-ups (2026-09-06).

> **This file is gitignored** (`.gitignore:100` → `docs/superpowers/`). The binding record is
> the tracked todos and the guard's own comments. Anything here that must survive has to be
> written into those before the work is called done.

## 1. Why this exists

`/code-review` on PR #926 dispatched `code-reviewer` + `security-auditor` per
`docs/AI_WORKFLOW.md` → Review Policy. The security reviewer returned **4 CRITICALs**.
**Every one was independently re-verified by execution** in the orchestrator session under
`bash 3.2.57`, with paired controls, before being accepted — do not re-litigate whether they
reproduce; they do.

**None is a regression.** A `main`-version fixture was built
(`git show main:.claude/hooks/{guard-outward-cli.sh,lib/cmd-detect.sh}`) and all seven probe
constructions ALLOW on `main` too. These are pre-existing gaps that PR #926 _claims to have
closed_. That is the reason they block: shipping the claim is the overclaiming-by-implication
defect the whole repair chain exists to correct.

## 2. The single root cause

**`cmd_words_vanished` is a SUBTRACTIVE rendering, and PR #926 reused an ADDITIVE
rendering's safety argument on it.**

The guard repeats, three times, a monotonicity argument: _"this check is deny-shaped, so a
wider rendering can only ever ADD a deny."_ That is true of `cmd_words_deep`, which
**appends** substitution bodies. It is **false** of `cmd_words_vanished`, which **deletes**
spans: any check whose trigger is the **PRESENCE** of a token (`$`, a backtick, `--repo`,
`--admin`, `--auto-submit`, a literal HTTP method) is **disarmed** by deletion.

**The rule that fixes C2, C3 and C4 as one class:**

> A subtractive rendering must be **UNIONED IN**, never **SUBSTITUTED FOR**, the deep
> rendering. Evaluate presence-triggered checks against **both** clauses and OR the results.

C1 is a different mechanism (a prefilter that runs before the rendering exists) but the same
discipline gap: a new rendering was added and its gating prefilter was never re-audited.

## 3. The four CRITICALs, with verified reproductions

Feed TEXT to the hook; never execute an outward CLI:

```
jq -cn --arg cmd '<construction>' '{tool_name:"Bash",tool_input:{command:$cmd}}' \
  | bash .claude/hooks/guard-outward-cli.sh
```

### C1 — a sigil inside the TOOL name defeats everything, on all four paths

| construction                          | verdict   | real argv                             |
| ------------------------------------- | --------- | ------------------------------------- |
| `e${UNSET}as update --branch preview` | **ALLOW** | `eas update …` — an OTA to real users |
| `n${UNSET}pm publish`                 | **ALLOW** | `npm publish`                         |
| `g${UNSET}h pr merge 42`              | **ALLOW** | `gh pr merge 42`                      |
| `g${UNSET}h api repos/o/r -X POST`    | **ALLOW** | mutating REST call                    |

**Attribution control (this is what isolates it):**
`cd gh-notes && e${UNSET}as update --branch preview` → **DENY** with the
`eas update/publish/submit` reason. The only difference is an unrelated literal `gh`
substring restoring the fast-path needle.

**Cause.** `guard-outward-cli.sh:752-763` calls `cmd_fastpath_has "$CMD" '*eas*' '*railway*'
'*npm*' '*yarn*' '*gh*'` and takes `|| exit 0` on a miss. `cmd_fastpath_has`
(`lib/fastpath-filter.sh:53-67`) stage 2 strips only the five CHARACTERS `' " \ NL $`, so
`e${UNSET}as` reduces to `e{UNSET}as` — still no `eas` needle. The hook exits **before
`cmd_words_vanished` is ever called**. The whole mid-token machinery sits behind a gate that
exits first.

**This is a documented lesson recurring verbatim.** `lib/fastpath-filter.sh:24-31` states the
invariant in its own header: _"cmd_words only ever deletes those characters or inserts the
placeholder letter `x` … so stage 2 is a superset of what cmd_words can produce BY
CONSTRUCTION, not by assumption — re-verify this claim whenever cmd_words' character set
changes"_, citing
`docs/solutions/conventions/dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md`.
PR #926 added a rendering that deletes **whole spans**, so stage 2 is no longer a superset,
and the re-audit the header demands was not performed.

**Fix (guard-local, in scope).** At `:752-763`, do not take the `exit 0` when `$CMD` contains
`${`, `$(` or a backtick. Cheap, monotone toward deny, touches none of the other six hooks.
Do **not** extend `cmd_fastpath_has` stage 2 to delete spans — that puts real parsing work on
every Bash call in seven hooks, which the helper's own header explicitly refuses on measured
performance grounds (~1450 ms vs ~5.5 ms on a 3 KB command).

### C2 — the vanished `GH_API_CLAUSE` fallback deletes the evidence C2 keys on

| construction                                 | verdict   |
| -------------------------------------------- | --------- |
| `gh a${UNSET}pi repos/o/r -X ${METHOD}`      | **ALLOW** |
| `gh a${UNSET}pi repos/o/r -X $(printf POST)` | **ALLOW** |

**Controls proving it is the combination, not either half:**

- `gh api repos/o/r -X ${METHOD}` → DENY (`with a method flag` — C2 works when the clause keeps its sigil)
- `gh a${UNSET}pi repos/o/r -X POST` → DENY (`mutating HTTP method` — the vanished cut itself works)

**Cause.** `guard-outward-cli.sh:~1533` retries the clause cut on `$WORDS_VANISHED` when the
deep cut is empty. That rendering also deletes `${METHOD}`, so the C2 "method value is not
literal text" check at `:~1608` finds no surviving `$`/backtick, and the literal branch finds
no `POST`. The comment at `:1529-1532` justifying it — _"Safe because this clause is
DENY-shaped — over-capture can only ever ADD a deny, the same argument the WORDS_DEEP cut
above already rests on"_ — **is the invalid transfer described in §2**.

**Fix.** Run C2 against the deep clause **and** the vanished clause and OR the results.

### C3 — `[ -z "$clause" ]` gating makes both vanished fallbacks empty-only

| construction                                               | verdict   | real argv                                 |
| ---------------------------------------------------------- | --------- | ----------------------------------------- |
| `gh pr comment 5 --body hi --re${UNSET}po other/org`       | **ALLOW** | `--repo other/org` — unbounded PAT egress |
| `gh pr create --title x --body y --re${UNSET}po other/org` | **ALLOW** | same                                      |
| `gh api repos/o/r -${UNSET}X POST`                         | **ALLOW** | `-X POST`                                 |
| `gh api repos/o/r --met${UNSET}hod POST`                   | **ALLOW** | same                                      |

Control: `gh pr comment 5 --body hi --repo other/org` → DENY.

**Cause.** Both new fallbacks (`gh_pr_clause_has_repo` at `:581-583`, `GH_API_CLAUSE` at
`:1533`) are gated `if [ -z "$clause" ]`. When the VERB is literal the deep cut is non-empty,
so the fallback is skipped — even though `$WORDS_VANISHED` for these inputs is exactly
`gh pr comment 5 --body hi --repo other/org`. **The guard computes the answer and discards
it.**

**Fix.** Both consumers are deny-shaped: evaluate against both clauses (OR), not
"deep, else vanished".

### C4 — `--admin` split by an empty backtick pair GRANTS an administrator merge

| construction                               | verdict                                 | note                                                  |
| ------------------------------------------ | --------------------------------------- | ----------------------------------------------------- |
| `gh pr merge 42 --auto --ad``min`          | **ALLOW**                               | real argv `--auto --admin`                            |
| `gh pr merge 42 --auto --admin`            | DENY (`--admin` reason)                 | control                                               |
| `gh pr merge 42 --auto --ad${UNSET}min`    | DENY (**"without a REAL --auto flag"**) | the `--admin` check never fired here either — masking |
| `eas build --platform ios --auto-su``bmit` | **ALLOW**                               | store submission                                      |
| `gh pr merge 42 --auto -``R other/org`     | **ALLOW**                               | cross-repo                                            |

**This is an effective GRANT, not just a missed deny:** with no `--admin` deny, the `--auto`
carve-out proceeds on a merge that bypasses branch protection — contradicting the carve-out's
own stated premise at `:111-128`.

**Cause.** `scan_both` (`:975-976`) reads `$CMD` and `$WORDS` only. Neither contains
`--admin`, and the backtick spelling carries no `$`, so the CLAUSE `$`-mask at `:1346` does
not catch it either.

**Fix.** Wire the vanished rendering into `scan_both`'s deny-shaped consumers — union, per §2.
Note `scan_both` is otherwise untouched by this diff, so the `eas build` / `-R` rows are a
defensible "out of scope" pushback; the **`--admin` row is not**, because this PR is what
establishes `cmd_words_vanished` as the repo's answer to split tokens and leaves the
grant-adjacent consumer unwired.

## 4. WARNINGs to address in the same pass

1. **Corpus glue axis covers the VERB position only** (`repro-outward-cli-corpus.sh:88-101`,
   `:236-239`). No tool-position row, no flag-position row anywhere in the file. The
   reviewer's generated sweep — 272 rows from 13 families × 5 glue positions
   (none/tool/ns/verb/flag) × 7 provably-empty mechanisms — found **105 branch ALLOWs**.
   `NOTE6`'s "each remaining row is a REAL, reachable bypass" reads as exhaustive and is not.
   Add tool- and flag-position rows; there is also no `C2 × vanishing sigil` co-occurrence
   row, which is exactly finding C2.
2. **`EXPECTED_TOTAL=414` pin overclaims** (`test-guard-outward-cli.sh:~1467`). It catches a
   _deleted_ assertion but not a _terminated_ run: an early `exit 0` never reaches the pin,
   and `scripts/run-hook-tests.sh:27` (`bash "$t" || exit 1`) checks only the exit code.
   Verified: injected early exit → `EXIT CODE: 0`. The hole is pre-existing across all 34
   suites; the overclaiming comment is new here. Either narrow the comment or enforce it with
   an EXIT trap that asserts the pin ran — **note the file already registers a
   `trap … EXIT` for tempdir cleanup (~`:1707`), and a second `trap … EXIT` REPLACES it**, so
   the two must be combined and registered early.
3. **Degraded mirror over-denies wider than disclosed** (`:645`). The residual at `:438-445`
   documents `npm run test -- $ARGS`. Also measured: read-only calls (`gh pr view $NUM`,
   `eas update:list --branch $BRANCH`) and — the shape the disclosure does not cover — a
   command invoking **no gated CLI at all**: `sed -i "" "s/gh/$NEW/" docs/gh-actions.md`
   denies, because `/gh` in a filename satisfies `(^|[^a-zA-Z])gh`. Not blocking (degraded
   paths are rare); the residual text should describe the substring-of-an-unrelated-path case.
4. **`test-cmd-detect.sh`** has no pin for 4 of the 8 documented deletable forms
   (`${name:+}`, `${name+}`, `${name:=}`, `${name=}`). All four verified working today, so
   this is regression-proofing, not a live bug.
5. **Two overstatements to correct** once fixed: `guard-outward-cli.sh:908-912` ("Closes the
   prefix and mid-token positions of the vanishing-sigil class") and
   `lib/cmd-detect.sh:626-632` — both false at the tool/binary token today.

## 5. Verification bar (non-negotiable — this guard's history demands it)

- **Reproduce each fix's target first** on the current tree; record the actual exit code.
- **Attribute every deny by its REASON string.** A DENY is not evidence the intended check
  fired — any `$` in a `gh pr merge` clause denies with "without a REAL --auto flag"
  regardless, which masked the `--admin` check in C4's own `${UNSET}` spelling.
- **Mutation-test per row, not in aggregate**: revert each fix, confirm the _named_ assertions
  fail, restore.
- **Measure the false-positive population by execution.** C1's fix widens what reaches the
  precise matcher for every command containing `${`/`$(`/backtick — a large share of real
  commands. Harvest historical commands (see §6) and diff decisions main-vs-branch. Validate
  the harness against a known flip before trusting a zero.
- **Re-check all four degraded paths** (precise / no-jq / no-lib / no-awk). C1 currently
  ALLOWs on all four.
- **Generate the corpus combinatorially** from dimensions (family × glue POSITION × mechanism
  × path), not hand-listed. The reviewer's 5-position × 7-mechanism grid is the shape to
  adopt.
- Never execute an outward CLI, including `--help`. Feed text to the hook; use argv-printing
  PATH stubs if real argv must be proven.

## 6. Reusable assets on disk (session scratchpad — regenerate if wiped)

`/private/tmp/claude-501/-Users-williamtower-projects-OCRecipes/e4920bb1-b0ff-4e7e-bb26-5b8df940302a/scratchpad/`

- `verify-sec-criticals.sh` — reproduces all four CRITICALs with controls
- `FINDINGS.txt` — the security reviewer's own durable notes
- `mainhook/` — a `main`-version hook fixture for regression diffing
- `harvest.txt` (17,913 unique historical commands) / `harvest-expansion.txt` (4,525 with `$`/backtick)
- `fp-sweep.sh` — main-vs-branch decision diff over the harvest
- `probe-interior-redirect-scope.sh` — the cross-family measurement pattern

## 6a. ROUND 2 — the fix's own fix (2026-09-06, re-review)

`security-auditor` + `code-reviewer` re-reviewed the two fix commits. Security returned a
**CRITICAL against the C1 fix itself**, reproduced here with controls before acting:

- `e$(: $(:))as update --branch preview` (an OTA publish), `g$(: $(:))h pr merge 42`,
  `n$(: $(:))pm publish`, `rail$(: $(:))way up`, plus the quoted-closer spellings
  `g$(: "x)y")h pr merge 42` and `e$(: 'a)b')as update ...` — **ALLOW on all four paths**.
- Second, independent trigger: the fixed 200-iteration cap was a decision boundary —
  199 leading `${z}` spans DENIED, 200 ALLOWED.
- Isolating control: `gh p$(: $(:))r merge 42` mis-parses identically but DENIES, because its
  literal `gh` satisfies stage 1 so stage 3 never runs. That pins it to stage 3's `exit 0`.

Cause: `_out_crude_vanish` ends a span at the FIRST closer, so a closer _inside_ the span
(nesting or quoting) makes it delete a **wrong** span — a strict prefix — leaving a stray
closer wedged between the halves that were meant to fuse. My "deletes a SUPERSET, so it can
only over-pass" comment was false twice over: superset was wrong, and its supporting argument
reasoned about letters DESTROYED when the failure is letters that **fail to REJOIN** — a
needle no earlier stage can see because it never exists in raw text.

Fix: **decline, don't guess.** The scan reports `_OUT_CRUDE_EXACT`; stage 3 takes its cheap
exit only on an unambiguous parse. The cap is now derived from input length. Ambiguity is
"nested opener, backslash, or **ODD** quote count" — the first version flagged _any_ quote and
cost 88–145 ms against a ~15 ms baseline on ordinary commands; parity counting restores those.
Measured decline rate: 434 of 2,930 span-carrying commands (14%), ≈2.3% of all Bash calls.
The degraded paths cannot decline (they _are_ the last resort), so they get a GREEDY rendering
unioned in — and the no-jq path needed the JSON envelope trimmed first, because the envelope's
own trailing `"}}` was the last closer in the string.

From `code-reviewer`: **the C4 seam control was a decoration** — `gh pr merge 42 --auto --ad`
has no `min`, so collapsing the seam left it unchanged. Replaced with a mutation-verified one.
Plus a stale `gh_pr_clause_has_repo` summary line and a now-redundant conjunct, both addressed.

## 6b. Where this plan was WRONG (recorded 2026-09-06, after execution)

Two of §7's steps did not survive contact. Both are worth keeping, because both are the same
error the plan itself is about — reasoning about a mechanism instead of running it.

1. **C1 needed a DEGRADED half the plan never mentions.** §3's fix for C1 addresses only
   `guard-outward-cli.sh:752-763`, the precise path. But the finding's own table says "on all
   four paths", and the three degraded paths reach `crude_smells_outward`, whose mirror is
   CHARACTER-based and structurally cannot rejoin a span-split binary name. Measured after
   applying the plan's C1 fix verbatim: precise DENY, no-jq/no-lib/no-awk still **ALLOW**.
   Fixing only what the plan said would have shipped a precise-only fix under a "closes C1"
   claim — the exact overclaiming that made these four block. Needed `_out_crude_vanish`, a
   pure-parameter-expansion span deleter (the no-jq fixture links only bash/cat/grep).
2. **C2 is NOT fixed by the union rule.** §2 presents one rule closing C2, C3 and C4. It
   closes C3 and C4. It does **not** close C2: for `gh a${UNSET}pi repos/o/r -X ${METHOD}`,
   NEITHER rendering ever holds both halves of the evidence, so OR-ing them still ALLOWS.
   Verified after implementing the union: C3's two rows flipped to DENY, C2's did not. The
   actual resolution is structural — a clause existing ONLY in the vanished rendering is
   itself proof a span was deleted, hence unreadable. The plan's "one idea, three findings"
   framing was tidy and wrong; C2 shares the root CAUSE but not the FIX.

Also worth recording: the plan's C1 fix as written ("do not take the `exit 0`") was measured
at **8x** per-call cost on a hook that runs on every Bash call. Correct, and still the wrong
change. The plan's verification bar said to measure the FP population; it did not say to
measure LATENCY, and the fast path exists for nothing else.

3. **The plan's closure language is NARROWER than it reads (round 4, 2026-09-06).** §4.5 and
   §3 speak of closing "the vanishing-sigil class" at the suffix/prefix/mid-token positions.
   What the branch actually closes is that class **for the expansion forms on
   `cmd_words_vanished`'s allow-list** (`${name}` and variants, `$(…)`, backticks). Round 4
   measured three further spellings that vanish identically and are NOT on that allow-list —
   special parameters (`$!`, `$1`, `$@`, `$*`, `$?`, `$$`, `$#`), ANSI-C quoting (`$'\x61'`),
   and brace RANGE expansion (`{e..e}`). Measured: `e$!as update` and `{e..e}as update` ALLOW
   on **all four** paths; `eas up$!date` ALLOWs on precise while all three degraded paths
   DENY (the asymmetry INVERTS). All pre-existing, all allow on `main`, none closed here.
   56 corpus rows carry them with DENY expectations; the PR body states the narrowed claim.
   Note the allow-list's own criterion ("an expansion form must be PROVEN capable of
   evaluating to EMPTY before it may be deleted") already admits the first two families —
   the list is incomplete against its own rule, and the fix belongs in `lib/cmd-detect.sh`,
   not in another guard-local workaround. Brace range is a **second expansion mechanism**
   with no `$` at all, so it needs a narrow deny, not a rendering.

## 7. Ordering

1. **C1 first** — it gates everything else. While the fastpath exits early, no fix to C2/C3/C4
   is even reachable for a tool-split input, and any test written for them would pass or fail
   for the wrong reason.
2. C2 + C3 together (one union rule, two sites).
3. C4 (`scan_both`) — the grant-adjacent one; give it the largest control set.
4. Corpus rows for tool/flag positions + the `C2 × sigil` co-occurrence row.
5. WARNINGs 2–5.
6. Correct the two overstatements, update `NOTE6`, re-run everything, update the PR body.

## 8. Out of scope — do NOT patch into this branch

Both already filed, both verified still open, both with their own todos:

- `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md`
- `todos/P2-2026-09-06-outward-cli-guard-ansic-escape-method-value.md`

If a fix here happens to close one, that is a bonus to be **measured and reported**, not
assumed — and its todo must then be closed with evidence.
