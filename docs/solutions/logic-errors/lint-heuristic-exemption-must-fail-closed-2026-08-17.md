---
title: "A lint-heuristic exemption must fail closed — match only value forms that guarantee the exempting condition, on comment-stripped text"
track: bug
category: logic-errors
tags: [harness, testing, accessibility]
module: shared
applies_to: ["scripts/check-*.js", "scripts/**/*.js"]
symptoms: ["A pattern checker stops flagging an element that merely MENTIONS the exempting prop in a comment inside the opening tag", "A conditional prop value (prop={someVar}) is treated as the exempting condition even though it is sometimes false", "The exemption has tests only for its happy path — nothing proves a near-miss still fires"]
created: 2026-08-17
severity: medium
---

# A lint-heuristic exemption must fail closed — match only value forms that guarantee the exempting condition, on comment-stripped text

## Problem

Adding an exemption to a regex/substring lint heuristic with plain
`.includes("propName")` checks opens two silent bypasses, both PoC'd in review
of `scripts/check-accessibility.js`'s hidden-from-a11y-tree exemption:

1. **Comment bypass** — the raw JSX-element text these checkers scan includes
   comments inside the opening tag, so `// TODO: accessibilityElementsHidden…`
   satisfies the substring check and exempts a genuinely visible, unlabeled
   element.
2. **Conditional-value bypass** — `.includes()` cannot evaluate expressions, so
   `prop={isHidden}` (sometimes `false`) matches the same as the bare prop, and
   an element that is *sometimes visible and unlabeled* is exempted.

Unlike the checker's *detection* side — where a false positive is a visible
nag someone fixes — an exemption's false positive is an invisible hole: the
checker goes quiet on exactly the class of element it was built to catch.

## Symptoms

See frontmatter list. The tell during review: the exemption's predicate is
`text.includes(...)` while the exempting condition is really about the prop's
*value form*.

## Root Cause

The heuristic's input is raw source text, not an AST. Substring presence over
raw text conflates three different things — a prop with a guaranteed-truthy
value, a prop with a conditional value, and a mere textual mention — of which
only the first justifies the exemption.

## Solution

Constrain the match to value forms that *guarantee* the condition, over
comment-stripped text:

```js
const text = rawText
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
// bare prop or ={true} ONLY — a conditional {expr} keeps the requirement
/\baccessibilityElementsHidden(?![\w-])(?!\s*=(?!\s*\{\s*true\s*\}))/.test(text)
```

Over-stripping is safe by construction here: on the *exemption* side, a
mangled match can only re-require what the author wanted waived — it fails
closed. (The same stripping on the detection side would be fail-open; the
asymmetry is the point.)

## Prevention

- Every exemption ships with fail-closed tests: the exempt case passes, AND
  each near-miss (single prop, conditional value, comment-only mention) still
  fires. The happy-path test alone proves nothing about the hole.
- Apply the exemption uniformly to every sibling check it logically covers
  (`Pressable` AND `TouchableOpacity`) — see the selectively-applied-guard
  link below.

## Related Files

- `scripts/check-accessibility.js` — `isHiddenFromA11yTree`, the hardened exemption
- `scripts/__tests__/check-accessibility.test.ts` — the fail-closed test set

## See Also

- [A deny-gate flag-presence check needs RAW text and every spelling](deny-gate-flag-presence-check-needs-raw-text-and-every-spelling-2026-08-16.md) — the inverse asymmetry: there, quote-blanked text was the fail-open side
- [A guard applied to some sibling checks but not others is bypassable](occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md) — the uniformity half of the same review
- [A regex JSX-presence checker must resolve import alias bindings](../conventions/regex-jsx-checker-resolve-import-alias-bindings-2026-07-11.md) — sibling limitation of the same checker family
