---
title: "Arbitrary source text (mutant replacements, error messages) in a single-backtick markdown code span breaks the list or table — flatten, cut, and fence longer than any backtick run"
track: bug
category: logic-errors
module: shared
tags: [harness, testing, markdown, ci, job-summary]
applies_to: ["scripts/ci/**/*.mjs", "scripts/ci/**/*.ts"]
symptoms: ["A job-summary list item spills onto several lines", "Inline code renders as stray backticks for a value that contains backticks", "A table row splits into extra cells when an error message contains a pipe"]
created: 2026-10-01
severity: low
---

# Arbitrary source text in a single-backtick code span breaks the summary

## Problem

Lane F's job summary printed each surviving mutant as ``- line N: Mutator → `${replacement}` ``.
Stryker's `replacement` is arbitrary source text. On the first live run against
`server/lib/civil-date.ts`, two survivors broke the markdown:

- An `OptionalChaining` replacement spanned four lines, so the list item ran onto new lines.
- A `StringLiteral` replacement was an empty template literal, two backticks. Wrapped in
  single backticks it became ```` ```` ````, which CommonMark reads as one code-span delimiter.

The unit tests passed, because their fixtures used short, plain, single-line replacements.

## Root Cause

A CommonMark code span ends at the first backtick run whose length equals the opening run's
length. A one-backtick fence therefore cannot hold text that contains a backtick. Separately,
a newline inside a list item or a table cell ends that block element.

## Solution

Render any untrusted text through one helper (`inlineCode` in
`scripts/ci/mutation-on-diff.mjs`):

1. Flatten whitespace to single spaces (`text.replace(/\s+/g, " ").trim()`).
2. Return an explicit placeholder such as `(empty)` when nothing is left. An empty code span
   renders as literal backticks.
3. Cut to a fixed length (80 chars plus `…`).
4. Fence with one more backtick than the longest backtick run inside. When the text contains
   backticks, pad with one space on each side, which CommonMark strips:
   `` `{x}` `` becomes ```` `` `{x}` `` ````.

For a table cell, flatten and escape `|` as `\|`.

## Prevention

- Feed the renderer a fixture shaped like the worst real input: a multi-line value, a value
  that is or contains backticks, a value over the length cap, and an error with `|` and `\n`.
- Run the renderer once on real output before trusting it. The fixture gap here was invisible
  until a live run.

## Related Files

- `scripts/ci/mutation-on-diff.mjs`: `oneLine`, `inlineCode`, and the error-cell escape
- `scripts/__tests__/mutation-on-diff.test.ts`: "lists survivors by line, each on one line in safe inline code"

## See Also

- [../code-quality/a-split-inline-code-span-makes-prettier-indent-non-idempotent-2026-09-15.md](../code-quality/a-split-inline-code-span-makes-prettier-indent-non-idempotent-2026-09-15.md): a different code-span failure (prettier list indentation)
