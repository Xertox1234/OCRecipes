---
title: "A fail-closed assertion and the mutation row that 'proves' it can both be inert — one operand unreachable, one probe exiting before it arrives"
track: bug
category: code-quality
tags: [harness, hooks, testing, bash, safety-gate]
module: shared
applies_to: [".claude/hooks/*.sh", ".claude/hooks/test-*.sh", "scripts/**/*.sh"]
symptoms: ["A -z / -n assertion on a constant built by concatenation never fires", "A mutation probe returns empty output and is read as a pass", "A guard's self-test is green but the production operand it exercises is dead", "The mutation input exits at a fast-path filter before reaching the code under test"]
created: 2026-09-13
severity: medium
---

# A guard and its mutation test can both be inert while green

## Problem

A fail-closed assertion is added so a degraded definition cannot silently weaken a guard, and
a mutation row is added to prove the assertion is live. Both pass. Neither works.

Measured on `guard-outward-cli.sh`, 2026-09-13, two independent mechanisms in the same
five-line addition:

**1. The production operand was structurally unreachable.**

```bash
_OUT_GH_GLOBALS='(([[:space:]]+(-R…|--repo…|-[^[:space:]]+))|([[:space:]]*'"$_CMD_REDIR"'))*'
if [ -z "${_OUT_GH_GLOBALS:-}" ] || [ -z "${_CMD_REDIR:-}" ]; then
```

The value is a single-quoted literal concatenated with an expansion. It is ~100 bytes **even
when `$_CMD_REDIR` is the empty string**, so `-z` can never be true. The only live operand
was the second one — and its comment overclaimed what that operand protects: an empty
`_CMD_REDIR` costs the *redirect arm* alone, because the flag arms still match.

**2. The mutation probe never reached the code it mutated.**

The row emptied the constant in a copy of the hook and fed it `echo hello`. That command has
no gated needle, so the hook exits at its fast-path filter — hundreds of lines **before** the
constant is even defined. The probe returned empty output, which the row's `if` read as "no
deny" only by accident of how it was written; the same shape reads as a pass under a small
rewording. Re-run with `gh pr list`, which carries a needle, the assertion fired immediately.

## Symptoms

- An assertion added "so this can never regress silently" that no test can make fail.
- A mutation probe whose output is **empty** rather than a verdict, reported as a pass.
- A `-z`/`-n` test on a variable whose assignment includes any literal text.
- Green suite, green corpus, and a guard clause that does nothing.

## Root Cause

Both failures share one shape: **the check and the thing checked were never connected, and
nothing in the run distinguishes "passed" from "never ran".**

- For the operand: emptiness was assumed to be the failure mode of a *composed* value. The
  real failure mode is a **shape** change — an arm dropped, a class widened — which `-z`
  cannot see.
- For the probe: an input was chosen for being harmless rather than for reaching the code
  path. A guard's early-exit filters mean most inputs never arrive.

## Solution

**Assert the shape, and prove the probe arrives.**

```bash
# ask the grammar a BEHAVIOURAL question: fed a span that crosses a separator,
# does the narrow form match it WHOLE? The wide form does; a correct one cannot.
_OUT_GRANT_SPANS=no
for _p in ' -x;y' ' -R a;y' ' --repo a;y' ' -x&y' ' -x|y' ' -R a&y' ' --repo a|y'; do
  printf '%s' "$_p" | grep -qE "^${_OUT_GH_GLOBALS_GRANT}\$" && { _OUT_GRANT_SPANS=yes; break; }
done
if ! printf '%s' "$_OUT_GH_GLOBALS" | grep -qF -- '--repo' \
   || [ "$_OUT_GH_GLOBALS_GRANT" = "$_OUT_GH_GLOBALS" ] \
   || printf '%s' "$_OUT_GH_GLOBALS_GRANT" | grep -qF -- '|-[^[:space:]]+)' \
   || [ "$_OUT_GRANT_SPANS" = yes ] \
   || [ -z "${_CMD_REDIR:-}" ]; then
  deny "…lost its shape…"
fi
```

Each operand names a property that a real degradation removes: the wide form still carries its
`--repo` arm; the narrow form is **not** the wide form; the narrow form does **not** contain the
wide generic arm; the narrow form **cannot span a separator**; and `$_CMD_REDIR` is non-empty
(which costs the redirect arm — say that, not "every needle").

**THE OBVIOUS SPELLING OF OPERAND 2 AND 3 IS THE ONE THAT DOES NOT WORK**, and it is worth
writing down because it survived a review round before being caught. Requiring the narrow class
to appear *somewhere* in the grant form —

```bash
   || ! printf '%s' "$_OUT_GH_GLOBALS_GRANT" | grep -qF -- '[^[:space:];&|]+'   # INERT
```

— is satisfied by the constant's `-R` and `--repo` arms on their own, so the **generic** arm, the
one that carried the defect, can be reverted to the wide class with the assertion silent. Worse,
those two named arms are unreachable at the site being protected, because an earlier deny-shaped
check rejects any `-R`/`--repo` command before the grant cut runs — so the assertion was keying
on arms that can never be exercised there.

**COUNTING THE CLASS INSTEAD IS ALSO WRONG, IN THE OPPOSITE DIRECTION.** The next attempt
required the separator-safe class to appear once per arm. It shipped twice and failed twice:
first as `grep -c`, which counts matching *lines* — the constant is one line, so it returned 1
for every healthy value, fired on every command, and blocked the shell needed to repair it; then
as an occurrence count on the exact 11-byte class, which scores **zero** on a healthy but
*strictly narrower* definition — adding `(` and a backtick to the class, which is that file's own
documented next fix. A total count is gameable besides: pad one arm and the others can stay wide.

The shape that survives is **behavioural**. Do not describe the grammar; feed it an input that
must not match and check that it does not. That question stays correct under any narrowing,
reordering, or respelling of the class, because it asks about the property rather than the
spelling.

For the mutation row:

1. **Probe with an input that reaches the code under test**, and say in the comment why that
   input and not a simpler one.
2. Mutate the **shape**, matching what the assertion now checks — here, one row blanks the
   wide form and a second widens the narrow form back to the wide one, which is the actual
   regression the split exists to prevent.
3. Require a **specific** deny (match the reason text), so an unrelated fail-closed path
   cannot satisfy the row.

## Prevention

- A `-z` test on a variable whose assignment contains literal characters is almost always
  dead. Assert a property the value must *have*, not a length it cannot lose.
- For any probe against a guard, first establish that the input reaches the guard at all —
  the cheapest version is to run the unmutated hook on the same input and confirm it produces
  the ordinary verdict rather than silence.
- Treat **empty probe output as an error, not a result.** If a check's evidence is the absence
  of something, it needs a denominator: a paired input that MUST produce the opposite.

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — the shape assertion beside the two root-position constants
- `.claude/hooks/test-guard-outward-cli.sh` — `_mut_goc_says_deny` and its four rows, plus the separately-mechanised `_SEP_MUT` check for the sibling structural assertion

## See Also

- [a clean zero needs its denominator](a-control-that-runs-before-the-work-cannot-validate-it-2026-09-07.md)
- [a two-sided control can still agree with a broken predicate](a-two-sided-control-can-still-agree-with-a-broken-predicate-2026-09-12.md)
- [a pin records its value but must also record whether it is correct](a-pin-records-its-value-but-must-also-record-whether-it-is-correct-2026-09-13.md)
- [widening is safe on every deny read and a false grant at the one allow read](../logic-errors/widening-is-safe-on-every-deny-read-and-a-false-grant-at-the-one-allow-read-2026-09-13.md)
