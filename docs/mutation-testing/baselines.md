# Mutation Testing Baselines

Tracked mutation scores per target. Update when a target is (re)run. No `break`
threshold is enforced until a target has a stable baseline here.

| Date       | Target                          | Score  | Killed | Survived | No coverage | Timeout |
| ---------- | ------------------------------- | ------ | ------ | -------- | ----------- | ------- |
| 2026-06-05 | macro-gap-context               | 88.37% | 38     | 5        | 0           | 0       |
| 2026-06-05 | verification-consensus (before) | 48.74% | 58     | 11       | 50          | 0       |
| 2026-06-05 | verification-consensus (after)  | 100%   | 109    | 0        | 0           | 0       |
| 2026-06-05 | goal-calculator (before)        | 95.24% | 40     | 2        | 0           | 0       |
| 2026-06-05 | goal-calculator (after)         | 100%   | 42     | 0        | 0           | 0       |
| 2026-06-05 | adaptive-goals (before)         | 75.82% | 116    | 37       | 0           | 0       |
| 2026-06-05 | adaptive-goals (after)          | 99.35% | 152    | 1        | 0           | 0       |

> **goal-safety targets** (`goal-calculator`, `adaptive-goals`) are Hard-Exclusion
> modules brought under mutation testing via the gated read-only protocol — tests only,
> source never edited. `adaptive-goals`'s single residual survivor is a **verified
> equivalent mutant** recorded in `accepted-equivalents.json` (not a gap); its CI break
> is set to 99, goal-calculator's to 100. See the gated-protocol solution doc.
