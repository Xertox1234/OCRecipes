---
title: "Agent, skill and AI_WORKFLOW markdown takes the batch-merge doc exemption, so the files that DEFINE review can be merged without any review"
status: backlog
priority: high
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, harness, security]
github_issue:
---

# Agent/skill markdown skips the review gate entirely

## Summary

`scripts/todo-automerge-guard.sh` runs its markdown exemption **before** its sensitivity
check, so an unscoped `\.md$` defeats **every whole-directory `SENSITIVE_OVERRIDE` entry**.
There are six — `server/middleware/`, `server/routes/`, `.github/`, `scripts/`,
`migrations/`, `docs/rules/` — and only the last has a carve-out. Any markdown under the
other five is already declared sensitive by the script's own policy and is silently exempted
anyway.

On top of that, the files that actually govern review — `.claude/agents/*.md`,
`.claude/skills/**/*.md`, `docs/AI_WORKFLOW.md`, `docs/PATTERNS.md` — are in no override
entry at all. `merge-review-guard.sh` then exits at stage 2 and never requires a review
record. A change weakening them can merge with neither a human approval nor an AI review
record, and every subsequent review comes back clean **because the checklist that would have
caught things is the thing that was removed.**

**This is not a hypothetical path.** `.claude/skills/audit/SKILL.md:113` states that
`.claude/agents/` edits "ride the audit branch"; :387 and :397 instruct adding
reviewer-checklist items there; and `/codify` Step 5 routes every new review rule to the
owning agent file. PR #945 did exactly that, earlier the same day. It is a sanctioned,
routine flow — the direct analogue of the `todo-executor` Step 5b path the guard's own
comment cites as why `docs/rules/` was carved out, "a real path, not a hypothetical".

## Background

Found while reviewing PR #945, which edits `.claude/agents/code-reviewer.md`. Measured,
not inferred.

### The mechanism

`scripts/todo-automerge-guard.sh` step 2 of the PATH GATE:

```bash
rc_rules=0; printf '%s' "$f" | grep -qE '(^|/)docs/rules/' || rc_rules=$?
if [ "$rc_rules" -eq 1 ] && printf '%s' "$f" | grep -qE '^(docs|todos)/|\.md$'; then
  continue          # <- never reaches the sensitive override
fi
```

The exemption's second alternative is a bare `\.md$` with **no directory scoping**. The only
carve-out is `docs/rules/`. Measured against the real path:

```
.claude/agents/code-reviewer.md
  MATCHES '^(docs|todos)/|\.md$'      -> takes the exemption
  does NOT match '(^|/)docs/rules/'   -> not carved out
```

`SENSITIVE_OVERRIDE` contains **zero** references to `.claude/` (confirmed by grep), so even
if the file reached step 3 it would pass.

### It is not caught anywhere else

| layer                           | covers this?                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `merge-review-guard.sh` stage 2 | No — `GUARD_RC=0 … && exit 0` returns before stage 3's record check                               |
| `merge-review-guard.sh` stage 1 | No — only applies to `todo/*` branches                                                            |
| Branch protection               | No — `required_approving_review_count: 0`                                                         |
| `CODEOWNERS`                    | No — the file does not exist                                                                      |
| The 9 required checks           | No — for `.claude/**` and `docs/AI_WORKFLOW.md` / `docs/PATTERNS.md`; none inspects their content |

**One exception, and the two reviewers disagreed about it — settled by measurement.**
`.github/copilot-instructions.md` IS backstopped by a required check: `ci.yml`'s job
`checks` is named **`Lint · Types · Patterns`** (a required context) and runs
`build:copilot-instructions:check` at `ci.yml:70`, and the `pull_request` trigger carries
**no** `paths` filter (only `push` has `paths-ignore`), so it runs on a markdown-only PR and
fails any lone divergent edit. One reviewer cited a separate non-required workflow and
concluded there was no backstop; that is the wrong job. Do not over-read the backstop either:
it is a generated-vs-committed drift check, so it catches a lone edit to the output, not a
coupled edit to a source that regenerates it — though those sources (`scripts/**`,
`docs/rules/**`) are themselves held.

Empirically, on PR #945 (since merged; the citation still reproduces, because the guard
reads the PR's file list from the API — whose diff was confirmed to carry
`.claude/agents/code-reviewer.md`):

```
$ bash scripts/todo-automerge-guard.sh --paths-only 945
guard: OK PR #945 — every changed file is on the safe allowlist
rc=0
```

### The carve-out's own rationale already covers this

From the same script, line 122, explaining why `docs/rules/` is carved out:

> `docs/rules/` is the one whole-directory entry that is NOT code: those files are this
> repo's **BINDING review rules** … every reviewer and every injected-pattern hook acts on
> them.

`.claude/agents/*.md` is that category — more directly than `docs/rules/`, since it is the
checklist each reviewer executes. The principle was identified and one directory was carved
out; its siblings were not.

### What the gap can and cannot do

**It cannot forge or suppress a record.** `.claude/settings.json` (which registers
`review-stamp-writer.sh` on `SubagentStop`) and the writer itself are **not on
`SAFE_ALLOWLIST` at all**, so both HOLD at step 1. The sha binding, the reviewed-files
digest, the objection-before-scope ordering and the unreadable-record deny all live inside
held files. Nothing merges today without a record. That is what keeps this below the
root-position P0.

**What it can do is change what a clean record MEANS**, which is worse than it sounds.
An earlier revision of this todo claimed the lever was `docs/AI_WORKFLOW.md` controlling
"the format the writer reads". **That was wrong** — measured: the `REVIEWED-SHA` /
`REVIEWED-FILES` parse is hardcoded in `review-stamp-writer.sh:126-127,137-171`, a held
file, and a reply violating it produces _no record at all_, which denies the merge.
Fail-closed.

The live channel is the verdict decision at `review-stamp-writer.sh:223-230`:

```bash
if [ -n "$CRITICALS" ]; then VERDICT=findings
elif [ "$LAST_LINE" = "No findings." ]; then VERDICT=clean
else exit 0
fi
```

`findings` requires a standalone top-severity token; `clean` requires a literal trailing
`No findings.`. **Both the severity vocabulary and that closing line are dictated by the
exempt agent definitions and the exempt dispatch prompt.** So one unreviewed exempt merge
can make a reviewer that found real defects emit a reply recorded as `clean` — and the
hook's own residual 1 already names last-line trust as its fail-open edge.

A second lever: the record loop sets `MATCHED=1` on the first qualifying record with **no
roster-completeness test**, so the roster list in `docs/AI_WORKFLOW.md` (also exempt) governs
how much of the roster ever runs.

## Severity note

Filed at **high** — at the top of that tier — and the original reasoning for it was not
quite right, so here is the measured version.

It stays below the root-position P0 because **the gate's structural integrity holds**:
`.claude/settings.json` and `review-stamp-writer.sh` both HOLD at step 1, so no record can be
forged or suppressed, and nothing merges today without one. The P0 it contrasts against
merges a PR _right now_ with no record; this does not.

What it does is change what a clean record means, via the verdict vocabulary and closing
literal described above. Both reviewers leaned toward bumping this to the top tier; one did
so partly on the grounds that `.github/copilot-instructions.md` has no required-check
backstop, which was measured and is **false** (see the table above). Keeping it at high, with
the P0 ordered ahead of it, and the counter-argument recorded rather than dismissed.

## Acceptance Criteria

- [ ] A PR touching only `.claude/agents/*.md` HOLDs — `todo-automerge-guard.sh --paths-only`
      returns non-zero and `merge-review-guard.sh` reaches stage 3 and requires a record.
- [ ] Same for `.claude/skills/**/*.md` and `docs/AI_WORKFLOW.md`.
- [ ] Controls in the same run, both directions: a `docs/solutions/` doc, a `todos/` file and
      a `docs/research/` doc all still PASS on the allowlist alone — the high-volume,
      low-risk case the exemption exists for must not regress.
- [ ] **Non-regression bound:** `.claude/settings.json` and `.claude/hooks/*.sh` must keep
      HOLDing, and they must keep doing so at step 1 (not on the allowlist) rather than via
      the override — the registration file's protection today comes from the allowlist being
      NARROW, so a widened allowlist later would silently expose it.
- [ ] `.github/copilot-instructions.md` HOLDs after the fix, and all 15 `docs/rules/*.md`
      still HOLD — the reorder must not disturb the entry that already worked.
- [ ] The rc-capture discipline of the existing code is preserved: a broken regex (rc >= 2)
      must fall through to MORE checking, never take the exemption. The current code is
      written that way deliberately and the comment says why — do not rewrite it as a
      negated `&&` chain.
- [ ] Rows generated from the product of {path} x {exempt, carved-out} rather than hand-listed,
      with any count quoted together with the corpus that produced it.
- [ ] `scripts/__tests__/todo-automerge-guard.test.ts` gains coverage, and the new rows are
      mutation-verified: break the carve-out and confirm only the new rows redden.

## Implementation Notes

**Do not enumerate siblings — reorder.** An earlier revision of this todo proposed extending
the `docs/rules/` carve-out with three more specific paths. Both reviewers independently
called that structurally too narrow, and they were right: it closes part of the hole and
reads as complete, which is this todo's own headline failure mode. `.github/copilot-instructions.md`
would have stayed exempt.

The defect is ORDER, not membership: step 2's markdown exemption runs before the sensitivity
check.

**But do not simply run the whole `SENSITIVE_OVERRIDE` first.** A revision of this todo
proposed exactly that and it is WRONG — measured. `SENSITIVE_OVERRIDE` is not only the six
structural directory entries; it also carries free-text keyword alternatives (`[Aa]dmin`,
`[Pp]remium`, `[Ll]ogin`, `secret`, `credential`, `(^|/)[Hh]ealth`) written to classify CODE
by filename, back when the regex was only ever reached by files that had already failed the
doc exemption. Running it against documentation repurposes those keywords as a prose scan.
Over the full 3567-path tracked corpus that flips **33 ordinary docs and todos** from PASS to
HOLD — `premium-gate-parity-...md`, `005-p1-login-lacks-zod-validation.md` and so on —
gating every future `/codify` and `/todo` archive whose slug happens to contain an everyday
word, which defeats the exemption's entire purpose.

**Split a STRUCTURAL-ONLY subset for the documentation path**, and leave the full
keyword-bearing regex exactly where it is for code:

```bash
# 2) structural sensitivity — whole-directory and exact-path entries ONLY.
#    Markdown never escapes this. Deliberately NOT the full SENSITIVE_OVERRIDE:
#    that regex carries free-text keywords for classifying CODE by filename, and
#    running them over prose HOLDs any doc whose slug says "premium" or "login".
STRUCTURAL_SENSITIVE='(^|/)server/middleware/|(^|/)server/routes/|(^|/)\.github/|(^|/)scripts/|(^|/)migrations/|(^|/)docs/rules/|(^|/)\.claude/(agents|skills)/|(^|/)docs/AI_WORKFLOW\.md$|(^|/)docs/PATTERNS\.md$'
# rc CAPTURED, not a bare `&&` chain — mirroring this script's own step-3 idiom.
# Only a clean no-match (rc 1) may skip the HOLD; rc 0 (sensitive) and rc >= 2
# (broken regex) both HOLD. See the measured note below for why this matters.
rc_struct=0; printf '%s' "$f" | grep -qE "$STRUCTURAL_SENSITIVE" || rc_struct=$?
if [ "$rc_struct" -ne 1 ]; then unsafe="${unsafe}  ${f}"$'\n'; continue; fi

# 3) the volume exemption, unchanged in effect
printf '%s' "$f" | grep -qE '^(docs|todos)/|\.md$' && continue

# 4) today's step 3, untouched: the full override for code paths
```

**The rc capture is not stylistic — a bare `&&` chain is fail-OPEN here, measured.**
A revision of this todo wrote `grep -qE "$STRUCTURAL_SENSITIVE" && { ...; continue; }`, which
contradicts this file's own acceptance criterion three sections down. With a malformed
`STRUCTURAL_SENSITIVE` (grep rc 2), the bare form does not raise and does not HOLD: it falls
through to the markdown exemption on the next line and classifies
`.claude/agents/code-reviewer.md` as **PASS** — the exact file class this todo exists to
protect. Constructed and run, with a healthy-regex control that agrees on both forms:

| regex state           | bare `&&` | rc-captured |
| --------------------- | --------- | ----------- |
| healthy (control)     | HOLD      | HOLD        |
| malformed (grep rc 2) | **PASS**  | HOLD        |

Writing the criterion down did not prevent writing the violating snippet. Pair any new
`grep -qE` in this script with its rc capture at the point of use.

The `docs/rules/` special case then becomes redundant and should be deleted — it is covered by
the structural subset. The four enforcement-governing paths (`.claude/agents/`,
`.claude/skills/`, `docs/AI_WORKFLOW.md`, `docs/PATTERNS.md`) appear in the structural subset
and should ALSO be added to `SENSITIVE_OVERRIDE` so a non-markdown file under those
directories is held by step 4 as well.

`docs/PATTERNS.md` belongs there because `.claude/agents/code-reviewer.md:36` makes it part of
the Categorize step every roster reviewer performs — the same "checklist each reviewer
executes" argument that covers the agent files.

**Measured over ALL 3567 tracked paths** (`git ls-files`, no sampling, 2026-09-13). Both
classifiers implemented and diffed row by row:

| outcome                                                    | count |
| ---------------------------------------------------------- | ----- |
| classification changes, total                              | 25    |
| — `.claude/skills/**`                                      | 13    |
| — `.claude/agents/**`                                      | 9     |
| — `.github/copilot-instructions.md`                        | 1     |
| — `docs/AI_WORKFLOW.md`                                    | 1     |
| — `docs/PATTERNS.md`                                       | 1     |
| **unintended changes under `docs/solutions/` or `todos/`** | **0** |

Non-regression spot checks, today vs fixed: `.claude/settings.json` HOLD→HOLD,
`.claude/hooks/*.sh` HOLD→HOLD, `docs/rules/security.md` HOLD→HOLD,
`premium-gate-parity-...md` PASS→PASS, `005-p1-login-lacks-zod-validation.md` PASS→PASS.

**Why the previous revision of this table said "zero unintended changes" and was wrong.**
It claimed to be generated from `git ls-files`. It was **sampled** — the high-volume classes
went through `head -2`, and those two samples happened to contain none of the free-text
keywords. A corpus that is sampled and called generated reproduces the author's blind spot
and returns a reassuring number; this todo's own acceptance criteria demand a generated one,
which the verification of its own candidate then failed to be. Recorded rather than quietly
fixed, because the shape recurs.

**The reorder DELETES the two-spelling coupling, and that is a reason to prefer it.** The
script's own comment warns that the step-2 carve-out and its `SENSITIVE_OVERRIDE` entry are
deliberately the same text — "if the two ever diverged, a path could be exempted here and
never reach the override that is supposed to HOLD it." That coupling is exactly the
`widened-extractor-unwidened-consumer-fails-confidently` hazard, and it exists only because
step 2 keeps its own copy of the answer. Deferring to `SENSITIVE_OVERRIDE` leaves one
spelling, so there is nothing left to drift.

The generated table above still needs to become a runnable test, not prose — see the
acceptance criteria. A table in a todo cannot be re-run by the next change.

Decide deliberately whether `.claude/hooks/**` markdown (README-shaped today) and
`.claude/skills/**` non-markdown belong in the same set. `CLAUDE.md` is gitignored here
(`git check-ignore -v CLAUDE.md` → `.gitignore:4`) so it cannot appear in a diff — verified,
not assumed.

The five uncarved whole-directory override entries (`server/middleware/`, `server/routes/`,
`.github/`, `scripts/`, `migrations/`) have exactly one live markdown instance between them
today — `.github/copilot-instructions.md` — confirmed via `git ls-files`. The reorder closes
the class rather than that instance, which is the point.

## Scope Contract

- **Mechanisms to use:** delete the `rc_rules` `docs/rules/` carve-out and replace it with a
  `STRUCTURAL_SENSITIVE` check ahead of the markdown exemption; add the four
  enforcement-governing paths to both that subset and `SENSITIVE_OVERRIDE`. No new gate, no
  new file, no new classification concept — one added constant in the script that already
  owns this decision.
- **Files in scope:** `scripts/todo-automerge-guard.sh`,
  `scripts/__tests__/todo-automerge-guard.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Independent of the two open guard P0/P1s, though it touches the same merge-gate
  apparatus and should not land simultaneously with a change to `merge-review-guard.sh`
  stage 2.

## Risks

- **Over-HOLDing is the cheap direction, but not free.** `todo-automerge-guard.sh`'s header
  says a missed allowlist entry costs a manual merge and never the reverse — so erring wide
  is correct here. Still verify the `docs/solutions/` and `todos/` volume case keeps passing,
  since `/todo` and `/codify` produce those constantly.
- **`scripts/**`feeds no required check directly, but`todo-automerge-guard.sh`is called by`merge-review-guard.sh` at stage 2.\*\* A regex error there fails closed (by design) and would
  HOLD every PR until fixed. Run the guard against several real PR numbers in both verdict
  directions before pushing.
- The script is `set -o pipefail`-sensitive in places and captures rc explicitly to avoid
  fail-open inversions. Read the comments around each `grep -qE` before editing.

## Updates

### 2026-09-13

- Filed at the user's explicit request after being surfaced during the #945 review. Both the
  mechanism and the absence of every mitigating layer were measured, not inferred.
