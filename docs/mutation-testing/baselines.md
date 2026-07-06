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
| 2026-06-27 | carousel-builder (before)        | 76.71% | 56     | 14       | 3           | 0       |
| 2026-07-05 | carousel-builder (after)         | 93.15% | 68     | 3        | 2           | 0       |
| 2026-06-27 | subscription-tier-cache (before) | 71.88% | 23     | 4        | 5           | 0       |
| 2026-07-05 | subscription-tier-cache (after)  | 93.75% | 30     | 2        | 0           | 0       |
| 2026-06-27 | recipe-normalization (rejected)  | 66.19% | 139    | 71       | 0           | 0       |
| 2026-06-27 | cooking-adjustment (rejected)    | 51.94% | 67     | 61       | 1           | 0       |

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
>
> **2026-07-05 mutation-testing backlog** (`P3-2026-06-27-mutation-and-test-quality-backlog.md`)
> baselined the 4 remaining pure-logic candidates identified in the 2026-06-27 scoping pass.
> **Onboarded:** `carousel-builder` (76.71% → 93.15%, break=90) — added strict-boolean
> assertions for `isRemix`, a `timeEstimate: null` case, a legacy-`cuisinePreferences: null`
> guard case (the pre-existing tests never exercised a falsy `cuisinePreferences`, so the
> `&&`-chain guard at line 58 was untested), a two-element `cuisinePreferences` list ordered
> to distinguish `.some()` from a mutated `.every()`, and the 30-minute quick-and-easy
> boundary. Residual 5: the `length > 0` vs `>= 0` / `true &&` pair at line 59 are provable
> equivalents (once `cuisinePreferences` is `[]`, the downstream `.some()` on that same empty
> array is vacuously false regardless of whether the length gate passed), and the 3 `?? []`
> ArrayDeclaration mutants (`dietTags` line 49, `mealTypes` lines 101-102 in the sort
> comparator) are only observable by matching Stryker's literal `"Stryker was here"`
> placeholder string as a diet type / cuisine preference / meal-time hint — the same
> pedantry trap as chasing `Regex` whitespace, not worth it. **Onboarded:**
> `subscription-tier-cache` (71.88% → 93.75%, break=90) — the 5 no-coverage mutants were all
> in the untested `MAX_CACHE_SIZE` eviction path (never exercised because no test filled the
> cache to 10,000 entries); one eviction test (seed the cache to the limit via
> `_testInternals.tierCache`, assert the oldest key is evicted and size stays bounded) killed
> 6 mutants in that path (the 5 no-coverage ones plus one adjacent `>=`-vs-`>` survivor on the
> outer size gate), and a separate TTL-exact-boundary test (`Date.now() === expiresAt`) killed
> the `>` vs `>=` survivor on the TTL check — 7 of the 9 previously-unkilled mutants closed in
> total. Residual 2: `if (oldestKey !== undefined)` → `if (true)` is a provable
> equivalent (the outer `size >= MAX_CACHE_SIZE` gate guarantees a non-empty `Map`, so
> `.keys().next().value` is never `undefined` in any reachable state), and `?? "free"` →
> `?? ""` is also equivalent (`"free"` is itself a valid tier, so `isValidSubscriptionTier`'s
> fallback ternary resolves both the real and mutated default to `"free"` downstream).
> **Rejected (SKIP, not re-evaluated):** `recipe-normalization` (66.19%, 71 survivors —
> string/parsing `Regex` and `StringLiteral` noise on unit conversion, the same shape as the
> `ai-safety` rejection) and `cooking-adjustment` (51.94%, 61 survivors — dominated by
> `ObjectLiteral` mutants on the per-method adjustment-factor data tables, e.g. gutting a
> `{ protein: 0.93, fat: 0.95, ... }` literal to `{}`; low-value data-table noise, not
> branching/computational logic worth gating).
