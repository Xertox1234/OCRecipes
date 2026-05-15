---
manifest_for: "docs/LEARNINGS.md deferred items batch 2 of 3"
decomposed_on: 2026-05-15
source_size: "10 sub-sections (68.4, 68.5, 69(a), 69(b), 70.2, 70.3, 71, 72.2, 72.3, 72.4)"
phase: 2
step: 3
status: complete
---

# LEARNINGS.md deferred items batch 2 manifest

Phase 2 Step 3 execution-only extractions deferred from the original
`2026-05-13-learnings-51-78.md` manifest. Source dispositions were
fully specified upstream; this batch just performs the extracts.

## Outcomes

| #   | Source section                            | Source line | Disposition | Destination path                                                              | Track     | Category        | Notes                                    |
| --- | ----------------------------------------- | ----------- | ----------- | ----------------------------------------------------------------------------- | --------- | --------------- | ---------------------------------------- |
| 1   | 68.4 URL Injection via Unencoded Paths    | 3084        | extracted   | `runtime-errors/url-injection-encodeuricomponent-path-segments-2026-05-13.md` | bug       | runtime-errors  | no incident date prefix; used 2026-05-13 |
| 2   | 68.5 Deferred JWS Signature Verification  | 3114        | extracted   | `best-practices/deferred-security-todo-documentation-2026-05-13.md`           | knowledge | best-practices  | risk-based decision pattern              |
| 3   | 69 (a) Delete Code Aggressively           | 3144        | extracted   | `conventions/delete-unused-code-aggressively-2026-05-13.md`                   | knowledge | conventions     | themed roll-up; created 2026-05-13       |
| 4   | 69 (b) Replace `any` with Proper Types    | 3167        | extracted   | `conventions/replace-any-with-proper-types-2026-05-13.md`                     | knowledge | conventions     | themed roll-up; created 2026-05-13       |
| 5   | 70.2 Pagination Prevents OOM Crashes      | 3226        | extracted   | `conventions/paginate-list-endpoints-default-limits-2026-05-13.md`            | knowledge | conventions     | themed roll-up; created 2026-05-13       |
| 6   | 70.3 Dynamic Imports in Hot Paths         | 3260        | extracted   | `conventions/static-import-for-builtins-and-hot-paths-2026-05-13.md`          | knowledge | conventions     | themed roll-up; created 2026-05-13       |
| 7   | 71 PostgreSQL Caching for AI Content      | 3365        | extracted   | `design-patterns/postgres-cache-table-ai-content-2026-05-13.md`               | knowledge | design-patterns | composite (schema + IDOR + invalidation) |
| 8   | 72.2 API Response Consistency             | 3501        | extracted   | `conventions/match-existing-api-response-conventions-2026-05-13.md`           | knowledge | conventions     | themed roll-up; created 2026-05-13       |
| 9   | 72.3 Restore Endpoints Need Same Rigor    | 3536        | extracted   | `conventions/paired-endpoints-equal-safeguards-2026-05-13.md`                 | knowledge | conventions     | themed roll-up; created 2026-05-13       |
| 10  | 72.4 Hardcoded Tier Limits Silently Drift | 3554        | extracted   | `conventions/tier-limits-single-source-of-truth-2026-05-13.md`                | knowledge | conventions     | themed roll-up; created 2026-05-13       |

## Totals

- Extracted: 10 files
- Pruned: 0
- Source corrections: 0

### Extracted by category

- runtime-errors (bug-track): 1
- conventions (knowledge-track): 7
- design-patterns (knowledge-track): 1
- best-practices (knowledge-track): 1

## Source corrections

None. Source content remains untouched (hard constraint #6).

## Notes

- All filenames use the `-2026-05-13.md` suffix per the disposition table; this is the
  source-decomposition date, not today's execution date.
- 68.4 and 68.5 sit under `## Security Learnings` (line 2917) but have no
  `[YYYY-MM-DD]` prefix on their `###` headings — created date defaulted to 2026-05-13.
- Sections 69-72 are themed roll-ups without incident dates — created 2026-05-13.
