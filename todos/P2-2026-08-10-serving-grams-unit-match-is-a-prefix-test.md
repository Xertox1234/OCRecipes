---
title: 'parseServingGrams matches a unit PREFIX, not a unit — "1 gallon" parses as 1 gram, "250 millilitres" is rejected'
status: backlog
priority: medium
created: 2026-08-10
updated: 2026-08-10
assignee:
labels: [deferred, api, nutrition, parsing]
github_issue:
---

# parseServingGrams matches a unit prefix, not a unit

## Summary

`parseServingGrams` (`server/services/barcode-lookup.ts:180`) matches
`(\d+\.?\d*)\s*(?:g|ml)` with **no word boundary**, so the alternation is a prefix
test. Any unit merely _beginning_ with `g` or `ml` parses as a mass, and a spelled-out
`millilitres` fails to parse at all. It is wrong in both directions.

## Background

Found by the `/code-review medium` pass on PR #794, which fixed the sibling defect
(`normalizeToPerHundredGrams` fabricating a per-100g basis). #794 swapped `parseFloat`
for `parseServingGrams` precisely because the latter "requires a g/ml unit" — that
premise is only partly true, so **#794 narrowed the hole rather than closing it**.

Measured against the committed regex, not inferred:

| input                                   | `parseServingGrams` | correct |
| --------------------------------------- | ------------------- | ------- |
| `"1 gallon"`                            | **1**               | reject  |
| `"2 glasses"`                           | **2**               | reject  |
| `"3 gummies"`                           | **3**               | reject  |
| `"1 grande"`                            | **1**               | reject  |
| `"250 millilitres"`                     | **null**            | 250     |
| `"100 grams"`                           | 100                 | 100 ✓   |
| `"30g"` / `"355 ml"` / `"1 cup (240g)"` | 30 / 355 / 240      | ✓       |

A `"1 gallon"` serving read as 1 gram drives a `100/1 = 100` scaling factor — the exact
100× inflation class #794 set out to eliminate.

**Latent today, same latency class as the bug #794 fixed.** All three nutrition
producers hardcode their serving strings (`"100g"`, `` `${n}g` ``), so nothing reaches
`normalizeToPerHundredGrams` with a `g`-prefixed non-mass unit. The **other two callers
are not so protected** — they parse live OpenFoodFacts `serving_size` values, which are
free text and absolutely can read `"1 gallon"` or `"250 millilitres"`.

### The one-character fix is a trap

Adding a bare `\b` (`(?:g|ml)\b`) fixes the first four rows and **regresses
`"100 grams"` from 100 to null**, because `g` followed by `r` is not a word boundary
either. Verified by running both regexes side by side. Do not ship that patch.

## Acceptance Criteria

- [ ] Characterisation tests for **current** `parseServingGrams` behaviour are written
      and committed **first**, covering each caller's real input shapes, so any
      behaviour change fails loudly rather than silently
- [ ] The unit match is anchored so a unit beginning with `g`/`ml` but continuing into
      another word is rejected — `"1 gallon"`, `"2 glasses"`, `"3 gummies"`,
      `"1 grande"` all return null
- [ ] Spelled-out units still parse: `"100 grams"` → 100, `"250 millilitres"` → 250,
      `"250 milliliters"` → 250 (US spelling)
- [ ] The three shapes #794's tests depend on are byte-identical: `"30g"` → 30,
      `"355 ml"` → 355, `"1 cup (240g)"` → 240
- [ ] A **two-sided mutation check** is recorded: reverting the anchor turns the new
      rejection tests RED while the characterisation tests stay GREEN
- [ ] All three call sites re-verified — `:483`, `:697` (both OFF `serving_size`), and
      `normalizeToPerHundredGrams` — with the OFF-path behaviour change stated
      explicitly in the PR body, since a previously-parsed value now returning null
      changes `servingGrams` and therefore `isServingDataTrusted`
- [ ] `docs/solutions/logic-errors/lenient-parser-makes-the-fallback-guard-unreachable-2026-08-10.md`
      updated — its "narrowed hole" section documents this gap and must be corrected
      once the gap is closed, or it will keep being injected as a live warning

## Implementation Notes

- Likely shape: an explicit alternation with an anchor, e.g.
  `(?:g|grams?|ml|millilitres?|milliliters?)\b`. Confirm against real OFF
  `serving_size` values before settling on the list — do not invent the vocabulary.
- Both branches of the function need the anchor. The parenthesised branch
  (`\((\d+\.?\d*)\s*(?:g|ml)\)`) is incidentally protected by the closing paren today,
  but should not rely on that.
- **Blast radius is 3 callers, all in `server/services/barcode-lookup.ts`** (confirmed
  via LSP `findReferences`, not grep): `:483`, `:697`, and the
  `normalizeToPerHundredGrams` call added by #794. The first two are the live ones.
- `:697` feeds `servingGrams`, which flows into the serving-correction block and
  `isServingDataTrusted` — the flag that drives the client's "Values shown per 100g"
  banner. A value going from parsed to null there is user-visible. Trace it.
- This is user-health-adjacent nutrition logic: **never delegate to a kimi-\* cheap
  worker**, and do NOT arm auto-merge on the resulting PR — every path is inside
  `scripts/todo-automerge-guard.sh`'s safe-path allowlist, so the guard alone will not
  hold it.

## Scope Contract

- **Mechanisms to use:** the existing regex in the existing function — no new parser,
  no new module, no shared-lib extraction
- **Files in scope:** `server/services/barcode-lookup.ts`,
  `server/services/__tests__/barcode-lookup*.test.ts`, and the solution doc named above
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #794 has landed the sibling fix; this is the residual it did not close.
- Related but independent: `coerceNumber` (`server/services/nutrition-lookup.ts:40-42`)
  maps a non-numeric **string** to `0` rather than failing the parse, so an API Ninjas
  `serving_size_g` arriving as a JSON string becomes `"0g"`. Different file, different
  defect; surfaced in #794's PR body and still unfiled by decision.

## Risks

- Tightening a parser is a **narrowing** change: anything the current regex accepts and
  the new one rejects becomes a null, and a null on the OFF path changes
  `isServingDataTrusted`. The characterisation tests are the safety net, not a
  formality — write them before touching the regex.
- Do not let the unit vocabulary grow speculatively. Every accepted spelling should be
  justified by a real OFF value, or the list becomes unfalsifiable.

## Updates

### 2026-08-10

- Filed from the `/code-review medium` pass on PR #794. The reviewer identified the
  missing word boundary; the proposed `\b` one-liner was measured and rejected because
  it regresses `"100 grams"`. Both directions of the defect verified by running the
  committed regex, not by reading it.
