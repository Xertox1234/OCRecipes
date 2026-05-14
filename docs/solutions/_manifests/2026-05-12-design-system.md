---
manifest_for: docs/patterns/design-system.md
decomposed_on: 2026-05-12
source_size: 266 lines, 7 subsections
phase: 2
step: 1
status: complete
---

# design-system.md → docs/solutions/ manifest

Phase 2, Step 1 of the pattern-codification refactor (see `docs/research/pattern-codification-alternatives.md`). This is the single-file proof-of-concept that validates the schema, file template, and manifest format before parallelizing across the top-5 fattest pattern files.

## Source

- File: `docs/patterns/design-system.md`
- Size: 266 lines, 7 `###` subsections, all knowledge-track
- Status after this decomposition: **retained in place** for now. Source-file retirement (move to `docs/legacy-patterns/` or delete) happens in Step 6 after the full migration.

## Outcomes

| #   | Source subsection                                  | Outcome   | Destination                                                                                                                                               | Track     | Category        | Rationale                                                                                                                 |
| --- | -------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Color Opacity Utility                              | extracted | [conventions/use-withopacity-for-color-opacity-2026-05-12.md](../conventions/use-withopacity-for-color-opacity-2026-05-12.md)                             | knowledge | conventions     | "Always use `withOpacity()` instead of hex concat" — utility-preference convention.                                       |
| 2   | Semantic Theme Values over Hardcoded Colors        | extracted | [conventions/use-theme-values-not-hardcoded-colors-2026-05-12.md](../conventions/use-theme-values-not-hardcoded-colors-2026-05-12.md)                     | knowledge | conventions     | "Always use `theme.X` instead of hardcoded hex" — same shape as #1.                                                       |
| 3   | Semantic BorderRadius Naming                       | extracted | [conventions/use-named-borderradius-not-magic-numbers-2026-05-12.md](../conventions/use-named-borderradius-not-magic-numbers-2026-05-12.md)               | knowledge | conventions     | "Always use `BorderRadius.X` instead of magic numbers / calculations."                                                    |
| 4   | WCAG Re-verification After Background Color Change | extracted | [best-practices/recheck-wcag-after-background-color-change-2026-05-12.md](../best-practices/recheck-wcag-after-background-color-change-2026-05-12.md)     | knowledge | best-practices  | Procedural checklist triggered by a specific change (background colour edit).                                             |
| 5   | FontFamily Constants Instead of fontWeight Strings | extracted | [conventions/use-fontfamily-constants-not-fontweight-strings-2026-05-12.md](../conventions/use-fontfamily-constants-not-fontweight-strings-2026-05-12.md) | knowledge | conventions     | "Always use `FontFamily.X` instead of `fontWeight: 'NNN'`" — same shape as #1–3, with concrete Android-only failure mode. |
| 6   | Dynamic Color Injection into Static StyleSheet     | extracted | [design-patterns/inject-theme-into-static-stylesheet-2026-05-12.md](../design-patterns/inject-theme-into-static-stylesheet-2026-05-12.md)                 | knowledge | design-patterns | Structural pattern: how to inject theme into a static stylesheet without restructuring.                                   |
| 7   | Shared Category Color Maps                         | extracted | [design-patterns/extract-shared-color-maps-to-constants-2026-05-12.md](../design-patterns/extract-shared-color-maps-to-constants-2026-05-12.md)           | knowledge | design-patterns | Reusable structural pattern for deduplicating `Record<string, string>` colour dictionaries.                               |

## Totals

- **7 extracted, 0 merged, 0 pruned.**
- Net new files: 7 solution files + 1 manifest + 0 README sections (README updated in place).

## Schema validation

`docs/solutions/README.md` was extended in this step. New fields and values added:

- **`track: bug | knowledge`** — required discriminator.
- **3 new category directories**: `conventions/`, `design-patterns/`, `best-practices/` (knowledge-track).
- **Conditional field requirements**: `symptoms` and `severity` are required for `track: bug`, optional for `track: knowledge`.
- **`applies_to: [glob, ...]`** — optional, forward-looking field for the Phase 3 hook rewrite.
- **Body template** documented in README with paired bug/knowledge section headings.

The existing 4 bug-track solution files were backfilled with `track: bug` to conform to the updated schema. No other changes to their content.

## Merge rubric validation

**Not exercised by this step.** With only 4 existing solution files on topics unrelated to the design system, no design-system subsection hit either ≥0.7 title-Jaccard or ≥0.7 tag-Jaccard threshold. The merge logic gets stressed in Step 2 (parallel decomposition of react-native, database, api, testing, security) where multiple files share topics like keyboard handling, query caching, and rate limiting.

Cross-links via `## See Also` were added inside each extracted file where related solutions exist — this is the lighter-weight surrogate for the merge path on this run.

## Prune rubric validation

**Not exercised by this step.** None of the 7 subsections hit any of the four prune clauses (stale reference, duplicates `docs/rules/`, restates library default, too narrow). `design-system.md` is small (266 lines), post-rebrand-curated, and entirely actionable; 0 prunes is the honest read. The prune path will be stressed by older content in the bigger pattern files.

## Verification

- All 7 destination files exist with `track: knowledge` frontmatter — verified by file system check.
- README.md updated with schema extension — verified inline.
- Existing 4 bug-track files backfilled with `track: bug` — verified by Edit confirmations.
- No changes to `.claude/hooks/inject-patterns.sh` or `.claude/skills/codify/SKILL.md` — to be confirmed via `git status` in the closing verification step.

## Step 1 → Step 2 handoff notes

Reading these into the next-session prompt for the parallel-subagent decomposition:

1. **Template stability confirmed** — knowledge-track items reuse the bug-track body shape with adapted section headings (`## Rule`, `## When this applies`, `## Why`, `## Examples`, `## Exceptions`). One template; the codify-skill rewrite in Step 4 doesn't need to branch on track.
2. **The 25–30% prune forecast in the todo is a corpus average, not a per-file rate.** Small post-rebrand files like `design-system.md` may yield 0 prunes; older files (`react-native.md` 3,869 lines, `database.md` 2,746 lines) will pull the average up. Step 2 subagents should not be coerced into hitting a quota.
3. **Category granularity is sufficient as-is for design-system content.** The 3 knowledge-track categories (`conventions/`, `design-patterns/`, `best-practices/`) cleanly absorbed all 7 subsections. Do not extend to compound-engineering's full 8-value enum until a Step 2 file genuinely demands a new bucket.
4. **`applies_to` glob field is being captured in every new file** even though no consumer reads it yet. This pays off when the Phase 3 hook rewrite ships — no backfill pass needed.
5. **Cross-linking via `## See Also`** is a low-cost stand-in for the merge path. When Step 2 produces topically-overlapping files, the merge rubric (title-Jaccard AND tag-Jaccard ≥ 0.7) gets its first real test.
6. **Naming convention:** `<slug>-<YYYY-MM-DD>.md` for all new files. The 4 pre-existing files keep their dateless names; backfill is deferred indefinitely.
