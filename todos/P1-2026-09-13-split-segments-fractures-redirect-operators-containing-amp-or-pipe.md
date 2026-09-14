---
title: "split_segments flushes on the unquoted `&`/`|` INSIDE a redirect operator, so `git 2>&1 commit` is fractured before any matcher sees it"
status: backlog
priority: high
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A redirect operator containing `&` or `|` is split in half before the regex runs

## Summary

`git-safety.sh`'s `split_segments` splits a command into quote-aware segments and flushes on
any unquoted `;`, `|`, `&` or newline — unconditionally, with no notion of whether that
character is a control operator or part of a REDIRECT operator. Four redirect families carry
one inside them:

| command                                   | segments produced                 | contract checked? |
| ----------------------------------------- | --------------------------------- | ----------------- |
| `git 2>&1 commit -m x`                    | `git 2>` + `1 commit -m x`        | **no**            |
| `git &>/dev/null commit -m x`             | `git ` + `>/dev/null commit -m x` | **no**            |
| `git >&2 commit -m x`                     | `git >` + `2 commit -m x`         | **no**            |
| `git >\|out commit -m x`                  | `git >` + `out commit -m x`       | **no**            |
| `git 2>/dev/null commit -m x` _(control)_ | one segment                       | yes               |

Neither half matches `MUTATING_GIT_SEG_RE` — the first has no verb, the second does not start
at `git` — so the segment loop takes its `|| continue` and the worktree contract is never
checked for that command.

**All four are real invocations**, verified by running them against an argv shim that appends
`$*` to a file (not reasoned from the grammar):

```
git 2>&1 commit -m A         -> REAL-INVOCATION argv: commit -m A
git &>/dev/null commit -m B  -> REAL-INVOCATION argv: commit -m B
git >&2 commit -m C          -> REAL-INVOCATION argv: commit -m C
git >|out commit -m D        -> REAL-INVOCATION argv: commit -m D
```

## Background

Found while implementing
`todos/archive/P1-2026-09-13-a-redirect-between-git-and-its-verb-defeats-the-worktree-contract.md`,
which adopted `lib/cmd-detect.sh`'s `_CMD_GIT_GLOBALS` / `_CMD_POS_SUFFIX` and closed the
interposed and verb-glued redirect positions. That change is correct and landed; it simply
cannot reach these four families, because the fracture happens one layer ABOVE the regex.

**How it was missed there, and the reason to state it here:** that todo's corpus measured
`grep -qE` against the constant in isolation. Through the real two-stage pipeline
(`split_segments` THEN the regex) the same 1344 rows score 912 SEEN, not 1200. The two
numbers were indistinguishable because 1200 is _also_ the count of corpus rows that are real
invocations, so the table read as a perfect score. Measure at the layer the claim is about.

### Scope: which consumers are affected

`split_segments` is local to `git-safety.sh` (it is not in `lib/`), so the fracture is this
hook's alone. `lib/cmd-detect.sh`'s own `cmd_words`-based matchers do NOT use it, and
`cmd_is_git_commit 'git 2>&1 commit -m y'` returns SEEN — measure before assuming a sibling
hook shares the gap, and before assuming it does not.

## Severity note

Filed **high**, matching its parent. It is an active bypass of a live control. It sits below
the merge-gate P0s for the same reason the parent did: the worktree contract prevents
accidental cross-checkout mutation during isolated work and has a sanctioned one-shot escape
(`SKIP_WORKTREE_CONTRACT=1`), so this is an undocumented route to something a caller may
legitimately ask for — not an unreviewed merge to `main`. Bump it if you weigh the isolation
guarantee higher.

## Acceptance Criteria

- [ ] A mutating git command whose redirect operator contains `&` or `|` reaches the contract
      check with its segment intact, for all four families (`2>&1`, `&>`, `>&`, `>|`).
- [ ] **No segment is merged that was previously separate.** This is the criterion the whole
      todo turns on — see Risks. A differential over a corpus that includes genuine control
      operators must show ZERO change in segment COUNT for every command whose `&`/`|` is a
      real separator.
- [ ] Laundering controls, constructed not harvested: `git -C <worktree> status && git -C
    <main> commit -m x` must still DENY, and every existing compound/laundering row in
      `test-git-safety.sh` must stay green.
- [ ] The four `KNOWN-WRONG (filed)` rows in `test-git-safety.sh` flip to `assert_deny` and
      lose the KNOWN-WRONG label, in the same change that fixes the cause.
- [ ] Corpus generated from a product of dimensions, measured through the REAL pipeline
      (`split_segments` then the regex), never the regex alone — the parent's mistake.
- [ ] Mutation-verified: revert the fix and confirm only the four families redden.
- [ ] Full hook suite green; the `Outward-CLI guard corpus` required check reproduces its pin.

## Implementation Notes

The awk scanner's state-0 branch is the whole of it:

```awk
else if (c == ";" || c == "|" || c == "&" || c == "\n") { flush() }
```

It needs to distinguish a control operator from a redirect operator. The discriminator is
lookaround, which this scanner does not currently do: `&` is part of a redirect when it is
immediately followed by `>`/`<` (`&>`), or immediately preceded by `>`/`<` (`>&`, `2>&`);
`|` is part of one when immediately preceded by `>` (`>|`). Everything else is a separator.

**`lib/cmd-detect.sh` already encodes this distinction** — `_CMD_REDIR` spells the operator
as `&?[<>]+&?[|!]?` precisely so the surrounding `&`/`|` are consumed as part of one unit.
Derive the lookaround from that constant's shape rather than inventing a second grammar; the
parent todo exists because a consumer re-derived a redirect grammar locally.

Do not reach for "also test the unsplit `$CMD`" as a shortcut. Splitting is what stops a
benign cross-segment `-C` from laundering a main-checkout mutation (see the comment at the
head of the contract branch); testing the whole command as one string re-opens that.

## Scope Contract

- **Mechanisms to use:** teach `split_segments`'s state-0 flush to recognise a redirect
  operator, deriving the shape from `_CMD_REDIR`. No second splitter, no whole-command
  fallback, no change to `MUTATING_GIT_SEG_RE`.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Parent (landed):
  `todos/archive/P1-2026-09-13-a-redirect-between-git-and-its-verb-defeats-the-worktree-contract.md`.
  Its `KNOWN-WRONG (filed)` rows are this todo's regression targets and its corrected corpus
  table is the baseline to beat (912/1344 through the real pipeline).

## Risks

- 🛑 **This is the false-ALLOW direction, unlike its parent.** Widening the REGEX could only
  add DENYs. Narrowing where the SPLITTER flushes does the opposite: two commands that used
  to be separate segments become one, and `MUTATING_GIT_SEG_RE` is `^`-anchored per segment,
  so a `git commit` that follows a merged separator stops sitting at a segment start and goes
  INVISIBLE. A careless fix here is strictly worse than the bypass it closes. Every change
  must be paired with a segment-count differential, not just a verdict differential.
- **Hook edits feed a required check.** `Outward-CLI guard corpus` covers `.claude/hooks/`
  and blocks every merge. Run it against branch ⊕ current main, never the bare tip.
- **The scanner is quote-stateful.** The `&` that matters is only the state-0 one; an `&`
  inside `'…'`, `"…"` or `$'…'` already survives, and those paths are pinned by existing
  tests. A fix that moves the check out of state 0 would regress them.
- **`{fd}>` is adjacent but NOT in scope** — `_CMD_REDIR` models a `{name}` fd prefix, and
  `{`/`}` are not flush characters, so those rows already pass. Named here so an implementer
  does not widen the change looking for a fifth family.

## Updates

### 2026-09-13

- Filed from the implementation of the parent todo, at the user's explicit direction after
  the finding was surfaced. The fracture, the four affected families, and their status as
  real invocations were each measured — the argv-shim run above — rather than inferred from
  the splitter's source.
