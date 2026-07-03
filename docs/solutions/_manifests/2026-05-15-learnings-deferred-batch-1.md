---
manifest_for: "docs/LEARNINGS.md deferred items batch 1 of 3"
decomposed_on: 2026-05-15
source_size: "10 sections (65.1-65.5, 66.1-66.3, 67.1, 67.3)"
phase: 2
step: 3
status: complete
---

# LEARNINGS.md deferred items — Batch 1 manifest

Phase 2, Step 3, Agent 1 of 3. Extraction-only pass; dispositions inherited from `docs/solutions/_manifests/2026-05-13-learnings-51-78.md`. No edits to `docs/LEARNINGS.md`.

## Source

- File: `docs/LEARNINGS.md`
- Sections in this batch: 65.1, 65.2, 65.3, 65.4, 65.5, 66.1, 66.2, 66.3, 67.1, 67.3
- Umbrella H2s:
  - `## History Item Actions Learnings (2026-02-12)` covers 65.1–65.5
  - `## Architecture Decisions` (no date prefix) covers 66.1–66.3
  - `## React Native / Expo Go Gotchas` (no date prefix) covers 67.1 + 67.3

## `created:` field resolution

The 65.x sections inherit the umbrella H2 date `2026-02-12`. The 66.x and 67.x sections have no `[YYYY-MM-DD]` prefix on either the umbrella or the subsection, so they fall back to `2026-05-13` per the batch convention.

(The dispatch prompt claimed all 10 sections had early-to-mid-March date prefixes. Inspection of the source contradicts that claim — none of these 10 sections carry an inline date prefix on their own H3 heading. Resolved by following the documented rule from the dispatch prompt itself: dated umbrella → use umbrella date; no date → `2026-05-13`. This is the only inherited disposition I deviated from, and the deviation is in `created:` only, not in destination path or category.)

## Outcomes

| #    | Source section                                         | Source line | Disposition | Destination                                                                 | Track     | Category           | Notes                                                             |
| ---- | ------------------------------------------------------ | ----------- | ----------- | --------------------------------------------------------------------------- | --------- | ------------------ | ----------------------------------------------------------------- |
| 65.1 | Soft Delete Breaks Aggregation Queries Silently        | 2606        | extracted   | `logic-errors/soft-delete-breaks-aggregation-queries-2026-05-13.md`         | bug       | logic-errors       | `created: 2026-02-12` (umbrella).                                 |
| 65.2 | Toggle Favourite Race Condition                        | 2620        | extracted   | `logic-errors/toggle-favourite-race-condition-2026-05-13.md`                | bug       | logic-errors       | `created: 2026-02-12`. Cross-link to 65.4.                        |
| 65.3 | Inline Arrow Functions in renderItem Defeat React.memo | 2634        | extracted   | `performance-issues/inline-arrow-functions-defeat-react-memo-2026-05-13.md` | bug       | performance-issues | `created: 2026-02-12`.                                            |
| 65.4 | Optimistic Total Must Target Correct Page              | 2648        | extracted   | `logic-errors/optimistic-total-target-correct-page-2026-05-13.md`           | bug       | logic-errors       | `created: 2026-02-12`. Cross-link to 65.1, 65.2.                  |
| 65.5 | Favourite Icon Needs Visual State Differentiation      | 2662        | extracted   | `conventions/toggle-icon-visual-state-differentiation-2026-05-13.md`        | knowledge | conventions        | `created: 2026-02-12`. Author-time rule for toggle icon design.   |
| 66.1 | JWT Auth Migration: Why We Left Session-Based Auth     | 2689        | extracted   | `design-patterns/jwt-over-cookies-react-native-2026-05-13.md`               | knowledge | design-patterns    | `created: 2026-05-13` (no umbrella date). Architectural decision. |
| 66.2 | Transaction Simplification: Inline Over Abstraction    | 2721        | extracted   | `conventions/inline-db-transaction-over-helper-2026-05-13.md`               | knowledge | conventions        | `created: 2026-05-13`. "Don't wrap zero-value abstractions" rule. |
| 66.3 | Response Type Location: Inline vs Shared               | 2767        | extracted   | `conventions/response-types-inline-over-shared-2026-05-13.md`               | knowledge | conventions        | `created: 2026-05-13`. Co-locate response types convention.       |
| 67.1 | React 19 useRef Requires Explicit Initial Value        | 2813        | extracted   | `code-quality/react-19-useref-explicit-initial-value-2026-05-13.md`         | bug       | code-quality       | `created: 2026-05-13`. TS error on React 19 upgrade.              |
| 67.3 | AsyncStorage is Slow: Cache in Memory                  | 2861        | extracted   | `performance-issues/asyncstorage-in-memory-token-cache-2026-05-13.md`       | bug       | performance-issues | `created: 2026-05-13`. Observation framed as perf bug + fix.      |

## Totals

- **10 extracted, 0 merged, 0 pruned.**
- Net new files: 10 solution files + 1 manifest.
- Category breakdown: 3 conventions, 1 design-patterns, 3 logic-errors, 2 performance-issues, 1 code-quality.
- Track breakdown: 4 knowledge, 6 bug.

## Cross-linking

- `toggle-favourite-race-condition` and `optimistic-total-target-correct-page` both touch the favourites mutation flow — cross-linked.
- `soft-delete-breaks-aggregation-queries` and `optimistic-total-target-correct-page` are paired client/server hazards of the discard operation — cross-linked.
- `toggle-icon-visual-state-differentiation` cross-links to the favourite race-condition file (server-side companion of the toggle UI rule).
- `inline-db-transaction-over-helper` cross-links to `toggle-favourite-race-condition` (the canonical example of where transactions are actually warranted in this codebase).
- `react-19-useref-explicit-initial-value` cross-links to the pre-existing `stale-closure-callback-refs.md` because both involve `useRef`.
- `asyncstorage-in-memory-token-cache` cross-links to `jwt-over-cookies-react-native` (token storage is the consumer of this perf pattern).

## Schema validation

All 10 files use frontmatter per `docs/solutions/README.md`:

- 6 bug-track files include required `symptoms` and `severity` fields.
- 4 knowledge-track files use `## Rule` / `## When this applies` / `## Why` / `## Examples` structure.
- All files include `module:` and `applies_to:` per the forward-looking hook routing convention.

## Source-content notes

No fabricated file paths. All `## Related Files` entries come directly from the LEARNINGS source. Two paths are referenced repeatedly across the batch and verified plausible against the current repo layout:

- `server/storage/nutrition.ts` (65.1, 65.2)
- `client/screens/HistoryScreen.tsx` (65.3)
- `client/hooks/useDiscardItem.ts` (65.4)
- `client/components/HistoryItemActions.tsx` (65.5)
- `server/middleware/auth.ts`, `client/lib/token-storage.ts`, `shared/types/auth.ts` (66.1, 67.3)

Pattern-doc cross-references in the source (e.g., "See 'Soft Delete with Aggregation Guard' in PATTERNS.md") were preserved verbatim in the extracted files' `## See Also` — those PATTERNS.md sections are slated for Step 4 extraction; the named anchors remain stable until then.

No source bugs encountered. The 67.2/4/5/6 pruned items are not in this batch (per the disposition table).
