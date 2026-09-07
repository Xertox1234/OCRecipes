---
title: "A test pin whose two outcomes a LATER pipeline stage normalises to the same string stays green under mutation — the row proves nothing"
track: bug
category: code-quality
tags: [harness, testing, security, shell-quoting]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A new assertion passes immediately and keeps passing when you delete the code it was written to cover", "Mutation testing reports a fix arm as NOT CAUGHT even though an assertion visibly names it", "A rendering function is tested through a wrapper that post-processes its output", "The expected value in a pin happens to be what BOTH the correct and the broken rendering collapse to"]
created: 2026-09-06
severity: medium
---

# A pin normalised by a later pipeline stage is a decoration

## Problem

A pin was written to prove that a guard's ANSI-C decoder cannot emit a byte that injects shell
syntax. It asserted the safe case and passed. Deleting the entire safe-character filter it
existed to cover left it **still green** — so it never covered anything:

```bash
van 'a decoded quote cannot inject syntax'  "echo \$'\x27'" 'echo x'
```

Caught only by mutation testing. Eight fix arms were mutated; seven turned their named
assertions red and this one reported `NOT CAUGHT`.

## Symptoms

- A brand-new assertion passes on the first run and never fails afterwards, including when the
  code under test is reverted.
- Mutation output says `NOT CAUGHT` for an arm that an assertion visibly names.
- The function under test is not called directly — its output is piped through another stage
  before the comparison.

## Root Cause

`cmd_words_vanished` ends by piping its output through `cmd_words`. The input
`echo $'\x27'` decodes to a lone `'` at the very END of the string:

- **With** the safe-character filter: the decoder emits the placeholder `x` → `echo x`.
- **Without** it: the decoder emits a literal `'` → `echo '` → `cmd_words` opens a quote span
  that never closes, swallows nothing (there is nothing after it), and renders `echo x` anyway.

Both branches reach the same string, so no expected value could have distinguished them. The
row was not *weakly* covering the filter; it was **structurally incapable** of covering it.

The general shape: **when the unit under test feeds a normalising stage, any input whose two
outcomes that stage collapses together is untestable through the wrapper.** The pin looks
maximally on-point — it names the exact hazard — which is precisely why it survives review.

## Solution

Choose an input the downstream stage CANNOT normalise. Here that means putting real content
*after* the decoded byte, so the unterminated span has something to swallow — which is also
the actual security consequence:

```bash
# Unfiltered, the decoded quote opens a span in cmd_words and the rest of the
# command collapses into ONE word (`echo xghxprxmergex42x`), losing the deny.
van 'a decoded quote cannot swallow the following command' \
  "echo \$'\x27' gh pr merge 42" 'echo x gh pr merge 42'
```

The replacement rows turned red under the same mutation, and the arm went from `NOT CAUGHT` to
4 named assertions red.

## Prevention

- **Mutation-test every new fix arm individually, and require a NAMED assertion to fail.** An
  aggregate "the suite goes red somewhere" is not evidence: it can go red for an unrelated row.
- When writing a pin for a unit that feeds another stage, ask *"what does the BROKEN version
  render for this exact input?"* before choosing the expected value. If the answer is the same
  string, the row is a decoration however well it is named.
- Prefer inputs where the hazard has an observable consequence (something is swallowed,
  something is manufactured) over inputs that only demonstrate the hazard's presence. The
  consequence is what a later stage cannot normalise away.
- A row added in the same change as the fix it covers is the highest-risk kind: it was written
  against a passing implementation, so nothing ever demonstrated it could fail.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_words_vanished`, whose awk output is piped through
  `cmd_words`; the normalising stage that hid the difference.
- `.claude/hooks/test-cmd-detect.sh` — the `van` helper and the replacement rows.

## See Also

- [A test that pins a deny REASON goes stale when a stricter branch fires first](../logic-errors/deny-reason-assertion-goes-stale-when-a-stricter-branch-fires-first-2026-09-03.md) — the same "assertion stops covering its mechanism" outcome from a different cause: a different branch answers first.
- [An uncontrolled ambient input makes the check agree with what it checks](../logic-errors/an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md) — a third route to a test that cannot fail.
- [A fast-path pre-filter's superset proof must be re-verified](../conventions/dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md) — the other lesson codified from this same change.
