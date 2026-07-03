---
title: OCR Regex Must Account for Prefix Lines Sharing Keywords
track: bug
category: logic-errors
module: server
severity: high
tags: [ocr, regex, nutrition-label, parsing, fda-format]
symptoms: [Parser captures 'from' as the calorie value on pre-2020 US labels, '`parseFloat(''from'')` returns `NaN`, calorie count silently becomes `null`', First match in `String.match()` wins — wrong line ahead of the real one]
applies_to: [server/services/ocr/**/*.ts]
created: '2026-04-07'
---

# OCR Regex Must Account for Prefix Lines Sharing Keywords

## Problem

The nutrition OCR parser's calories regex `/calories\s+<?(\S+)/i` matched "Calories from Fat 90" before "Calories 250" on pre-2020 US nutrition labels. Since `String.match()` returns the first match, the actual calorie count was silently dropped — the capture group held `"from"`, `parseFloat("from")` returned `NaN`, and the field was stored as `null`.

## Symptoms

- Pre-2020 FDA-format scans produce nutrition records with `null` calories
- Current-format labels work; the bug is invisible until a vintage product appears
- The parser logs no error — `NaN` and `null` propagate quietly

## Root Cause

Pre-2020 FDA labels include "Calories from Fat" as a separate line _before_ the main "Calories" line. The regex had no way to distinguish between the two — both match `/calories\s+<?(\S+)/i` and the first occurrence wins.

## Solution

Negative lookahead excludes the "from" prefix:

```javascript
// Before — captures 'from' on pre-2020 labels
const re = /calories\s+<?(\S+)/i;

// After — skips 'Calories from ...' and matches the real Calories line
const re = /calories\s+(?!from\b)<?(\S+)/i;
```

The `\b` word boundary prevents the lookahead from over-matching on tokens like "fromage."

## Prevention

- When parsing structured text with line-by-line regex, check for real-world format variants where a keyword appears in multiple contexts.
- Negative lookaheads (`(?!...)`) exclude false matches without rewriting the whole pattern.
- For nutrition labels, always test with both pre-2020 and current FDA formats. Capture sample images of both during parser development.

## Related Files

- `server/services/ocr/` — nutrition-label parser
- Audit: 2026-04-07-full-2 finding M2

## See Also

- [OCR parser module contract](../design-patterns/ocr-parser-module-contract-2026-05-13.md)
- [OCR character corrections context-sensitive](./ocr-character-corrections-context-sensitive-2026-05-13.md)
