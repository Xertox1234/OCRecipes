---
title: Calorie restriction regex missed 4-digit unsafe targets (1000–1199 kcal)
track: bug
category: logic-errors
module: server
severity: critical
tags: [safety-classifier, regex, ai-coaching, guardrails, numeric-ranges]
symptoms: [Coach safety guardrail allows '1000 calories a day' targets through, Regex catches 800-kcal targets but not 1100-kcal targets, parseInt < 1200 guard is correct but never reached for 4-digit values]
applies_to: [server/services/coach-intent-classifier.ts]
created: '2026-05-11'
---

# Calorie restriction regex missed 4-digit unsafe targets (1000–1199 kcal)

## Problem

The coach safety classifier used `\d{2,3}` to match calorie counts in patterns like "1000 calories a day." This quantifier matches 2–3 digits, so targets in the range 1000–1199 (four digits, but below the 1200 kcal safety threshold) were never captured. The downstream `parseInt < 1200` guard was correct — but the regex never reached it for these values.

## Symptoms

- User can request "I want to eat 1000 calories a day" and the safety classifier does not flag it
- Threshold logic exists in code but never fires for values that match its constraint
- Manual testing with 500/800 kcal passes; production users hit the 1000-1199 gap

## Root Cause

The regex quantifier `{2,3}` was sized for the most common unsafe range (under 1000 kcal) without accounting for the full digit-count range the safety threshold covered. The negative lookbehind `(?<!\d)` and lookahead `(?!\d)` correctly prevent mid-number matches, but they only run after the digit count clause has already failed.

## Solution

Change quantifier to `\d{2,4}`:

```javascript
// Before: misses 1000-1199
const CALORIE_RESTRICTION_RE = /(?<!\d)\d{2,3}\s*(?:cal|calorie|kcal)/i;

// After: covers full unsafe range
const CALORIE_RESTRICTION_RE = /(?<!\d)\d{2,4}\s*(?:cal|calorie|kcal)/i;
```

The negative lookbehind `(?<!\d)` and lookahead `(?!\d)` still prevent matching mid-number (e.g., "500" inside "1500"), so expanding to 4 digits doesn't create false positives on realistic calorie targets like "2000 cal/day."

## Prevention

Safety regexes that match numeric ranges must be validated against the full digit-count range they're meant to cover, not just representative examples. A regex that works for 500 and 800 doesn't automatically handle 1000–1199 if the quantifier is `{2,3}`. Add unit tests at the boundary values (`999`, `1000`, `1199`, `1200`).

## Related Files

- `server/services/coach-intent-classifier.ts` — `CALORIE_RESTRICTION_RE`

## See Also

- [Safety classifier regex gotchas](../conventions/safety-classifier-regex-gotchas-2026-05-13.md)
- [Safety regex exclude legitimate use](../conventions/safety-regex-exclude-legitimate-use-2026-05-13.md)
