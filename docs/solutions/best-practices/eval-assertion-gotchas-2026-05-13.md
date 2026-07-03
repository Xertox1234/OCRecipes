---
title: 'Eval assertion gotchas: plural allergens, NaN, NANP false positives, image fixtures'
track: knowledge
category: best-practices
module: server
tags: [ai, evals, regex, assertions, numbers, images]
applies_to: [evals/datasets/**/*.json, evals/lib/**/*.ts]
created: '2026-05-13'
---

# Eval assertion gotchas: plural allergens, NaN, NANP false positives, image fixtures

## When this applies

When authoring eval datasets and assertions, several non-obvious traps silently produce false-pass results. Check each before merging a new case.

## Gotchas

### Always handle singular and plural allergens

In `mustNotContain` patterns for allergen safety assertions, use `\bword s?\b` (not `\bword\b`) to catch both singular and plural. `\begg\b` does NOT match "eggs" — a model returning "2 eggs" in a recipe for an egg-allergy user passes the assertion silently.

```json
// ❌ WRONG — "eggs" slips through
"mustNotContain": ["\\begg\\b|egg yolk|egg white|meringue"]

// ✅ CORRECT — catches "egg" and "eggs"
"mustNotContain": ["\\beggs?\\b|egg yolk|egg white|meringue"]
```

### `typeof NaN === "number"` — use `Number.isFinite()` for numeric range assertions

When checking `overallConfidenceMin` or `overallConfidenceMax` against a numeric field from `structuredData`, a simple `typeof value !== "number"` guard passes for `NaN` because `typeof NaN === "number"` is `true`. Every comparison with `NaN` evaluates to `false`, so `NaN` silently satisfies both min and max bounds:

```typescript
// ❌ NaN bypasses the assertion — typeof NaN === "number"
if (typeof d?.overallConfidence !== "number") { ... }

// ✅ Correct — Number.isFinite() rejects NaN and Infinity
if (typeof d?.overallConfidence !== "number" || !Number.isFinite(d.overallConfidence)) {
  failures.push("overallConfidenceMin assertion requires { overallConfidence: number }");
} else if (d.overallConfidence < assertions.overallConfidenceMin) { ... }
```

Apply this pattern to any numeric range assertion where the checked value originates from an external API response (where NaN is a realistic parsing failure mode).

### Eval image fixtures: use stable public URLs, keep out of `eval:all`

When an eval suite requires image inputs (e.g. photo-analysis), use stable public URLs (Unsplash, Wikimedia Commons) fetched at runtime rather than checked-in binary fixtures. The runner fetches → base64 at execution time:

```typescript
async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}
```

**Do NOT add image-URL suites to `eval:all`.** The `eval:all` chain is used in CI and local runs where external network uptime can't be guaranteed. Suites that depend on third-party image CDNs belong to a separate `eval:photo` (or similar) script that operators run intentionally.

### Unsplash photo IDs as NANP false positives in `check-eval-dataset-secrets.js`

Unsplash photo IDs that happen to be exactly 10 digits long match the secret-check script's NANP phone number pattern and block commits. Two approaches:

1. **Pick images whose IDs don't match NANP** (preferred): Unsplash IDs longer than 10 digits or containing non-digit characters pass cleanly. Check with: `node -e "console.log(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test('YOUR_ID') ? 'NANP match — pick another' : 'OK')"`.
2. **Add `"allowSecret": true`** on the same JSON line as the flagged URL (the script skips lines containing this string).

Run `node scripts/check-eval-dataset-secrets.js evals/datasets/your-new-cases.json` before staging to catch this before Husky does.

### Multi-signal eval cases: every active signal needs its own assertion

When a test case exercises more than one personalization or behavioral signal simultaneously, each signal must have an independent assertion. An assertion that covers only one signal leaves the other untested even though the case looks "combined."

```json
// ❌ INCOMPLETE — dismissed titles asserted, protein gap is not
{
  "id": "dismissed-plus-protein-gap-19",
  "input": {
    "dismissedTitles": ["Tofu Scramble", "Black Bean Bowl"],
    "remainingBudget": { "protein": 38, ... }
  },
  "assertions": {
    "mustNotContain": ["Tofu Scramble", "Black Bean Bowl"]
  }
}

// ✅ COMPLETE — both signals have assertions
{
  "assertions": {
    "mustNotContain": ["Tofu Scramble", "Black Bean Bowl"],
    "mustContain": ["chicken|salmon|beef|tuna|egg|turkey|shrimp"]
  }
}
```

**Rule:** When writing a combined test case, list the signals being exercised, then verify there is at least one assertion per signal before committing the case.

## Related Files

- `evals/datasets/*.json`
- `evals/lib/runner-core.ts` — numeric assertion helpers
- `scripts/check-eval-dataset-secrets.js` — NANP secret-check

## See Also

- [Eval dataset field forwarding rules](../conventions/eval-dataset-field-forwarding-rules-2026-05-13.md)
- [Validate eval JSON datasets as unit tests](eval-dataset-validation-as-unit-tests-2026-05-13.md)
