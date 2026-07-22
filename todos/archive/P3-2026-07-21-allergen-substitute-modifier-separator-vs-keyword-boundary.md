---
title: "Align plant-substitute-guard separator with keyword boundary for within-token joiners (almond/milk over-flags dairy)"
status: done
priority: low
created: 2026-07-21
updated: 2026-07-21
assignee:
labels: [deferred, allergen, safety, shared]
github_issue:
---

# Align plant-substitute-guard separator with keyword boundary for within-token joiners

## Summary

The plant-substitute suppression pattern (`getSubstituteModifierPattern`) uses a
narrower separator (`[\s\-]`) between the plant qualifier and the dairy/wheat
keyword than the keyword matcher (`getKeywordPattern`) uses for word boundaries
(`[\s,;/()\-]`). As a result a substitute written with a non-space/hyphen joiner —
e.g. `"almond/milk"`, `"oat(milk)"` — matches the dairy/wheat keyword but is NOT
suppressed, so it over-flags dairy/wheat.

## Background

Surfaced as a pre-existing observation during the `/code-review` of PR #687
(guard-safe dairy/wheat plurals). It is **not** introduced by that change — it
applies identically to the singular keywords (`"almond/milk"` over-flags today).

The current miss is in the **safe direction** (over-flagging a plant substitute as
dairy is a false positive, not a missed allergen), which is why it was deferred
rather than fixed inline — but it is a false positive on a user-facing safety flag,
which erodes trust, so it is worth a considered fix.

**The fix is NOT "just widen the separator to match the boundary set."** Separator
characters split into two semantic classes and conflating them would flip a safe
over-flag into a _dangerous_ under-flag:

- **Within-token joiners** — `/`, `-`, (and space) — join one compound substitute
  name: `"almond/milk"`, `"almond-milk"` are a single substitute → SHOULD suppress
  dairy. These are safe to add to the suppression separator.
- **Ingredient delimiters** — `,`, `;` — separate distinct list items:
  `"almond, milk"` is TWO ingredients (almond AND genuine milk) → milk MUST still
  flag. These MUST NOT be added to the suppression separator, or real dairy listed
  after a plant ingredient would be silently suppressed (fail-dangerous).
- Parentheses `(` `)` are ambiguous (`"milk (skim)"` vs `"creamer (oat)"`) — decide
  deliberately; when unsure, leave them out (over-flag is the safe default).

## Acceptance Criteria

- [ ] The suppression separator in `getSubstituteModifierPattern` includes the
      within-token joiners so `"almond/milk"` (and `"almond/milks"`, etc.) do NOT
      flag dairy/wheat — verified by new tests.
- [ ] **Ingredient delimiters stay excluded:** `"almond, milk"` / `"oat; wheat
    flour"` (two ingredients) MUST still flag the genuine dairy/wheat item. Add
      explicit assertions — this is the dangerous direction.
- [ ] **Additive-to-suppression only:** the change may only ADD suppression for
      genuine plant substitutes (remove over-flags), never remove a genuine
      dairy/wheat match. Real dairy/wheat staples still flag; full allergen
      regression suite green (both `detectAllergens` and `deriveRecipeAllergens`).
- [ ] Both single-word and plural guard-sensitive keywords covered (the separator
      is shared by all `MODIFIER_SENSITIVE_KEYWORDS` forms).
- [ ] `safety`-labeled → individual human review required; never auto-merge.

## Implementation Notes

- Separator: `getSubstituteModifierPattern` builds
  `(?:^|[\s,;/()\-])(?:<mods>)[\s\-]<keyword>(?:$|[\s,;/()\-])`
  (`shared/constants/allergens.ts:~761`). The inner `[\s\-]` is the join between
  qualifier and keyword — that is the token to widen (carefully, per the class
  split above), NOT the outer boundary groups.
- Keyword boundary for comparison: `getKeywordPattern`
  (`shared/constants/allergens.ts:~670`) — `(?:^|[\s,;/()\-])<kw>(?:$|[\s,;/()\-])`.
- Likely change: `[\s\-]` → `[\s/\-]` (add slash only), or `[\s/()\-]` if you decide
  parentheses should join. Do NOT add `,` or `;`.
- Add the invariant/behavioral tests alongside the existing
  `plant-substitute guard invariant` suite in
  `shared/constants/__tests__/allergens.test.ts`.

## Scope Contract

- **Mechanisms to use:** widen the existing suppression-separator character class in
  `getSubstituteModifierPattern`; no new matcher mechanism.
- **Files in scope:** `shared/constants/allergens.ts` and its test suite(s).
- **Out of scope:** the keyword-boundary set itself, the modifier list, the ingredient
  map, and any scan-flag/route/UI modules.
- No new abstractions beyond the separator-class change.

## Dependencies

- None. Independent of PR #687 (can start from `main` once #687 merges, or now).

## Risks

- **Under-flag via a delimiter promoted to a joiner** is the primary risk: adding `,`
  or `;` to the suppression separator would suppress genuine dairy listed after a
  plant ingredient (`"almond, milk"`). The explicit two-ingredient assertions are the
  mitigation — write them first (TDD), and confirm they are RED if `,` is ever added.

## Updates

### 2026-07-21

- Filed from the `/code-review` of PR #687. Pre-existing quirk (applies to singular
  keywords too), safe-direction over-flag, deferred as low-priority with the
  joiner-vs-delimiter design nuance captured up front.
- **RESOLVED as WON'T-FIX (with rationale + tests) — PR #688 OPEN (`safety`-labeled,
  individual review, NOT auto-merged).** First implemented slash-as-joiner
  (`[\s\-]` → `[\s/\-]`), then a `/code-review` self-review (finding #1) showed `/`
  is **ambiguous**: `"almond/milk"` reads as one substitute, but `/` is also a list /
  "and-or" delimiter (`"soy/milk"`, `"water/sugar/salt"`), so joining on it flipped
  `"soy/milk"` from flagged → suppressed = a **dangerous under-flag** (missed real
  milk). Suppression is the dangerous direction, so an ambiguous separator must
  over-flag — the same rule already applied to parens. **User chose "drop the slash
  (safest)."**
- Final PR: join stays `[\s\-]` (no behavior change vs main except escaping the
  keyword regex, finding #2, inert today); documents why `,`/`;`/`/`/parens are all
  excluded; tests lock the safe behavior (slash forms STILL flag = over-flag decision
  record; mutation-proven comma/semicolon fail-dangerous sentinel with NO-SPACE
  canaries `"almond,milk"`/`"oat;milk"`). Suite 64/0 green.
- The `"almond/milk"` over-flag is the **accepted safe default**. Archive to
  `todos/archive/` after merge; `/codify` the ambiguous-separator-must-over-flag +
  single-char-join-canary lessons.
