---
title: "A regex meant to identify a line as a section header must be whole-line-shaped, not merely prefix- or substring-matched"
track: bug
category: logic-errors
tags: [harness, testing, typescript, regex, data-loss, migration-script, section-header]
module: shared
severity: high
symptoms: ["A per-line filter meant to strip section headers ('Instructions:', 'Directions:') also strips a real content line that merely BEGINS with the header word (e.g. 'Cooking time is about 20 minutes')", "A section-boundary locator regex finds the header word as an unanchored substring anywhere in the blob, letting real content mid-line (e.g. an ingredient line ending in a word like 'cooking') hijack the split", "A destructive (non-capturing) strip meant to discard a labelled prefix (e.g. '**Step 1:**') also consumes an entire line that has no label/body delimiter, reducing real content to an empty string with zero signal", "The existing empty-result data-loss guard never fires because the corrupted result is non-empty — the loss is partial, not total"]
applies_to: [scripts/migrate-recipe-ingredients*.ts]
created: 2026-08-16
---

# A regex meant to identify a line as a section header must be whole-line-shaped, not merely prefix- or substring-matched

## Problem

`scripts/migrate-recipe-ingredients.ts` migrates community-recipe rows whose ingredient
list is embedded in the `instructions` array, splitting on "Ingredients:"/"Instructions:"
markers and writing the split result straight over both columns with **no backup table**
— a bad split is unrecoverable. Three independent regexes in the split leaf
(`scripts/migrate-recipe-ingredients-utils.ts`) were each written to recognize "this
line/span IS a section header/label" but were actually only prefix- or substring-matches,
so each one had a distinct way of consuming real recipe content instead of noise. All
three were found by *running* a constructed input, not by reading the code — none was
caught by the existing test suite, which only exercised inputs the author had imagined.

## Symptoms

- A per-line filter meant to strip section headers ("Instructions:", "Directions:") also
  strips a real content line that merely BEGINS with the header word (e.g. "Cooking time
  is about 20 minutes — check at 15.").
- A section-boundary locator regex finds the header word as an unanchored substring
  anywhere in the blob, letting real content mid-line (e.g. an ingredient line ending in
  "...for cooking") hijack the split — truncating one section and misclassifying the
  remainder into the other.
- A destructive (non-capturing) label-strip meant to discard a "**Label:**" prefix also
  consumes an entire line that has no label/body delimiter, reducing real content to an
  empty string with zero signal.
- The existing empty-result data-loss guard never fires for any of these, because the
  guard only tests for a fully-empty result — the loss is partial (one line dropped from
  five), not total.

## Root Cause

Each regex answered a narrower question than the one it was actually asked. "Does this
line/span **start with** the header word" (`/^header/i`, no end anchor) and "does the
header word **appear anywhere** in this blob" (unanchored `.match()`) are both weaker
predicates than "**IS** this line, in its entirety, the header" — and every one of the
three regexes here used one of the two weaker forms while intending to answer the
stronger question.

The most common failure shape (per-line filter, boundary locator) is a **missing
`$`/`^` anchor**: a prefix match consumes any line beginning with the target word, and a
`.match()` with no `^`+`m` anchor finds the target substring at any offset in the string,
not only at a line's actual start. The third shape (the label strip) is a **greedy
consume-to-end match with no delimiter requirement**: `^\*{1,2}[^*]+\*{1,2}:?\s*` intends
"strip a bold LABEL, keep the body," but nothing in the pattern actually requires a
label/body delimiter (a colon) to exist — a step wrapped entirely in bold with no colon
matches the same pattern end-to-end and is consumed whole, with no distinguishable
"label" left behind.

A general project precedent for the correct shape already existed in the same repo:
`client/lib/menu-ocr-parser.ts`'s
`SECTION_HEADER_RE = /^(menu|appetizers?|...)\s*$/i` anchors both ends, admitting only
whitespace between the keyword and the line end. None of the three regexes fixed here
followed that shape before this fix.

## Solution

1. **Per-line header filter**: anchor both ends. `/^(?:instructions|steps|...)/i` →
   `/^(?:instructions|steps|...):?\s*$/i` — the whole line, optionally with a trailing
   colon, is the header; anything with real content after the keyword is not.
2. **Section-boundary locator**: anchor to a real line start with the multiline flag, not
   merely "found somewhere in the string." `blob.match(/(?:...)\s*\n/i)` →
   `blob.match(/^[ \t]*(?:...)\s*\n/im)`. Two coverage traps to check for when doing this:
   - **Don't lose legitimate leading whitespace or list-numbering on the header itself**
     — a naive `^` anchor also stops matching an indented header line
     (`"  Instructions:"`) or a numbered one (`"1. **Instructions**:"`, a documented
     storage pattern in this codebase). Tolerate both explicitly:
     `^[ \t]*(?:\d+[.)]\s*)?...`.
   - **`^` with the `m` flag on a sliced substring is safe only when the slice always
     starts at a real line boundary.** Here `afterIngredients`/`stepsBlob` are always
     sliced immediately after a previous boundary match's own trailing `\n`, so position 0
     is guaranteed to be a real line start — say so in a comment, because it is not true
     in general for an arbitrary slice.
3. **Destructive label-strip**: require the thing that actually distinguishes "label"
   from "body" — here, the presence of the label/body delimiter — before treating a match
   as fully destructible. Where the pattern can't cleanly express that requirement (a
   regex alternation would have broken an already-passing test for the colon-inside-bold
   case), gate a **fallback** on the *intermediate value directly upstream of the
   destructive step*, not on the raw input: if the destructive strip consumed everything
   that was left over from the prior (non-destructive) steps, recover via a
   non-destructive unwrap instead of accepting the empty result.
   - **This gate is easy to get subtly wrong twice.** Gating the fallback on
     `raw.trim().length > 0` (the ORIGINAL input, not the intermediate) looks equivalent
     but isn't: a bare bullet/number marker with genuinely NO content (`"1."`, `"-"`) also
     reduces to `""` upstream of the destructive step — for entirely different, correct
     reasons — and gating on raw would "rescue" that bare marker as fake content too,
     defeating the very data-loss guard the whole fix exists to preserve. Gate on the
     value immediately before the destructive step, not on the original input.

## Prevention

- A regex meant to answer "IS this the whole thing" needs both anchors (`^...$`) or an
  explicit end condition — a prefix test (`^word`) and an unanchored substring test
  (`.match(/word/)`) both answer a **weaker** question and will match real content that
  merely contains or starts with the target.
- When anchoring a previously-unanchored locator/filter to close a false-positive hole,
  immediately re-check the **coverage** side: what previously-matching input class does
  the tighter anchor now silently reject? (Here: indented headers, numbered headers.)
  Both directions are found the same way — construct the specific input and run it, not
  by inspecting the regex.
- A destructive (non-capturing) replace is only safe when its match is gated on the
  delimiter that actually defines the construct it claims to consume (a label's colon,
  here). Absent that gate, add a safety fallback — but gate the fallback on the value
  **immediately upstream** of the destructive step, never on the original raw input two
  transformations back; an earlier, unrelated transformation may have already correctly
  reduced genuinely-empty input to `""`, and a raw-gated fallback cannot tell that apart
  from destroyed real content.
- **Construct the failing input and run it.** All three of these were found in code
  review by literally executing a constructed adversarial string through the function
  (`node -e '...'` or a Vitest fixture), never by reading the regex and reasoning about
  it. Two internal review passes on this exact file, done by reading, found none of them.

## Related Files

- `scripts/migrate-recipe-ingredients-utils.ts` —
  `STEPS_HEADER_LINE_RE`/`INGREDIENTS_HEADER_LINE_RE` (whole-line filter),
  `ingredientMatch`/`stepsMatch` (anchored boundary locator), `cleanInstructionLine`
  (gated fallback)
- `scripts/__tests__/migrate-recipe-ingredients-utils.test.ts` — the constructed-input
  regression tests for all three, plus the two-sided negative controls
- `client/lib/menu-ocr-parser.ts` — `SECTION_HEADER_RE`, the in-repo precedent for the
  correct whole-line-anchored shape

## See Also

- [A freshness guard implemented as an emptiness check passes for every partially-stale state](freshness-guard-as-emptiness-check-passes-when-partially-stale-2026-08-09.md) —
  sibling "boolean guard covers only one point of a continuous range" lesson from a
  different domain (PG Lab projection staleness, not this todo's regex precision); the
  two are complementary, not duplicates
- [Replacing a crude-but-TOTAL safety scanner with a smarter PARTIAL one regresses the gate where the partial model has a hole](partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md) —
  same "precision vs. safety" trade-off, opposite direction: there the crude version was
  the SAFE one (over-denies); here the crude prefix-match was the DANGEROUS one
  (over-deletes) — which side is safe depends on the domain's failure cost, not on which
  version is "smarter"
- [A gate test must be two-sided](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) —
  the two-sided-pin convention this fix's tests follow (survive AND still-drop, for each
  of the three regexes)
