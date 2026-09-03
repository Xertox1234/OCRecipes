---
title: "A test that pins a deny REASON goes stale when a stricter branch starts firing first — relaxing it turns the original mechanism's only coverage into a decoration"
track: bug
category: logic-errors
tags: [harness, security, testing, false-negative, review-process]
module: server
applies_to: [".claude/hooks/**", "scripts/**"]
symptoms: ["A gate test fails after an unrelated merge, but the gate still blocks the input it was written to block", "The assertion checks a specific deny MESSAGE, and a different, earlier, stricter branch now produces a different message for the same input", "Updating the expected string makes the suite green while leaving the mechanism the test was written for completely unexercised", "A mutation of the original mechanism no longer fails any test, even though the suite still contains a test named after it"]
created: 2026-09-03
last_updated: '2026-09-03'
severity: high
---

# A stale deny-reason assertion, and the wrong way to make it green

## Problem

`test-guard-outward-cli.sh` pinned a round-5 fix to a non-swallowing clause-cut with three
assertions of the form:

```bash
assert_deny "…decoy --auto via close-paren denies (round-5 fix, was a live FALSE ALLOW)" \
  "$(jsonc '$(gh pr merge 42)curl --auto')" "without a REAL --auto flag"
```

After an unrelated PR merged — one that made the occurrence count read a **deep**
substitution scan — all three failed. The input was still denied. It was denied *earlier*,
by a **stricter** branch: the deep scan sees the substitution's own contents as a second
command-position occurrence, so the ambiguity guard fires before the clause-cut is ever
reached (measured: deep-occurrence count = 2).

The tempting repair is to swap the expected string for the new one. It makes the suite
green in one line. **It also silently deletes the round-5 mechanism's only coverage** — the
clause-cut is now unreachable for every input in that block, so reverting the round-5
widening breaks nothing and the suite still contains three tests named after it.

That is the decoration failure `docs/rules/harness.md` names outright: *"If mutating the code
under test leaves the suite green, the test is a decoration — fix the claim rather than
adding a second decoration."*

## Root Cause

An `assert_deny` bundles two independent claims:

1. **the decision** — this input is blocked;
2. **the route** — it is blocked by *this* mechanism.

Only (1) is a stable property of the input. (2) is a property of branch *ordering*, and any
change that makes an earlier branch fire re-routes it without weakening anything. The
assertion's string argument silently encodes (2), so an ordering change reads as a failure
even though the security posture strictly improved.

## Solution

**Get ground truth first: does it still deny?** A failing gate test is not evidence of a
regression until you have run the input.

```bash
out=$(jq -nc --arg c "$INPUT" '{tool_name:"Bash",tool_input:{command:$c}}' | bash "$HOOK" 2>&1)
[ -z "$out" ] && echo "ALLOW — real regression" || printf 'DENY via: %s\n' "$out"
```

Here all three still denied, and the sanctioned positive control still ALLOWed — so the
interaction added no false positive either. Only then is it a test-expectation problem.

**Then split the two claims apart.** Update the re-routed tests to assert the reason that
now actually fires (documenting *why* it changed), **and** add inputs that still reach the
original mechanism. Reachability is found by construction, not assumed: the ambiguity branch
fires on a *second* occurrence, so any single-occurrence form with the same boundary
character still lands on the clause-cut:

```bash
# balanced -> deep scan extracts contents -> 2 occurrences -> ambiguity branch
'$(gh pr merge 42)curl --auto'
# UNBALANCED / non-substitution -> nothing extracted -> 1 occurrence -> clause-cut
'gh pr merge 42)curl --auto'      # bare close-paren
'gh pr merge 42`curl --auto'      # bare backtick
'(gh pr merge 42)curl --auto'     # plain subshell, not a substitution
```

**Prove the replacements bite, two-sided.** Reverting the widening must flip them:

```bash
cp "$HOOK" /tmp/backup
perl -i -pe "s/<widened class>/<original narrow class>/" "$HOOK"
# all four boundary inputs -> ALLOW   (the test would have caught the revert)
cp /tmp/backup "$HOOK"
# all four -> DENY                    (restored)
```

Measured for this fix: 4/4 flipped DENY→ALLOW under mutation and back. Suite went
274 passed/3 failed → **280 passed/0 failed** — three rewritten, three added, none removed.

## Prevention

- **Assert the decision; pin the route separately.** Where a helper supports it, prefer
  `assert_deny <input>` for the security claim plus one explicitly-named test for the
  mechanism. Bundling both into one string argument is what makes an ordering change look
  like a regression.
- **A newly-failing gate test has three possible causes, and only one is a bug**: the gate
  regressed (ALLOW — fix the code); the route changed (still DENY — fix the expectation AND
  restore mechanism coverage); the test was always wrong. Distinguish by running the input,
  never by reading the diff.
- **When a merge re-routes a test, the mechanism it abandoned is now uncovered until proven
  otherwise.** Before editing the assertion, ask whether *any* input still reaches it. If
  none does, the code is dead and should be deleted rather than left with tests that no
  longer touch it — see
  `docs/solutions/logic-errors/deletion-pass-must-prove-construct-can-be-empty-2026-09-02.md`.
- Never "fix" a red gate test by loosening it to a substring both messages share
  (`"guard-outward-cli"`). That passes for every deny AND every unrelated deny, which is
  strictly worse than the stale assertion it replaced.

## Related Files

- `.claude/hooks/test-guard-outward-cli.sh` — the `INTEGRATION 2026-09-03` blocks (re-routed
  assertions) and the single-occurrence block immediately after them (mechanism coverage).
- `.claude/hooks/guard-outward-cli.sh` — `_OUT_POS_SUFFIX_MERGE_CLAUSE`, the widened class.

## See Also

- `docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md`
- `docs/solutions/logic-errors/two-prs-rewriting-one-line-on-different-axes-2026-09-03.md`
- `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`
