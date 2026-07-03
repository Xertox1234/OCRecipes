---
title: Resolve the diff range once for branch-diff skills; never scatter literal main...HEAD
track: knowledge
category: conventions
module: shared
tags: [codify, skill, diff-range, main-head, post-merge, squash, tooling]
applies_to: [.claude/skills/codify/SKILL.md, .claude/skills/spec-review/SKILL.md]
created: '2026-06-20'
source: 2026-06-20 todo P3-2026-06-19-codify-skill-handle-post-merge-diff
---

## Rule

A skill that operates on "the changes on this branch" (e.g. `/codify`, any
spec/review-over-diff skill) must **resolve its diff range exactly once**, up
front, and then have **every** downstream `git diff` reference that resolved
range — the domain-label feed, the review-dispatch command, the
confirm-there-is-a-diff check. Never hardcode a literal `main...HEAD` at each
consumer. The resolved range is a value the model **carries in context** (like
`review_output`), not a shell variable — shell vars do not persist between Bash
tool calls.

The range-resolution precedence is: **explicit argument** (`/codify <sha>` /
`<range>` / `--since <ref>`) > **non-empty `main...HEAD`** (live feature branch)
> **`HEAD^ HEAD` post-merge fallback** (only on the default branch when
`main...HEAD` is empty, because the branch was just squash/merged and `HEAD` is
the merge commit). A "nothing to codify" early-exit may fire **only when both**
`main...HEAD` and the fallback range are genuinely empty.

## When this applies

Any skill whose Step 1 (or equivalent) starts from `git diff main...HEAD`. As of
2026-06-20 `/codify` is the only such skill (verified: `grep -rln
"main\.\.\.HEAD" .claude/skills` returns only `codify/SKILL.md`); `spec-review`
consumes `path-domains.ts` but diffs differently. Apply this rule whenever a new
branch-diff skill is added.

## Why

The motivating failure: `/codify` invoked **after** a branch was squash-merged
and the session switched back to `main` produces an **empty** `git diff
main...HEAD`. The old Step 1 then hit its "if empty, stop" rule and aborted the
codify even though there were real findings in the just-merged work. (Worked
around manually with `git diff <squash-sha>^ <squash-sha>`.)

The subtler trap is **partial** conversion. It is easy to fix the visible Step 1
`main...HEAD` and miss the others. The reviewer-dispatch command and the
label-derivation feed each run their own `git diff`; if any one of them still
says `main...HEAD` while the resolved range is `HEAD^ HEAD`, that consumer diffs
an **empty** range and **silently** returns "No findings" / an empty label set —
a false pass, not an error. Resolving the range once and threading the single
value through every consumer is what closes that gap.

The post-merge fallback must be **confirmable, not silent** (a botched heuristic
could codify an unrelated prior commit): echo `HEAD`'s subject
(`git log -1 --format='%h %s' HEAD`) and treat it as the unit only if it is the
intended just-merged change, else ask for an explicit `<sha>`/`<range>`.

## Examples

```bash
# Range resolution (carry the result in context, not a shell var):
#   1. explicit arg  -> use it
#   2. main...HEAD non-empty -> main...HEAD
#   3. main...HEAD empty AND on default branch -> HEAD^ HEAD (confirm HEAD subject first)

# Every downstream consumer uses the SAME resolved range:
git diff <resolved-range> --stat
git diff <resolved-range> --name-only | xargs npx tsx scripts/lib/path-domains.ts --routing
# reviewer dispatch prompt: "git diff <resolved-range>"   # NOT a re-hardcoded main...HEAD
```

The `path-domains.ts --routing` CLI takes file paths as args, so it is already
range-agnostic — only the `git diff ... --name-only` that feeds it must use the
resolved range. No script change is needed; this is a skill-prose discipline.

## Exceptions

The **path-2 detection probe** is deliberately literal: you must run
`git diff main...HEAD --stat` once to discover whether the live-branch range is
empty. That single probe stays `main...HEAD`; only the consumers downstream of
the resolved decision use `<resolved-range>`.

## Related Files

- `.claude/skills/codify/SKILL.md` — Step 1 range resolution + Step 3 review dispatch/confirm-check
- `scripts/lib/path-domains.ts` — range-agnostic label CLI fed by the resolved `--name-only` list

## See Also

- [solutions-db-add worktree-relative path](solutions-db-add-worktree-relative-path-2026-06-18.md) — sibling /codify-mechanics convention
