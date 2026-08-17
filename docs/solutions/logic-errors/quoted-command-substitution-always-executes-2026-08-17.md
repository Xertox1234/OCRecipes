---
title: "\$(...)/backtick command substitution always executes regardless of surrounding quotes — a quote-blanking or word-rendering scanner must not treat its contents as inert"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, false-negative]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A quote-aware command scanner blanks or neutralizes the CONTENTS of a double-quoted (or backtick) span uniformly, without special-casing $(...) or backtick substitution", "A dangerous command wrapped in ordinary double quotes as a command substitution (echo \"$(eas update ...)\") is silently treated as inert text/data by the scanner", "The identical unquoted command is correctly detected/denied, isolating the gap to quoting specifically, not a missing pattern"]
created: 2026-08-17
severity: critical
---

# \$(...)/backtick command substitution always executes regardless of quoting

## Problem

`.claude/hooks/lib/cmd-detect.sh`'s two quote-scanning renderers (`cmd_bare`,
`cmd_words`) treat the CONTENTS of a quoted span as inert data whenever they're inside
`"..."` (or backticks) — including when that content is itself a `$(...)` or backtick
command substitution. But bash ALWAYS executes `$(...)`/backticks, regardless of what
quoting surrounds them; quoting only affects how the substitution's OUTPUT is
word-split, never whether the substitution itself runs. A command like
`echo "$(eas update --branch preview --platform all)"` genuinely publishes a live OTA
update — and every guard keyed on this scanner's output missed it, because the scanner
collapsed the quoted span (substitution included) into an opaque, neutralized token.

## Symptoms

- `echo "$(eas update --branch preview --platform all)"` → the OTA-publish guard
  returns exit 0, no deny. The unquoted form (`eas update --branch preview
  --platform all`) is correctly denied by the same guard — proving the gap is
  specifically about the quoting, not a missing verb pattern.
- The same shape bypasses a `--admin` carve-out check (`echo "$(gh pr merge --admin
  42)"`), a mutating-HTTP-method check (`echo "$(gh api -X POST repos/o/r/merges)"`),
  and a PR-creation preflight-stamp gate (`echo "$(gh pr create --fill)"`) — the gap is
  in the shared scanning primitive, so it silently defeats every consumer.
- No exotic crafting is required — this is ordinary double-quote syntax, not an ANSI-C
  `$'...'` trick or a mid-word empty-quote split. Any user or agent who happens to wrap
  a command in `"$(...)"` for a completely unrelated reason (e.g. to capture its
  output) triggers the bypass as a side effect.

## Root Cause

Inside a quoted span, the scanner's `neutral()` character class (the set of characters
that get replaced with a placeholder rather than passed through) includes `(`, `)`,
backtick, and whitespace — the exact characters that make up a `$(...)`/backtick
substitution's syntax. The scanner has no concept of "this text, even though it's
inside quotes, is not DATA — it's a nested command that will execute." It treats
`"$(eas update ...)"` exactly like it would treat `"some literal string"`: opaque
content whose internal structure doesn't matter to the surrounding argv.

## Solution

**Not yet fixed** — filed as
`todos/P1-2026-08-17-quoted-command-substitution-inert.md` rather than patched
immediately, because the fix requires a genuine design decision, not a narrow
character-class tweak:

- (a) special-case `$(...)`/backtick spans so their CONTENTS are still scanned by the
  per-hook matchers even when the span itself is quoted (recursing the scanner into
  the substitution), or
- (b) treat ANY command containing `$(...)`/backtick as automatically triggering the
  fail-closed/crude-smell-test path regardless of what's inside, or
- (c) adopt a different detection mechanism for this class entirely (see Prevention).

A rushed fix here risks the same failure mode this whole file's commit history already
demonstrates six times over: patching one specific crafted input without verifying the
patch's OWN soundness against adjacent forms.

## Prevention

This is the concrete instance of a broader signal worth naming: when a hand-rolled
quote/escape scanner has accumulated MULTIPLE (this codebase: six) separate CRITICAL
bypass fixes across one review cycle, each closed by adding another special case to the
same state machine, treat that pattern itself as evidence the mechanism may be
undersized for the job — not just as "one more bug to patch." A real shell tokenizer
(delegating word-splitting/quoting/substitution semantics to bash's own parser, under
appropriate sandboxing) gets command-substitution-always-executes semantics for free,
closing this entire CLASS of bug rather than one variant per round. Evaluate that
option explicitly before adding a seventh special case.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_bare()`/`cmd_words()`, both share this gap.
- `.claude/hooks/guard-outward-cli.sh`, `.claude/hooks/pr-preflight-guard.sh` — the two
  live-blocking gates confirmed bypassable by this technique.
- `todos/P1-2026-08-17-quoted-command-substitution-inert.md` — the filed fix, including
  the open design question.

## See Also

- [Empty quote-span mid-word vs standalone](empty-quote-span-closing-check-needs-mid-word-vs-standalone-2026-08-17.md) — a sibling finding from the same review round, in the same scanner.
- [Occurrence-ambiguity guard applied selectively](occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md) — another sibling finding, same review round.
