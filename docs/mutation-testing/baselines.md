# Mutation Testing Baselines

Tracked mutation scores per target. Update when a target is (re)run. No `break`
threshold is enforced until a target has a stable baseline here.

| Date       | Target                           | Score  | Killed | Survived | No coverage | Timeout |
| ---------- | -------------------------------- | ------ | ------ | -------- | ----------- | ------- |
| 2026-06-05 | macro-gap-context                | 88.37% | 38     | 5        | 0           | 0       |
| 2026-06-05 | verification-consensus (before)  | 48.74% | 58     | 11       | 50          | 0       |
| 2026-06-05 | verification-consensus (after)   | 100%   | 109    | 0        | 0           | 0       |
| 2026-06-05 | goal-calculator (before)         | 95.24% | 40     | 2        | 0           | 0       |
| 2026-06-05 | goal-calculator (after)          | 100%   | 42     | 0        | 0           | 0       |
| 2026-06-05 | adaptive-goals (before)          | 75.82% | 116    | 37       | 0           | 0       |
| 2026-06-05 | adaptive-goals (after)           | 99.35% | 152    | 1        | 0           | 0       |
| 2026-06-27 | verification-consensus (recheck) | 100%   | 109    | 0        | 0           | 0       |
| 2026-06-27 | macro-gap-context (after)        | 100%   | 41     | 0        | 0           | 0       |
| 2026-06-27 | cook-session-merge               | 100%   | 27     | 0        | 0           | 0       |
| 2026-06-27 | chat-history-truncate (before)   | 73.54% | 163    | 58       | 1           | 1       |
| 2026-06-27 | chat-history-truncate (after)    | 90.58% | 200    | 21       | 0           | 2       |
| 2026-06-27 | notebook-budget (before)         | 81.82% | 45     | 10       | 0           | 0       |
| 2026-06-27 | notebook-budget (after)          | 90.91% | 50     | 5        | 0           | 0       |

> **goal-safety targets** (`goal-calculator`) are Hard-Exclusion modules brought under
> mutation testing via the gated read-only protocol — tests only, source never edited.
> Its CI break is set to 100. See the gated-protocol solution doc.
>
> **Retired:** `adaptive-goals` was deleted in #384 (health-feature retirement). Its
> 2026-06-05 rows above are kept as a historical record, but the module no longer exists
> — it is not a registered target and not in `HUMAN_APPROVED_EXCLUSIONS`.
>
> **2026-06-27 non-excluded scope expansion.** Added `cook-session-merge` (100% as-is)
> and `chat-history-truncate` to the registry, and raised `macro-gap-context` 88.37% → 100%
> (killed 4 survivors; 1 NaN-equivalent suppressed inline). `chat-history-truncate` is
> gated at **break=88** (90.58% achieved; margin below for timeout nondeterminism): its
> residual survivors are the dev-only
> `console.warn` budget-overflow diagnostic (lines 152-156) plus provable equivalents
> (the empty-input fast path, optional chaining on never-null slots, and the
> `i !== lastUserIdx` guards that are redundant in the non-user pruning phases). All four
> non-excluded targets are enforced by `.github/workflows/mutation-non-excluded.yml`.
> `ai-safety` was evaluated and **not** added — it is regex-dominated (45.18%, 182
> survivors that are almost all `Regex`-mutator whitespace noise), so a gate there would
> read as "protected" without testing the safety patterns; its meaningful thresholds are
> covered by function-level tests instead.
