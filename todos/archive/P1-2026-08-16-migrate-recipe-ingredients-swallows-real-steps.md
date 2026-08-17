---
title: "migrate-recipe-ingredients drops any instruction step that STARTS with a section-header word — partial, silent, irrecoverable"
status: done
priority: high
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [data-loss, scripts, migration]
github_issue:
---

# A step beginning "Cooking…" is indistinguishable from the header "Cooking:"

## Summary

`scripts/migrate-recipe-ingredients-utils.ts:157-164` filters out every instruction line
matching `/^(?:instructions|steps|preparation|cooking|directions)/i`. That is meant to strip
section HEADERS, but it equally strips a real recipe STEP that happens to begin with one of
those words — and the script writes the survivors straight over
`communityRecipes.instructions` with **no backup table**.

## Background

Verified on `main` 2026-08-16 by reading the filter and the caller, not inferred:

```ts
// scripts/migrate-recipe-ingredients-utils.ts:157-164
const instructionLines = stepsBlob
  .split("\n")
  .map(cleanInstructionLine)
  .filter(
    (line) =>
      line.length > 0 &&
      !/^(?:instructions|steps|preparation|cooking|directions)/i.test(line),
  );
```

Steps that a real recipe plausibly opens with, all silently deleted:

- `Cooking time is about 20 minutes — check at 15.`
- `Directions may vary by oven; start checking early.`
- `Preparation note: bring the butter to room temperature first.`
- `Steps 4 and 5 can be done a day ahead.`

**Why the existing guard does not cover it.** The file already carries a DATA-LOSS GUARD
directly below that filter, and it is a good one — but it only fires when the result is
**empty**, in which case the row is skipped. A _partial_ loss (one real step of five removed)
leaves a non-empty array, passes the guard, and commits. `scripts/migrate-recipe-ingredients.ts:12`
states plainly that the script "creates NO backup table and its write REPLACES both" fields,
so the original prose is gone.

The same shape exists one block up at `:150` for `/^ingredients/i` and should be assessed with it.

The severity here is _not_ the regex being wrong in isolation — it is the combination:
**partial + silent + irrecoverable**. The guard proves the author already understood the
irrecoverability; this is the case it does not reach.

## Acceptance Criteria

- [x] A line is only treated as a section HEADER when it is header-SHAPED, not merely
      header-prefixed. At minimum require the line to be (a) the whole line, optionally with a
      trailing colon, and (b) short — a header is `Directions:` or `Directions`, never
      `Directions may vary by oven; start checking early.`
- [x] Verified RED first with an in-test fixture whose steps begin with each of the five
      words, asserting they SURVIVE — and confirm the assertion fails against the current
      regex before the fix
- [x] The `^ingredients` filter at `:150` gets the same treatment or an explicit written
      reason it does not need it
- [x] A step that is genuinely just a header (`Directions:`) is still dropped — pin both
      directions, per `docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md`
- [x] Consider making a partial-loss case loud: if the filter removes any line from a row,
      report it in the dry-run summary so an operator can eyeball it before `--commit`
- [x] Closes with zero follow-ups

## Implementation Notes

- Tests live at `scripts/__tests__/migrate-recipe-ingredients-utils.test.ts` — the leaf is
  already DB-free and imported directly, so no database is needed for any of this.
- Do NOT weaken the empty-result guard while touching this; it is the reason a total loss has
  never shipped.
- Worth checking whether `scripts/migrate-instructions.ts` (which DOES keep a backup table)
  shares the filter; if it does, its risk is recoverable and its fix is less urgent.

## Scope Contract

- **Mechanisms to use:** the existing pure-function leaf + its existing Vitest file — no new
  script, no new backup mechanism, no schema change
- **Files in scope:** `scripts/migrate-recipe-ingredients-utils.ts`,
  `scripts/__tests__/migrate-recipe-ingredients-utils.test.ts`, and
  `scripts/migrate-recipe-ingredients.ts` only if the dry-run summary line is added
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- **Over-correcting into the other failure.** A stricter header test will let some genuine
  headers through into the steps array. That is the SAFE direction (a stray "Directions:" line
  in a recipe is cosmetic; a deleted step is not) — say so in the code comment so a later
  reader does not "fix" it back.
- Real production rows may already have been migrated with steps missing. This todo does not
  attempt recovery; if that matters, it is a separate investigation and there is no backup.

## Updates

### 2026-08-16

- Filed at the user's request after being surfaced (and deliberately not auto-filed) during
  the #833–#848 review round. Filter, caller, and the "no backup table" claim all verified
  against `main` before filing.
- Implemented, reviewed, and closed same day. Both `STEPS_HEADER_LINE_RE` and
  `INGREDIENTS_HEADER_LINE_RE` now anchor whole-line (optionally `:`), matching the
  `client/lib/menu-ocr-parser.ts` `SECTION_HEADER_RE` precedent. Two review rounds
  (`code-reviewer` + `server-reviewer`) surfaced two additional CRITICALs in the same file,
  fixed in-round (in scope per the Scope Contract — same file, no new mechanism):
  - The section-boundary locator regexes (`ingredientMatch`/`stepsMatch`) were unanchored
    substring matches — a header word appearing mid-line in real content (e.g. "cooking" in
    "2 tbsp oil for cooking") could hijack the split, truncating ingredients and
    misclassifying the remainder as steps. Fixed by anchoring both to a line start (`^` + `m`,
    with `[ \t]*` and an optional numbered-list prefix so indented/numbered headers — Pattern
    C — still match).
  - `cleanInstructionLine`'s destructive bold-label strip reduced a step wrapped ENTIRELY in
    bold with no colon-terminated label (e.g. `"**Press the tofu firmly...**"`) to `""`,
    vanishing with zero signal. Fixed with a non-destructive fallback, gated on the
    post-bullet/number intermediate (not raw) so a bare marker like `"1."` or `"-"` still
    correctly reduces to `""` and trips the empty-result data-loss guard, rather than reviving
    as fake instruction text.
  - `droppedHeaderLines` field added to `SplitResult`; the caller's dry-run summary reports
    any header-echo drop so an operator can eyeball a partial loss.
