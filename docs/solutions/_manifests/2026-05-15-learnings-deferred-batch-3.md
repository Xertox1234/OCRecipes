---
manifest_for: "docs/LEARNINGS.md deferred items batch 3 of 3"
decomposed_on: 2026-05-15
source_size: "8 sub-sections (64.5, 73.1, 73.2, 74.1, 74.3, 74.4, 75.1, 75.2)"
phase: 2
step: 3
status: complete
---

# LEARNINGS.md deferred extraction manifest — batch 3 of 3

## Source

`docs/LEARNINGS.md` deferred sub-sections from sections 64 (Phase 8-11 code-review roll-up), 73 (Data Processing roll-up), 74 (Testing & Tooling roll-up), and 75 (DB Migration roll-up). Each is a discrete sub-section within a themed roll-up.

## Outcomes

| #   | Source section | Source line | Disposition | Destination                                                                 | Track     | Category        | Notes                                            |
| --- | -------------- | ----------- | ----------- | --------------------------------------------------------------------------- | --------- | --------------- | ------------------------------------------------ |
| 1   | 64.5           | 2576        | extracted   | `best-practices/parallel-agent-shared-file-merge-conflicts-2026-05-13.md`   | knowledge | best-practices  | process learning about parallel agent workflows  |
| 2   | 73.1           | 3572        | extracted   | `logic-errors/longest-keyword-match-categorization-2026-05-13.md`           | bug       | logic-errors    |                                                  |
| 3   | 73.2           | 3608        | extracted   | `logic-errors/truthy-sentinel-default-bypasses-fallback-2026-05-13.md`      | bug       | logic-errors    |                                                  |
| 4   | 74.1           | 3634        | extracted   | `conventions/lazy-singleton-external-clients-test-import-2026-05-13.md`     | knowledge | conventions     | original of the recurrence learning seen in 63.4 |
| 5   | 74.3           | 3704        | extracted   | `design-patterns/dev-conditional-require-mock-vs-real-module-2026-05-13.md` | knowledge | design-patterns |                                                  |
| 6   | 74.4           | 3749        | extracted   | `design-patterns/mounted-ref-guard-async-hooks-2026-05-13.md`               | knowledge | design-patterns |                                                  |
| 7   | 75.1           | 3796        | extracted   | `runtime-errors/add-column-default-existing-rows-null-2026-05-13.md`        | bug       | runtime-errors  |                                                  |
| 8   | 75.2           | 3832        | extracted   | `logic-errors/nullable-fk-inner-join-drops-rows-2026-05-13.md`              | bug       | logic-errors    |                                                  |

## Totals

- Extracted: 8 files
- Pruned: 0
- Source corrections: 0

### Extracted by category

- best-practices (knowledge): 1
- logic-errors (bug): 3
- conventions (knowledge): 1
- design-patterns (knowledge): 2
- runtime-errors (bug): 1

Total: 8 files extracted.

## Source corrections

None identified during decomposition. Source content remains untouched (hard constraint: do not edit LEARNINGS.md).

## Cross-links established

- 4 → 5 (lazy singleton convention referenced by `__DEV__` conditional require design pattern, since both touch test-vs-production module loading)
- 5 → 4 (design pattern back-links convention)
- 7 → 8 (both DB migration gotchas; nullable column / null-aware query patterns)
- 8 → 7 (back-link)
