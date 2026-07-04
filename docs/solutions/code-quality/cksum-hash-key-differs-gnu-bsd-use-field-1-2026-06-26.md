---
title: cksum hash key differs across GNU and BSD — use only field 1
track: bug
category: code-quality
module: shared
severity: medium
tags: [shell, portability, cksum, hashing, hooks, macos, linux, temp-dir]
symptoms: [A shell hook/script that hashes a string into a temp-dir or cache-dir name resolves to a DIFFERENT directory on two runs of the same input, 'Per-key state (lease files, caches) silently fails to line up / piles up as orphans on a machine that has both BSD and GNU coreutils on PATH', A hermetic test that recomputes the same key as the script under test disagrees with it]
applies_to: [.claude/hooks/**/*.sh, scripts/**/*.sh]
created: '2026-06-26'
---

# cksum hash key differs across GNU and BSD — use only field 1

## Problem

`cksum` is a convenient POSIX-everywhere way to turn an arbitrary string (e.g. a
filesystem path) into a stable numeric key for a temp/cache directory name — no
`md5`/`shasum` dependency needed. But its **stdout format is not byte-identical**
across implementations, so folding the *whole line* into the key yields different
keys per toolchain for the same input:

```sh
# BSD (macOS /usr/bin/cksum):
printf '/some/path' | cksum            # => "3814292528 8"
# GNU coreutils (Linux, or Homebrew `gcksum`/a coreutils-shadowed cksum):
printf '/some/path' | cksum            # => "3814292528 8 -"   # trailing " -" for stdin

# The non-portable fold (collapses the byte-count AND the trailing field into the key):
printf '/some/path' | cksum | tr -d ' \t' | cut -c1-20
#   BSD  => "381429252880"
#   GNU  => "381429252880-"            # different string → different dir
```

The checksum number itself (field 1) is identical across both — only the trailing
fields differ. Any consumer that keys state on the full line will, on a host where
both toolchains are reachable (a dev installs `coreutils` via Homebrew), compute a
key that doesn't match what a sibling process / hermetic test computed.

## Symptoms

- A per-key temp dir (lease, lock, cache) doesn't line up between two invocations
  or between a script and its test, with no obvious cause.
- Orphan state dirs accumulate under `/tmp` because the "same" input keeps hashing
  to slightly different names.

## Root Cause

GNU coreutils `cksum` appends ` -` (a literal filename column for stdin) that BSD
`cksum` omits, and the second column (byte count) varies with input length. Using
`tr`/`cut` over the whole line bakes those volatile, implementation-specific fields
into the key. The checksum (field 1) is the only portable, input-determined part.

## Solution

Take **only field 1** — the checksum number:

```sh
KEY=$(printf '%s' "$INPUT" | cksum | awk '{print $1}')
```

`awk '{print $1}'` (or `cut -d' ' -f1`) discards the byte-count and the
stdin/filename column, so the key is identical on BSD and GNU. Both the producer
and any hermetic test that recomputes the key must use the **same** extraction.

## Prevention

- When hashing a string for a directory/file name in shell, never consume the
  whole `cksum` line — extract field 1 only.
- In the hermetic self-test, derive the key with the *exact same* pipeline as the
  script (copy the one-liner), so a future change to the extraction can't silently
  desync test and code.
- This is one of a family of "BSD vs GNU coreutils differ" footguns (`sed -i`,
  `date`, `find -printf`, `stat`, `readlink -f`); prefer the POSIX-portable subset
  or branch on the tool when writing scripts that run on both macOS and Linux/CI.

## Related Files

- The original in-repo example — `guard-concurrent-session.sh`, which keyed a
  per-working-tree lease dir under /tmp on `cksum` of `git rev-parse --show-toplevel`
  using the field-1 form — was removed in the 2026-07-03 drift-family hook consolidation.
  No other file currently uses `cksum`, so the pattern is preserved inline in the
  `## Solution` section above.
- Scope is unchanged from the `applies_to` frontmatter: any shell hook or script that
  hashes a string into a temp/cache directory name.

## See Also

- [inherited GIT_DIR overrides git -C in hook self-tests](../logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md) — sibling hook-tooling/git-churn lesson from the same P2 work.
