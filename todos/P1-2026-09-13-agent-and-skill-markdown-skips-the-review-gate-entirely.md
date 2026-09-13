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

`scripts/todo-automerge-guard.sh` exempts every `.md` file from its sensitivity check, so
`.claude/agents/*.md`, `.claude/skills/**/*.md` and `docs/AI_WORKFLOW.md` classify as
ordinary prose. `merge-review-guard.sh` then exits at stage 2 and never requires a review
record. These are the files that define what every future review does — so a change that
weakens them can merge with neither a human approval nor an AI review record, and every
subsequent review will come back clean **because the checklist that would have caught
things is the thing that was removed.**

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

| layer                           | covers this?                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `merge-review-guard.sh` stage 2 | No — `GUARD_RC=0 … && exit 0` returns before stage 3's record check                                    |
| `merge-review-guard.sh` stage 1 | No — only applies to `todo/*` branches                                                                 |
| Branch protection               | No — `required_approving_review_count: 0`                                                              |
| `CODEOWNERS`                    | No — the file does not exist                                                                           |
| The 9 required checks           | No — lint/tests/types/coverage/2 mutation gates/CodeQL/outward-CLI corpus; none inspects agent content |

Empirically, on the real open PR #945 (whose diff was confirmed to carry
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

### The sharpest case is not the agent files

`docs/AI_WORKFLOW.md` carries the Review Policy **and** the reviewer dispatch prompt with the
`REVIEWED-SHA` / `REVIEWED-FILES` contract that `review-stamp-writer.sh` parses. An edit
there changes what every reviewer is told to do _and_ the format the writer reads to produce
a record — so a change could make reviews cosmetic while the gate still reports clean
records bound to the right SHA. It sits one directory away from the carve-out that exists to
prevent exactly this.

## Severity note

Filed at **high**, not critical, because it is a gap in _what requires review_ rather than an
active bypass of a live control path (contrast
`todos/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md`, which
merges a PR right now with no record). Reasonable to argue for critical on the grounds that
it defeats the review apparatus for the files defining the apparatus, and that the mitigating
layers are all absent rather than merely weak. Bump it if you read it that way.

## Acceptance Criteria

- [ ] A PR touching only `.claude/agents/*.md` HOLDs — `todo-automerge-guard.sh --paths-only`
      returns non-zero and `merge-review-guard.sh` reaches stage 3 and requires a record.
- [ ] Same for `.claude/skills/**/*.md` and `docs/AI_WORKFLOW.md`.
- [ ] Controls in the same run, both directions: a `docs/solutions/` doc, a `todos/` file and
      a `docs/research/` doc all still PASS on the allowlist alone — the high-volume,
      low-risk case the exemption exists for must not regress.
- [ ] The rc-capture discipline of the existing code is preserved: a broken regex (rc >= 2)
      must fall through to MORE checking, never take the exemption. The current code is
      written that way deliberately and the comment says why — do not rewrite it as a
      negated `&&` chain.
- [ ] Rows generated from the product of {path} x {exempt, carved-out} rather than hand-listed,
      with any count quoted together with the corpus that produced it.
- [ ] `scripts/__tests__/todo-automerge-guard.test.ts` gains coverage, and the new rows are
      mutation-verified: break the carve-out and confirm only the new rows redden.

## Implementation Notes

The fix is one regex. Extend the `rc_rules` carve-out so it matches the same set the
sensitivity check should see:

```bash
rc_rules=0
printf '%s' "$f" \
  | grep -qE '(^|/)docs/rules/|(^|/)\.claude/(agents|skills)/|(^|/)docs/AI_WORKFLOW\.md$' \
  || rc_rules=$?
```

**That candidate is measured, not proposed.** Run 2026-09-13 against the regex above, both
directions, so the implementer starts from a tested string rather than a plausible one:

| path                                            | verdict | wanted                                      |
| ----------------------------------------------- | ------- | ------------------------------------------- |
| `.claude/agents/code-reviewer.md`               | CARVED  | carved                                      |
| `.claude/agents/security-auditor.md`            | CARVED  | carved                                      |
| `.claude/skills/codify/SKILL.md`                | CARVED  | carved                                      |
| `docs/AI_WORKFLOW.md`                           | CARVED  | carved                                      |
| `docs/rules/security.md`                        | CARVED  | carved (no regression on today's behaviour) |
| `docs/solutions/code-quality/foo-2026-09-13.md` | exempt  | exempt                                      |
| `todos/P3-2026-09-13-x.md`                      | exempt  | exempt                                      |
| `docs/research/bar.md`                          | exempt  | exempt                                      |
| `todos/archive/old.md`                          | exempt  | exempt                                      |

That is a hand-listed set and therefore reproduces the author's blind spot — it is a
starting point, not the corpus the acceptance criteria ask for. Generate that one.

**Keep the two spellings in sync.** The script's own comment warns that this regex and the
`SENSITIVE_OVERRIDE` entry are deliberately the same text, "if the two ever diverged, a path
could be exempted here and never reach the override that is supposed to HOLD it." Widening
one without the other reintroduces the bug in mirror image — the
`widened-extractor-unwidened-consumer-fails-confidently` pattern.

Decide deliberately whether `.claude/hooks/**` markdown, `.claude/skills/**` non-markdown and
`CLAUDE.md` belong in the same set. `CLAUDE.md` is gitignored here so it cannot appear in a
diff, but check rather than assume.

## Scope Contract

- **Mechanisms to use:** widen the existing `rc_rules` carve-out regex and its
  `SENSITIVE_OVERRIDE` twin. No new gate, no new file, no new classification concept.
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
