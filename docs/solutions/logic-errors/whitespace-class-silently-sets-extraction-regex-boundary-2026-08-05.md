---
title: "The whitespace class in an extraction regex silently sets its boundary — `\\S` cannot cross a space, `\\s` crosses lines"
track: bug
category: logic-errors
module: client
severity: high
tags: [regex, ocr, nutrition-label, parsing, mlkit, whitespace, tokenization]
symptoms: ["A field the recogniser read PERFECTLY parses as null", "A pattern only matches the glued unit form (`400mg`) and never the spaced one (`400 mg`)", "A field takes its value from one line and its unit from another", "A marketing badge on the line above supplies a panel value", "`confidence` is far lower than the label's legibility suggests"]
applies_to: ["client/lib/*-ocr-parser.ts", "client/lib/**/*parser*.ts", "server/services/ocr/**/*.ts"]
created: '2026-08-05'
---

# The whitespace class in an extraction regex silently sets its boundary

## Problem

An extraction regex of the shape `<name>\s+(<value>)\s*<unit>` encodes **two** boundary
decisions that are easy to make by accident, and they fail in opposite directions.

Both shipped simultaneously in `client/lib/nutrition-ocr-parser.ts` and were found on real
device captures (PRs #755, #757).

**Too strict — `\S` cannot cross a space.** Four field patterns used `(\S+?)mg`:

```js
sodium: /sodium\s+<?(\S+?)mg/i;
```

`\S` matches any *non-whitespace* character, so `\S+?` can never span the gap in
`Sodium 400 mg`. The unit had to be glued to the number. Canadian panels never print it that
way, so **sodium parsed as `null` on every bilingual label** — on text MLKit had read
perfectly. The pattern was not approximately right and failing at the margins; it was
structurally incapable of matching the common form.

**Too loose — `\s` matches newlines, and `g` matches a word's first letter.** The sibling
half of the same pattern let a field assemble itself from three different lines:

```
Trans            <- name, line 1
15               <- "value", line 2 (an orphaned %DV figure)
GLUTEN FREE      <- "unit": the G of GLUTEN, line 3
```

...yielding `transFat = 15`. Verified equivalents: `Fibres\n15\nGLUTEN FREE` → 15,
`LOW SODIUM\n30 mg` → 30, `LOW IN CHOLESTEROL\n5 mg` → 5.

## Symptoms

- A field visibly present and legible on the photo parses as `null`
- Only the glued unit form matches; the spaced form never does
- A value appears that exists nowhere on the same line as its field name
- Front-of-pack marketing copy supplies panel values

## Root Cause

OCR flattens an entire package into one string. The nutrition panel, the ingredients list,
the %DV column and the marketing badges all end up in the same blob, separated only by
`\n`. So in this domain `\s` is not "whitespace" — it is **"whitespace, plus permission to
leave this line"**, and that permission is invisible at the call site.

`\S` carries the mirror-image trap: it is not "the value", it is **"the value, and it may
not contain a space"**.

Neither pattern states its boundary in words; both encode it in a character class chosen for
a different reason.

## Solution

State each boundary explicitly.

```js
// Value may be spaced from its unit; name, value and unit must share ONE line.
sodium: /sodium[ \t]+<?(\S+?)\s*mg/i,

// Gram unit must be a unit, not the first letter of the next word.
totalFat: /(?:total\s+fat|…)[ \t]+<?(\S+?)\s*g(?![a-zà-ÿ])/i,
```

- `[ \t]+` before the value — horizontal whitespace only, so the name and value share a line
- `\s*` before the unit — the value may be spaced from its unit
- `(?![a-zà-ÿ])` after `g` — `g` is a unit, not the start of `GLUTEN` / `Gras` / `grams`

Apply the same-line rule to **every** field, including the one that gates everything
downstream. Here that is `calories`: a value bled from a `REDUCED CALORIES` badge would
override the product database with a marketing number.

**`[ \t]` does not match U+00A0.** If the recogniser ever emits a non-breaking space the
field drops. Verify against real captures (three here contained no non-ASCII whitespace); if
that changes, `[^\S\r\n]` is "horizontal whitespace" including Unicode spaces while still
excluding line terminators.

## Prevention

- Requiring one line **can only cost recall, never correctness**. A field that fails to parse
  falls back to the database *and* raises a visible notice; a field assembled from three
  lines is silently wrong. Prefer the failure that announces itself.
- When a pattern family is extended, upgrade **all** members. Six of ten patterns here had
  been modernised and four had not; the four stale ones were the four that failed.
- Test with a **verbatim device capture**, not a hand-written idealisation. Every defect above
  is invisible in clean fixtures — the real captures carry `GLUTEN FREE` badges and orphaned
  number-only lines a few lines from the panel, which is exactly what the loose pattern ate.
- Assert the *negative*: that a disclaimer or badge does **not** supply a value. A test pairing
  a claim with a value-free next line proves only that a claim with no adjacent number is
  ignored.

## Related Files

- `client/lib/nutrition-ocr-parser.ts` — `FIELD_PATTERNS`
- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — describe `fields must not assemble themselves across lines`

## See Also

- [alternation-fallback-fires-before-backtracking-to-primary](alternation-fallback-fires-before-backtracking-to-primary-2026-08-05.md) — the other regex defect in the same file, from the same review
- [ocr-regex-prefix-line-keyword-conflict](ocr-regex-prefix-line-keyword-conflict-2026-05-13.md) — a different cross-line hazard: a preceding line sharing the keyword wins first-match
- [../conventions/fixture-stops-guarding-when-its-defect-is-fixed](../conventions/fixture-stops-guarding-when-its-defect-is-fixed-2026-08-05.md) — why the fixtures for this work needed re-verifying after the fix
