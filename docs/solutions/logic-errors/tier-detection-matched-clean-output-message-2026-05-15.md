---
title: "Tier-detection grep matched the tool's own clean-output message"
track: bug
category: logic-errors
tags: [hooks, grep, code-review-gate, false-positive, parsing]
module: server
applies_to: [".claude/hooks/*.sh"]
symptoms:
  - "kimi-review pre-commit hook blocks a clean commit with a phantom CRITICAL"
  - "Blocked output shows an empty [CRITICAL] body or the literal 'No CRITICAL or WARNING findings'"
  - "A plain retry of the identical commit succeeds"
created: 2026-05-15
severity: low
---

# Tier-detection grep matched the tool's own clean-output message

## Problem

The Claude-Code kimi-review pre-commit hook (`.claude/hooks/kimi-review.sh`)
decided "a CRITICAL finding is present" with a word-anywhere match:

```bash
grep -Eq '(^|[^[:alnum:]_])CRITICAL([^[:alnum:]_]|$)'
```

That regex matches the bare word `CRITICAL` anywhere in the review output. But
`kimi-review` itself prints the word `CRITICAL` in two non-finding situations:

- Its clean-output message: `No findings in requested tiers: CRITICAL, WARNING`
  — the hook always passes `--tiers CRITICAL,WARNING`, so this string always
  contains the word.
- The model's negative prose: `No CRITICAL or WARNING findings`.

So every clean review false-blocked the commit.

## Symptoms

- A docs-only or config-only commit is blocked with "kimi-review blocked the
  commit — CRITICAL finding present" while the review body says there are no
  findings.
- Retrying the identical commit "works" — the retry hits a cached review whose
  wording happens to elide the trigger, masking the bug as intermittent. It is
  actually deterministic for any clean review.

## Root Cause

The detection used a semantic word match instead of anchoring on the tool's
structured finding format. `kimi-review` emits every real finding as a line
that begins with a `[TIER]` tag (`[CRITICAL] path:line — description`). The
word `CRITICAL` also legitimately appears in tier-naming prose and in the
clean-output message — none of which are findings. A word-anywhere match
cannot distinguish a finding from the tool announcing which tiers it searched.

## Solution

Match the bracketed `[CRITICAL]` tag the tool uses for real findings, followed
by a non-empty body. The brackets are the discriminating signal — the clean
message and the negative phrasing contain the bare word `CRITICAL` but never the
bracketed tag:

```bash
# Before — matches the word anywhere, including "No findings in tiers: CRITICAL, WARNING"
grep -Eq '(^|[^[:alnum:]_])CRITICAL([^[:alnum:]_]|$)'

# After — the [CRITICAL] tag plus a non-space char (a finding body) after it
grep -Eq '[[]CRITICAL[]].*[^[:space:]]'
```

Two deliberate choices:

- **Not anchored to line start.** An LLM may decorate a finding line
  (`- [CRITICAL] ...`, `**[CRITICAL]** ...`); a block/allow gate should fail
  closed on those rather than let them through, so the tag is matched anywhere.
- **`.*[^[:space:]]` requires a body.** A bare `[CRITICAL]` tag with nothing
  after it is not a real finding and does not block.

Use POSIX bracket-expression escaping (`[[]`, `[]]`) for the literal brackets
rather than backslash escaping (`\[`, `\]`) — backslash-escaped brackets in an
ERE are a GNU extension and are not portable to BSD grep.

## Prevention

When a hook parses another tool's output to make a block/allow decision, match
the tool's **structured output format**, not a keyword. A keyword search will
collide with the tool's own status messages — especially messages that
enumerate the very categories being searched for ("no findings in tiers:
X, Y"). Anchor on the line shape the tool uses for real records. Always
sanity-check the detection against the tool's clean-output string, not just a
known-bad sample.

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
