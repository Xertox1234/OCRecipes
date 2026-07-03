---
title: OCR Character Corrections Must Be Context-Sensitive
track: bug
category: logic-errors
module: server
severity: medium
tags: [ocr, character-correction, regex, false-positives, nutrition-label]
symptoms: ['OCR replaces every uppercase S with 5, corrupting words like ''Sodium'' to ''5odium''', Label text is mangled outside numeric fields, Context-free character substitution applies globally]
applies_to: [server/services/ocr/**/*.ts]
created: '2026-04-07'
---

# OCR Character Corrections Must Be Context-Sensitive

## Problem

`fixOCRDigits` replaced every uppercase `S` with `5` unconditionally (`/S/g`). While `O→0` and `l→1` are reliable OCR shape-similarity corrections, `S→5` has a much higher false-positive rate when applied outside numeric contexts — every word starting with `S` becomes garbled.

## Symptoms

- Nutrition labels show `5odium` instead of `Sodium`
- Numeric values like `1S0` correctly become `150`, but everything else regresses
- Display values are wrong; downstream nutrient extraction fails because the keyword no longer matches

## Root Cause

OCR character corrections vary in confidence. Some shape-similarity errors are nearly certain (O vs 0 at any font size, l vs 1 in sans-serif fonts). Others — particularly S vs 5 — depend on font, scan quality, and crucially, the surrounding context. A global `/S/g` replacement assumes the correction is always desired; it isn't.

## Solution

Narrow to context-sensitive replacement using lookahead/lookbehind:

```javascript
// Before — unconditional replacement
text.replace(/S/g, "5");

// After — only when adjacent to a digit
text.replace(/(?<=\d)S|S(?=\d)/g, "5");
```

Result: `1S0` → `150` (correct), `Sodium` stays `Sodium` (correct), `S00` → `500` (correct, leading digit pattern), `SS` stays `SS` (correct, no digit context).

## Prevention

Triage OCR corrections by confidence level:

- **Very reliable** (apply broadly): `O→0`, `l→1`, `|→1`. Shape similarity is high; false-positive rate is low.
- **Context-dependent** (apply with lookahead/lookbehind): `S→5` only when adjacent to digits. Same for `B→8`, `Z→2`.
- **Dangerous** (do not apply globally): any correction that could affect label keywords. When in doubt, apply only inside known numeric fields after value extraction.

## Related Files

- `server/services/ocr/` — `fixOCRDigits` correction map
- Audit: 2026-04-07-full-2 finding L2

## See Also

- [OCR regex prefix line keyword conflict](./ocr-regex-prefix-line-keyword-conflict-2026-05-13.md)
- [OCR parser module contract](../design-patterns/ocr-parser-module-contract-2026-05-13.md)
