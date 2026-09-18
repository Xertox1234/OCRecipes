---
title: "An archive move whose body was rewritten is a delete+add, so a hand-assembled reviewer file list is one path short and the merge gate refuses a flawless review"
track: bug
category: code-quality
tags: [harness, testing, architecture]
module: shared
applies_to: [".claude/hooks/**/*.sh", "docs/AI_WORKFLOW.md", "docs/solutions/**/*.md"]
symptoms: ["a `No findings.` review is recorded clean yet the merge is denied for mis-scoped review", "the gate reports `none was scoped to PR #N's changed files` with a digest you cannot account for", "a session reports `merge stamp is in place` and the merge still fails", "the reviewed-file count is exactly one less than the PR's changed-file count", "the missing path is a `todos/X.md` whose archive copy IS listed"]
created: 2026-09-17
severity: medium
---

# An archive move git reads as delete+add mis-scopes the review stamp

## Problem

`merge-review-guard.sh` binds a review record to **two** things: the head SHA, and a digest
over the PR's changed-file set. A review can be thorough, honest, `verdict: clean` and bound
to the right commit, and still be refused — because the file list the reviewer echoed back
is not the list the gate computes.

The trap is a todo archive move. The usual mental model, recorded in
[a-rename-collides-through-a-path-only-one-side-lists](../conventions/a-rename-collides-through-a-path-only-one-side-lists-2026-09-14.md),
is that "renames collapse to the destination, so archive moves do NOT expand the file set."
That holds **only while git still sees a rename.** Archive a todo and rewrite its body in the
same commit and similarity detection fails, so git reports a delete **plus** an add — two
paths, not one.

## Symptoms

- A four-round, independently-reproduced `No findings.` review sits on disk with
  `verdict: clean`, `unresolved: []`, and the merge is still denied.
- The denial names a digest (`this diff's digest over 13 file(s) is b49bd61b27558c4d`) that
  does not match the record, with no indication of *which* path differs.
- The reviewed-file count is short by exactly one, and the missing entry is the pre-archive
  `todos/X.md` whose `todos/archive/X.md` counterpart **is** present — so the list looks
  complete to anyone eyeballing it.

## Root Cause

Measured on PR #994 (2026-09-17). The todo was archived and rewritten at once — 144 deleted
lines against 308 added — which is far below git's rename-similarity threshold:

| List | Files | Digest |
| --- | --- | --- |
| The gate's own `gh pr diff 994 --name-only` | 13 | `b49bd61b27558c4d` |
| The list the orchestrator handed the reviewer | 12 | `66f527f827c33e8c` |

The 12-file list reproduces the stamp's digest exactly, which is what attributes the failure
to the **list**, not to the reviewer or the analysis. The single missing path was
`todos/P2-2026-08-16-nutritiondetail-itemid-branch-has-no-producer.md` — the deleted source
of the archive move.

The denial is then unavoidable, and all three stages were confirmed by running them:

1. The guard is PreToolUse on **both** `Bash` and `mcp__github__merge_pull_request`, so no
   merge route skips it.
2. `scripts/todo-automerge-guard.sh --paths-only 994` exits **1** (HOLD), so a review record
   is required.
3. The record loop finds a record for the head, passes it on verdict, then `continue`s it on
   digest — leaving `MATCHED` empty and denying.

## Solution

Derive the reviewer's file list from **the gate's own command and nothing else**, then feed
that output verbatim into the dispatch prompt:

```bash
CHANGED=$(gh pr diff "$PR" --name-only 2>/dev/null | sed '/^$/d' | sort -u)
printf '%s\n' "$CHANGED"
printf '%s\n' "$CHANGED" | shasum | cut -c1-16     # the digest the gate will demand
```

Do not build the list from `git diff --stat`, from the PR body, or by hand — each of those
can apply rename detection, or simply omit a path, and produce a list that looks right.

## Prevention

**Run the digest as a positive control before you rely on any stamp.** One command settles
whether a record you are about to trust actually covers the diff:

```bash
. .claude/hooks/lib/review-stamp-path.sh
jq -r .reviewed_files_digest "$(review_stamp_dir "$HEAD_SHA")"/*.json
```

If that does not equal the `WANT_DIGEST` computed above, the review says nothing about this
diff no matter how good it is. A stamp that exists and reads `clean` is **not** the same as
a stamp the gate will accept — "the stamp is in place" is a claim about one field out of
three, and reporting it as merge-readiness is how this reaches the merge attempt.

Two related mechanics, both verified in the hook source rather than assumed:

- The record loop **never filters on `agent_type`**. Any of the five roster reviewers
  (`code-reviewer`, `server-reviewer`, `mobile-reviewer`, `ai-reviewer`, `security-auditor`)
  writes a record, and any clean one carrying the right digest satisfies the gate. A note
  that only `code-reviewer` can clear a merge is wrong.
- A review whose last line is a `WARNING` rather than `No findings.` writes **no record at
  all**, so an earlier record for the same SHA survives untouched. Absence of a fresh record
  is not evidence that the latest reviewer was satisfied.

## Related Files

- `.claude/hooks/merge-review-guard.sh` — stages 1–3; the `CHANGED` / `WANT_DIGEST` pair and
  the record loop whose order comment explains why a filter may decide whether a record can
  SATISFY but never whether it can BLOCK.
- `.claude/hooks/review-stamp-writer.sh` — `SubagentStop`; accepts the five roster agents.
- `.claude/hooks/lib/review-stamp-path.sh` — `review_stamp_dir`; resolve the directory with
  this, never by hand-hashing.
- `scripts/todo-automerge-guard.sh` — stage 2 risk classification (`--paths-only`).

## See Also

- [verification-that-scans-zero-inputs-is-green-and-meaningless](verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the same discipline: a digest over an empty or truncated list is well-formed and matches nothing.
- [../conventions/a-rename-collides-through-a-path-only-one-side-lists](../conventions/a-rename-collides-through-a-path-only-one-side-lists-2026-09-14.md) — the merge-conflict consequence of the same delete+add fact, and the note this doc bounds.
