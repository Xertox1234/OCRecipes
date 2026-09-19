---
title: "merge-review-guard.sh: an extractor MISS is indistinguishable from 'not a merge', so unparseable gh pr merge spellings are silently allowed"
status: backlog
priority: high
created: 2026-09-12
updated: 2026-09-17
assignee:
labels: [deferred, harness, security]
github_issue:
human_led: true
blocked_reason: "Needs ONE ruling an unattended run must not make: may the shared renderer in .claude/hooks/lib/cmd-detect.sh emit a backslash-escaped NON-WHITESPACE character as that character (closing the two-layer bypass), while escaped whitespace keeps the placeholder? The current behaviour is deliberate — the comment block ending 'the documented backslash residual' records that rendering an escaped space as whitespace SPLIT a word the shell had JOINED and manufactured an --auto token that GRANTED a merge carve-out, and states the rule: emitting more tokens than argv contains is fatal for a grant-shaped check. The narrowing adds no tokens, but `if (c == BS)` occurs 10 times in that file in arms that disagree (3 of them render the escape as literal whitespace), so this is a ruling about which renderer may change, not a one-line edit. The file is consumed by git-safety.sh, merge-review-guard.sh and guard-outward-cli.sh, and moves pins in a required check. Three prior attempts at this todo were withdrawn for exactly the pattern of closing one family and opening another. A human decides before anyone writes it."
---

# An extractor miss reaches the gate as "not a merge"

## Summary

`cmd_gh_pr_write_subcommand` signals "I could not parse this" and "there is no merge here"
with the **same empty string and rc 0** — only its explicit REFUSE carries rc 1. So
`merge-review-guard.sh`'s `[ "$SUB" = "merge" ] || exit 0` lets every rendering the shared
extractor cannot read through as a silent allow, before any risk classification.

**248 of a 537-row combinatorial corpus are a ground-truthed real merge that the gate
allows.** No bypass token required.

## Background

Found by `security-auditor` reviewing PR #941 (the merge review gate itself). A raw-token
predicate was attempted in that PR across three review rounds and **withdrawn** — see the
Prior Attempt section, which is the most important part of this todo.

This is **not a regression introduced by the gate**. `guard-outward-cli.sh` already allows
a path-qualified merge on `main`, and mechanism (b) below defeats the shared extractor at
`lib/cmd-detect.sh` as well, so both layers miss the same row. The gate is a new layer with
an incomplete edge, not a hole someone opened.

### The three mechanisms (each measured, none needing a bypass token)

Corpus: 13 binary renderings x 10 leading separators x 4 inter-token separators = **520
binary rows**, plus **17 prose rows** = 537 total. (The product alone is 520; an earlier
draft of this todo wrote `= 537` against the three dimensions, which does not multiply out
— the prose rows are the missing term.) Each binary row was ground-truthed by executing it
under a PATH containing only stubs, so "really invokes the binary" is measured rather than
assumed. Controls in the same run: a plain `gh pr merge 42 --squash` denied, `ls -la`
allowed, every row run under `env -u SKIP_MERGE_REVIEW`.

**The per-mechanism counts below OVERLAP and are not a partition** — 192 + 110 already
exceeds 248, because the corpus is a product and a single row can exhibit two mechanisms at
once (a glued `;` separator _and_ a redirect between binary and verb). Read each count as
"rows in which this mechanism is sufficient to cause the miss", not as a disjoint share of
the 248. Mechanism (c) was reported qualitatively — it allows on all four inter-token
separators for the quoted-substitution rendering — and no separate row count was recorded
for it; re-derive it from the corpus rather than inventing one.

- **(a) Glued shell metacharacter — 192 of the 248.** The token adjacent to the verb
  swallows the separator, so it is `echo x;gh`, `true&&gh`, `false||gh`, `echo x|gh`, `(gh`
  or `echo x &gh` — matching neither `gh` nor `*/gh`.
- **(b) A word between the binary and the verb — 110 of the 248.** A redirect hides the
  verb from an adjacency test: `gh 2>/dev/null pr merge 42 --squash` allows for **every**
  binary rendering including the plainest. This also defeats
  `lib/cmd-detect.sh`'s own `gh[[:space:]]+pr` needle, so it is a SHARED-LIBRARY defect.
  (Compare the already-known `git-safety.sh` `MUTATING_GIT_SEG_RE` gap, which models no
  redirect between `git` and its verb — same class.)
- **(c) Quoted substitution.** `"$(which gh)" pr merge 42 --squash` allows on all four
  inter-token separators: the token ends in a quote, so a paren test never fires, while
  `cmd_bare` blanks the span for the extractor.

The documented merge ritual itself carries the escape that makes (a)-(c) reachable:
`ALLOW_OUTWARD_CLI=1 gh 2>/dev/null pr merge 42 --squash` measured
`outward=allow merge-review=allow` with no record present.

## Prior Attempt — READ BEFORE WRITING CODE

Three rounds of a raw-token predicate in PR #941, each withdrawn. Every version closed the
family it was aimed at and **re-opened the opposite failure one layer up**:

| Version                           | Closed                        | Broke                                                              |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| token adjacent to verb, `=~ gh$`  | path-qualified, `\gh`, `g"h"` | denied `through`, `enough`                                         |
| single `if` on the regex          | —                             | a decoy `… pr merge <word>` clause masked a later real merge       |
| added `*'$'*`                     | `${gh_bin}`, `$gh_bin`        | denied `$var`, `$5`                                                |
| narrowed to `gh*` after stripping | `$var`, `$5`                  | still denied `git commit -m "docs: describe the gh pr merge gate"` |

**The binding constraint is the prose direction.** A merge gate that denies ordinary commit
messages has no per-command escape — `SKIP_MERGE_REVIEW` must be set in the shell that
launched the session — so it gets switched off, which costs more than the gap it closes.
It is also not theoretical: the live hook blocked a reviewer's own file write on the word
`through`, and blocked this session's own edit command twice.

### Candidate fix, measured but NOT validated against the suite or the required corpus

From the round-4 review, replica measured over the same 537 rows:
**real-merges-allowed 248 -> 0, prose-denied 4 -> 0.**

1. **Gate on an unquoted `pr merge` surviving `cmd_bare_deep "$CMD"`.** This is what
   removes the prose direction wholesale — a quoted `pr merge` does not survive, so the
   token scan never runs on a commit message. (Verified separately:
   `cmd_bare_deep 'git commit -m "fix highlight for pr merge"'` renders `git commit -m`.)
2. **Then scan every whitespace-separated token** of `$CMD` under `set -f`, not only the
   one adjacent to the verb.
3. **Normalise each token** with the existing quote/backslash deletion followed by
   `_bare=${_bare##*[\;\&\|\(\{]}`, and run the paren arm against the quote-stripped form
   so `gh)"` is reached.

Its own stated residual: `gh issue list && echo pr merge` denies under it — contrived, and
fails closed. Write that down in the code rather than rediscovering it.

## Acceptance Criteria

- [ ] All three mechanisms deny on a risk-classified PR with no review record: a glued metacharacter, a redirect between binary and verb, and a quoted substitution.
- [ ] The four prose rows currently pinned as ALLOW in `test-merge-review-guard.sh` (the `KNOWN GAP` / `prose must never be denied` block) stay allowed — converting the gap rows to deny rows is the point of the change; converting the prose rows is a regression.
- [ ] The pinned `KNOWN GAP` rows in `test-merge-review-guard.sh` are converted to deny rows in the same change (they are a tripwire and WILL fail when this lands — that is deliberate).
- [ ] Test rows are GENERATED from a separator x rendering product, not hand-listed. Hand-listing is what let all three mechanisms ship: every prior row varied the binary and held the separator at a single space.
- [ ] If `lib/cmd-detect.sh` is widened, `.claude/hooks/repro-outward-cli-corpus.sh` passes with per-path verdicts and deny attribution unchanged, or the pin is updated with the delta explained. It is a **required** check on `main`.
- [ ] `test-cmd-detect.sh`'s `assert_wired` / non-vacuity caller count updated if the fast-path needle set changes.
- [ ] Mutation-verified per mechanism, not in aggregate: reverting each clause reddens only its own rows.

## Implementation Notes

- Files: `.claude/hooks/merge-review-guard.sh` (the `[ "$SUB" = "merge" ] || exit 0` at ~:148 and the comment block above it), `.claude/hooks/test-merge-review-guard.sh`, and probably `.claude/hooks/lib/cmd-detect.sh` for mechanism (b).
- Sibling todo, same root cause class, do them together if touching the shared extractor: `todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md`.
- The comment block already in `merge-review-guard.sh` records this gap where the check is defined; update it rather than deleting it.
- `.claude/hooks/**` feeds a required check. Mutation-verify before pushing, and run the corpus against **branch + current main**, not the bare tip.

### 2026-09-17 - mechanism (b) CLOSED in full; a live two-guard bypass closed with it

- **The namespace->verb slot is closed.** `_CMD_GH_PR_SEP` gives it the absorber
  `_CMD_GH_GLOBALS` has had since 2026-09-13, applied from ONE constant at all seven call
  sites. The three `KNOWN GAP, namespace->verb slot` tripwire rows are now deny assertions,
  which is what they were pinned for.
- **A LIVE TWO-GUARD BYPASS was found and closed**, which this todo did not predict: a
  substitution-rendered binary with a GLUED redirect in the verb slot passed BOTH guards.
  Neither axis alone does - the glued redirect alone denies, the substitution alone denies.
  Only their PRODUCT escaped, because guard-outward-cli's expansion arm closed its verb with
  `([[:space:]]|$)` rather than `_OUT_POS_SUFFIX`. One token. Not specific to `$(...)`: a plain
  parameter expansion was equally open and is pinned.
- **THE 248-of-537 FIGURE IS AGAINST THE REVIEW GATE ALONE and overstates the exploitable
  surface.** Re-measured on a generated rendering x separator x slot x verb corpus with argv
  ground truth from a shim: of 70 real merge rows the gate was blind to 44, but
  guard-outward-cli denied all but **2**. Name the layer before quoting the number.
- **STILL OPEN, and why this todo stays open:** the BINARY RENDERING family - path-qualified,
  wholly quoted, and substitution - defeats the detector BEFORE any slot is reached, so the
  slot widening cannot touch it. All are denied today by guard-outward-cli, so it is
  defence-in-depth rather than a live bypass. Pinned as `KNOWN GAP, binary rendering` rows.
  Closing it means making `cmd_bare`'s blanking preserve token boundaries, a lib-wide change.
- The required corpus reproduces BYTE-IDENTICAL pins on the fix branch. That is the finding
  rather than a reassurance: it varies one axis at a time and so cannot contain a
  product-of-two defect.
- Harness bound, stated because it limits the 44: rows whose separator is a literal TAB are
  unreliable (the tab collides with the measurement harness's own field delimiter) and are
  excluded. `sp2` covers non-single-space whitespace.

### 2026-09-18 — RE-MEASURED on batch D's head, and GATED. No fix attempted.

Re-ran the 13-rendering family against BOTH guards on this tree (PreToolUse envelopes on stdin,
nothing executed). Numbers below are this run's, not the todo's original.

**Mechanism (a), glued shell metacharacter — CLOSED.** All six spellings now DENY on both guards:
`;`, `&&`, `||`, `|`, `(` and `&` glued to the binary. The todo attributes 192 of its 248 rows to
this mechanism, so most of the original finding is gone. **This is a 6-row sample of a
13-rendering family, not the family** — re-run the todo's own 537-row corpus before re-scoping.

**Mechanism (b), a word between binary and verb — CLOSED** by #991: a redirect between the binary
and its verb denies on both.

**TWO LIVE TWO-LAYER ALLOWS** (both guards miss — this is the remaining scope):

| rendering                                                 | outward | merge gate | note                                                                                 |
| --------------------------------------------------------- | ------- | ---------- | ------------------------------------------------------------------------------------ |
| a backslash-escaped binary + merge verb                   | ALLOW   | ALLOW      | **no escape token needed** — bash strips the backslash, so this reaches the real CLI |
| the documented escape var + a command-substitution binary | ALLOW   | ALLOW      | also the backtick and quoted spellings                                               |

**TEN RENDERINGS MISS THE MERGE GATE ONLY** — the outward guard still denies them, so they are
real extractor misses but not live bypasses today: an absolute path, `g"h"`, `g'h'`, `${gh_bin}`,
`$gh_bin`, three command-substitution spellings, `./node_modules/.bin/…` and `../bin/…`.
**Do not describe these as closed.** Each is one escape-variable away from live, which the rows
above demonstrate. `command`- and `env`-prefixed forms deny on both.

### Why no fix was attempted, and what the decision actually is

The escaped binary renders without a visible command word because the unquoted-context arm emits
a placeholder TWICE for `\\<anything>`. That is deliberate: the comment block directly above it
(ending "the documented backslash residual") records that rendering an escaped space as
whitespace SPLIT a word the shell had JOINED, manufacturing an `--auto` token that GRANTED the
immediate-merge carve-out, and states the governing rule — **emitting more tokens than argv
contains is harmless for a deny-shaped check and fatal for a grant-shaped one.**

The candidate narrowing is: emit the escaped character when it is NOT whitespace; keep the
placeholder for escaped whitespace and newline. It adds no tokens, so it does not obviously
re-open that incident.

**But it is not one line.** `if (c == BS)` occurs **10 times** in that file (lines [391, 413, 417, 537, 567, 572, 750, 870, 918, 1198]), and
the arms disagree: **3 of them render the escape as literal whitespace** (lines [391, 413, 417]) — the
very thing the comment forbids — presumably because they serve quoted-span passes where the
shell's own treatment differs. Any fix must rule on which arms change and justify each against
its lexical context. Those line numbers were true when this was written and move on every edit;
re-derive with `grep -n 'if (c == BS)'` rather than trusting them.

Combined with three prior withdrawals on this todo and a required-check pin re-derivation, that
is a human's call, which is what `human_led` above records.
