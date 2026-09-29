---
title: "A literal prefix strip against a git-resolved root silently no-ops when the caller's path keeps a symlinked spelling"
track: bug
category: logic-errors
tags: [harness, pg-lab, bash, symlink, path-normalization, hooks]
module: shared
applies_to: [scripts/pg-lab/session-coord.sh, .claude/hooks/test-session-coord.sh, .claude/hooks/test-session-coord-v2.sh]
symptoms: ["A downstream comparison between a value resolved via git (git rev-parse --show-toplevel, always the physical spelling) and a value taken as-typed from the caller (possibly a symlinked spelling, e.g. macOS /tmp -> /private/tmp) silently returns the wrong answer with no error", "A derived relative path ends up equal to the full absolute path, because the literal prefix strip against the physical root never matches the symlinked-spelled input", "Two independently-recorded values for the same real file never compare equal, because each was spelled through whichever path the caller happened to type"]
created: 2026-09-29
severity: low
---

# A literal prefix strip against a git-resolved root silently no-ops when the caller's path keeps a symlinked spelling

## Problem

`scripts/pg-lab/session-coord.sh`'s `record_one`/`consult_match` computed a file's
`rel_path` as `rel="${file#"$root"/}"`, where `root` came from `git -C "$dir" rev-parse
--show-toplevel`. Git always resolves symlinks in that output (the physical spelling —
`/private/tmp/...` on macOS), but `$file` kept whatever spelling the caller used (e.g.
`/tmp/...`). When the two disagreed, the literal prefix strip silently did nothing:
`rel_path` came out equal to the full `abs_path`, and a cross-session match on `abs_path`
never fired either, since both sides recorded whichever spelling their own caller happened
to type.

## Symptoms

- `rel_path == abs_path` for a file that is genuinely inside a git worktree.
- A same-file or same-checkout warning that should fire (two sessions editing the same real
  file) silently never fires, because the two sessions' recorded `abs_path`s differ only in
  spelling.
- Fails safe, not loud: no error, no crash — just a missed warning. Easy to miss in review
  because every individual git call and string operation is correct in isolation; only the
  *combination* (one side resolved, one side not) is wrong.

## Root Cause

`git rev-parse --show-toplevel` (and friends) always canonicalizes symlinks in the path it
returns. Nothing analogous happens to a path that arrives as a plain string from a hook's
JSON payload, a CLI argument, or test fixture literal. Comparing or stripping one against
the other is comparing two different spellings of the same referent and assuming they're
the same string.

## Solution

Normalize the **caller-derived** path once, at a single choke point upstream of every
consumer that will later compare it against a git-resolved value — not independently inside
each consumer. Walk up to the nearest **existing** ancestor (the leaf may not exist yet —
`Write`/`mkdir` can create it), resolve that ancestor with `cd "$dir" && pwd -P`, then
re-append the (possibly nonexistent) suffix as spelled. Fail safe: echo the input unchanged
if `cd`/`pwd -P` fails, or if the input isn't an absolute path.

```bash
physical_path() { # $1 absolute path -> physical spelling of its nearest existing ancestor
  local file="$1" dir pdir
  case "$file" in /*) ;; *) printf '%s\n' "$file"; return 0 ;; esac
  dir=$(dirname "$file")
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname "$dir"); done
  pdir=$(cd "$dir" 2>/dev/null && pwd -P)
  if [ -n "$pdir" ]; then file="${pdir}${file#"$dir"}"; fi
  printf '%s\n' "$file"
}
```

In `session-coord.sh` this was wired into `target_paths()` — the single function that feeds
**both** `do_record` and `do_consult` — so `record_one`/`consult_match` needed no changes at
all; their existing `rel="${file#"$root"/}"` strip was already correct once `$file` arrived
pre-normalized.

When normalizing a list of targets derived from a shell command (the Bash-tool-call case),
normalize **before** deduping (`sort -u`), not after: two different spellings of the same
real file only collapse into one candidate once compared post-normalization. Normalizing
after dedup lets both spellings survive as separate — and now duplicate — entries, silently
doubling any per-candidate budget downstream (live-confirm calls, telemetry writes, etc.).

## Prevention

- Whenever a value is compared or joined against something git resolved
  (`git rev-parse --show-toplevel`, `--show-cdup`, etc.), normalize **both** sides to the
  same spelling before comparing — never assume the non-git side already matches.
- This repo already uses the `cd "$dir" && pwd -P` idiom in several other places for the
  identical class of mismatch — reach for it rather than re-deriving normalization from
  scratch: `.claude/hooks/worktree-deps.sh:32`, `.claude/hooks/lib/review-stamp-path.sh:34`,
  `scripts/lib/preflight-stamp-path.sh:38`.
- **A test fixture that matches two sides by literal string equality can go silently vacuous
  once normalization is introduced on only one side of that same comparison.** Adding this
  fix broke a pre-existing "self-suppression" consult test in
  `.claude/hooks/test-session-coord.sh`: its query path and its fixture's `abs_path` were
  both a literal, unresolved `/tmp/...` string. Once the query side started getting
  normalized to `/private/tmp/...`, the intended gate (`is_self`) was no longer what excluded
  the row — an unrelated `abs_path` mismatch did, stacked on a pre-existing `own_gate`
  staleness default that *also* independently excluded it for an unrelated reason. The
  assertion kept passing, but could no longer go red under any mutation of the gate it
  claimed to pin — confirmed by hand-mutating `is_self` to always return false against a
  properly tree-copied script: the unfixed fixture stayed empty (silently vacuous), the fixed
  one correctly went non-empty. When you add normalization anywhere in a comparison path,
  audit every existing fixture that built *both* sides of that comparison from the same
  literal, unresolved path — resolve both sides through a real `pwd -P`'d directory instead,
  and make sure any other gate in the same code path (e.g. a freshness/staleness check) is
  actually exercised (give it a fresh timestamp) rather than accidentally supplying a
  redundant always-true/false escape hatch that masks the very mutation you're trying to pin.

## Related Files

- `scripts/pg-lab/session-coord.sh` (`physical_path`, `target_paths`, `record_one`,
  `consult_match`)
- `.claude/hooks/test-session-coord-v2.sh` (the three pinned symlink-spelling cases and the
  `physical_path` mutant)
- `.claude/hooks/test-session-coord.sh` (Level 1 and the self-suppression fixture, migrated
  off literal `/tmp/...` onto a real `pwd -P`'d directory)

## See Also

- [A lexical prefix-match path guard is escapable via dot segments](lexical-prefix-path-guard-dot-segment-escape-2026-07-17.md) — a different class of path-guard defeat (`..` traversal, not spelling) in the same neighborhood of hooks
- [A worktree created nested inside another worktree silently defeats guard-worktree-isolation.sh's path arithmetic](nested-worktree-defeats-isolation-guard-path-math-2026-07-15.md) — another root-path-arithmetic bug, different trigger
