---
title: A comparison over a LOSSY projection of the value reports a false match
track: bug
category: logic-errors
module: shared
severity: medium
tags: [testing, verification, assertions, audit, diff, false-negative, harness]
applies_to: [scripts/**/*.ts, scripts/**/*.js, scripts/__tests__/**/*.test.ts, .claude/hooks/**/*.sh]
symptoms: [An inventory/diff script reports "identical" for inputs that visibly differ, A toContain/includes assertion passes against a mutant that produces the wrong value, A verification step reports full coverage while silently comparing only a prefix or substring, Review finds N changed items where the tool reported far fewer]
created: '2026-08-07'
---

# A comparison over a LOSSY projection of the value reports a false match

## Problem

A verification step compares a **reduced form** of the value — the first N characters, a substring,
a normalized key — instead of the value itself. Any difference living outside that projection is
invisible, so the tool answers "same" for inputs that differ. The tool passes; the check it was
written to perform never happened.

This is worse than no check, because the green result is *cited as evidence*.

## Symptoms

- A before/after inventory reports "IDENTICAL" or a suspiciously low change count.
- A `toContain(...)` / `includes(...)` assertion stays green when you deliberately break the value
  it claims to pin.
- A reviewer reading the same diff by hand finds several times more changes than the tool reported.

## Root Cause

Two instances from one session, same shape:

**1. Prefix-truncated key in a rule inventory.** A before/after audit of `docs/rules/*.md` keyed
each bullet on its first 72 characters:

```bash
key() { grep '^- ' | sed 's/^- //' | cut -c1-72 | tr -d '`*_'; }   # WRONG
diff <(git show "$BASE:$f" | key) <(key < "$f")
```

Reported `security.md` "2 bullets changed" and `accessibility.md` "IDENTICAL rule set". The real
numbers were **15 of 21** and **10 of 19** — every edit past character 72 fell outside the key.
The audit existed specifically to prove no binding rule was lost, so its blind spot was aimed
squarely at its own purpose.

**2. Substring assertion satisfied by an unrelated part of the message.** A test pinning a computed
headroom value:

```ts
const root = makeRepo({ "warm.md": 6000 });        // cap 6500 → headroom 500
expect(out).toContain("500 B");                    // WRONG
```

The same output line also prints `"...approaching the 6500 B cap..."`, and `"6500 B"` contains the
substring `"500 B"`. A mutant printing `", 999 B left"` still passed. The assertion never tested the
subtraction at all.

## Solution

Compare the **whole** value, and pick fixtures that cannot collide with surrounding text.

```bash
# Full-line, position-paired — a change anywhere in the line is visible.
while IFS= read -r old <&4 && IFS= read -r new <&3; do
  [ "$old" = "$new" ] && continue
  changed=$((changed + 1)); ...
done 4< "$before" 3< "$after"
```

```ts
// Fixture whose expected value shares no digits with anything else on the line,
// and an anchor that includes the surrounding punctuation.
const root = makeRepo({ "warm.md": 5900 });        // 6500 - 5900 = 600
expect(out).toContain(", 600 B left");
```

Then **mutate the source and confirm the check fails.** Both repairs above were verified by
reintroducing the exact bug and watching the suite go red — that is the only evidence that an
assertion tests what its name claims.

Cross-check a count with a second, independent method before publishing it:

```bash
diff <(git show origin/main:$f | grep '^- ') <(grep '^- ' $f) | grep -c '^<'
```

## Prevention

- A normalization step in a comparison (`cut`, `head -c`, truncation, a "key" function) is the
  thing to distrust first when a diff reports fewer changes than you expect.
- Prefer `toContain(", 600 B left")` over `toContain("600")` — anchor to punctuation so the match
  cannot land in an unrelated field.
- Choose fixture numbers that do not appear as substrings of constants printed on the same line.
- If a tool's output is going into a PR body as evidence, mutation-test the tool first.

## Related Files

- `scripts/__tests__/check-rules-file-size.test.ts` — the anchored-headroom assertion and its comment
- `docs/rules/security.md`, `docs/rules/accessibility.md` — the files the prefix-keyed inventory misreported

## See Also

- [A test comment must claim only what its own harness can observe](../code-quality/a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md) — the sibling case where the *comment*, not the assertion, overclaims
- [Probes that signal absence by empty output must also check the exit code](empty-probe-output-needs-exit-code-check-2026-07-02.md) — another false-negative verification shape
- [A verification that scans zero inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — same session, the other way a check can pass without checking
