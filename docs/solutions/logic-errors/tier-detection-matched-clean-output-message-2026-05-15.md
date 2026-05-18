---
title: "Tier-detection grep matched the tool's own clean-output message"
track: bug
category: logic-errors
tags: [hooks, grep, code-review-gate, false-positive, parsing]
module: server
applies_to: [".claude/hooks/*.sh"]
symptoms:
  - "kimi-review pre-commit hook blocks a clean commit with a phantom CRITICAL"
  - "Blocked output's [CRITICAL] line is clean prose ('No critical issues found.'), not a path:line finding"
  - "A plain retry of the identical commit succeeds"
created: 2026-05-15
severity: low
---

# Tier-detection grep matched the tool's own clean-output message

## Problem

The Claude-Code kimi-review pre-commit hook (`.claude/hooks/kimi-review.sh`)
decides whether to block a commit by parsing `kimi-review`'s stdout. It got
this wrong three times, each failure a variation on the same theme — keying
detection on a _guess about the tool's clean-output wording_ instead of on the
shape of a real finding.

1. **Word-anywhere match.** `grep -Eq '(^|[^[:alnum:]_])CRITICAL([^[:alnum:]_]|$)'`
   matched the bare word `CRITICAL` anywhere — including the clean message
   `No findings in requested tiers: CRITICAL, WARNING` (the hook always passes
   `--tiers CRITICAL,WARNING`). Every clean review false-blocked.

2. **Bracket-tag-minus-prose match.** `grep '[[]CRITICAL[]].*[^[:space:]]'`
   then `grep -iv` for the literal phrase `no findings`. This assumed the clean
   line is always phrased `[CRITICAL] — No findings.`. It is not.

3. **The case this file now documents.** `kimi-review`'s system prompt tells
   the model to "omit any tier that has no findings" — but the model (DeepSeek
   V4 Flash) does not reliably obey. It instead emits a _bracketed placeholder_
   per tier with free-form prose: `[CRITICAL] No critical issues found.` The
   tool prints that line verbatim. The fix-2 exclude looked for `no findings`;
   the model wrote "No critical issues **found**" — different words — so the
   exclude missed and the commit was phantom-blocked again.

## Symptoms

- A clean commit is blocked with "kimi-review blocked the commit — CRITICAL
  finding present" while the review body explicitly says there are no issues.
- Retrying the identical commit "works" — the retry hits a differently-worded
  (or cached) review whose phrasing happens to elide the trigger, masking the
  bug as intermittent.

## Root Cause

The detection keyed on the tool's **clean-output phrasing** rather than on the
shape of a **real finding**. `kimi-review` instructs the model to format every
finding exactly as `[CRITICAL] path/to/file.ts:42 — description`, so a real
finding always carries a `:<line-number>`. But the _clean_ output is whatever
prose the model produces — and an LLM phrases "this tier is clean" an unbounded
number of ways ("No critical issues found", "No warning-level issues found",
"Nothing critical here"). No keyword or exclude-phrase can enumerate them all.
Fixes 1 and 2 both tried, and both collided with the tool's own status text.

## Solution

Stop trying to recognize the clean output. Match the **mandated finding shape**
positively — a `[CRITICAL]` tag followed on the same line by a `path:line`
reference. A clean placeholder (`[CRITICAL] No critical issues found.`) has no
`path:line`, so it simply cannot match, regardless of how the model phrases it:

```bash
# Before (fix 2) — bracket tag + body, then exclude the literal phrase "no findings"
grep -E '[[]CRITICAL[]].*[^[:space:]]' | grep -ivE '[[]CRITICAL[]][^[:alnum:]]*no findings'

# After — [CRITICAL] tag, then non-colon chars (the path), then ':' + a digit (the line)
grep -E '[[]CRITICAL[]][^:]*:[0-9]'
```

Deliberate choices:

- **Not anchored to line start.** An LLM may decorate a finding line
  (`- [CRITICAL] ...`, `**[CRITICAL]** ...`); a block/allow gate should fail
  closed on those, so the tag is matched anywhere.
- **`:[0-9]` is the discriminator.** It is part of the tool's mandated finding
  format and never appears in clean prose. A finding whose _description_ merely
  contains the words "no findings" still blocks, because the match keys on the
  line number, not the description text.
- **Trade-off: fail-open on a malformed finding.** A real finding that omits
  the line number would not block — accepted because it still surfaces in the
  hook's non-blocking `additionalContext`, and it matches the existing
  precedent that a bare `[CRITICAL]` tag does not block.

Use POSIX bracket-expression escaping (`[[]`, `[]]`) for the literal brackets —
backslash-escaped brackets in an ERE are a GNU extension, not portable to BSD
grep.

## Prevention

When a hook parses another tool's output to make a block/allow decision, match
the **structured shape of a real record**, not the absence of one. Recognizing
"this is a finding" is bounded — the tool defines the format. Recognizing "this
is _not_ a finding" is unbounded — especially when the output is LLM prose,
which has infinitely many ways to say "nothing here". Key on the positive
shape.

The deeper architectural fix lives in the tool, not the hook: `kimi-review`'s
filter loop counts _any_ `[TIER]` line as a finding, so a placeholder line
reaches the hook at all. Validating finding _shape_ (require a `path:line`)
inside the tool before it prints a `[TIER]` line would stop the placeholder at
the source. That is an out-of-repo change to `~/.local/bin/kimi-review`.

## Related Files

- `.claude/hooks/kimi-review.sh` — the pre-commit CRITICAL-detection gate
- `~/.local/bin/kimi-review` — out-of-repo tool; emits `[TIER] path:line — desc`
  finding lines and a `No findings in requested tiers: ...` clean message

## See Also

- `docs/solutions/logic-errors/calorie-restriction-regex-missed-4-digit-targets-2026-05-13.md`
  — another case of a regex validated only against representative samples
- `docs/solutions/best-practices/test-fixture-must-match-real-dependency-output-2026-05-15.md`
  — why the hook's existing test never caught this bug (its `clean` stub
  paraphrased the dependency's output)
