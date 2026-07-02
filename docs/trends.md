# Error Trends — Recurring Mistakes & Their Guardrails

> **What this is.** A frequency-ranked index of the error families that recur in OCRecipes, each
> mapped to the guardrail that already prevents it — or to the gap where one is still missing.
> The aim is not to describe bugs; it is to **turn every recurring bug into a guard the agent
> can't skip.**
>
> **Generated from** the audit corpus (`docs/audits/` — 42 runs / 45 manifests, 2026-03-27 →
> 2026-06-10) and the `ocrecipes_solutions` DB (500 solutions, 109 on the `bug` track). It is a
> **regenerable view**, not a hand-maintained list — see [§ Operating Model](#operating-model-keeping-this-living)
> for the queries that refresh every count and the prevention-wiring roadmap.
>
> **Last generated:** 2026-06-18 · **Source of truth:** `ocrecipes_solutions` DB + `docs/audits/CHANGELOG.md`
> · **Tracking:** committed (not gitignored) so it ships to every worktree, CI, and Copilot.
>
> **Salvage note (2026-06-20):** restored to `main` from a pre-#403 branch where it had
> been stranded. The counts above are stamped 2026-06-18 and do **not** yet include the
> 2026-06-19 full audit (#406) or its codified solutions; some Operating-Model items
> (recent-issue surfacing, scheduled-drift freshness) shipped in the prevention loop (#405).
> Re-generate per [§ Operating Model](#operating-model-keeping-this-living) to refresh.

---

## How to use this (for the coding agent)

1. **Before editing in a domain**, read the families tagged for that domain (the _Domain_ column
   below) and the linked `docs/rules/<domain>.md`. The write-time `inject-patterns.sh` hook already
   surfaces the rules; this doc adds the _frequency_ and _failure-shape_ context the per-rule
   injection can't.
2. **Treat the "GAP / proposed guard" column as a checklist.** Where a family has no hard guard, the
   reviewer (you) is the only thing standing between the codebase and the 5th recurrence — slow down
   there.
3. **Don't re-derive known false positives.** [§ Agent Failure Modes](#agent-failure-modes-recurring-false-positives)
   lists findings that _look_ like bugs but aren't — skip them.
4. **When you fix a new instance of a listed family**, you don't edit this file by hand — you
   `/codify` it into the DB and this view regenerates. See [§ Operating Model](#operating-model-keeping-this-living).

> **Reading the frequency numbers.** "Codified count" = how many times a pattern was _written into
> the solutions DB_, not how often the bug was introduced. The 2026-05 knowledge backfill (when the
> DB was first populated) inflates absolute counts; **rank, not raw count, is the reliable signal**,
> and audit-recurrence % (how many separate audits re-surfaced a theme) is the better cross-check.

---

## At a glance — the 16 recurring families, ranked

Ranked by combined codified-frequency + audit-recurrence + severity skew. **Hard guard** = a check
that _fails the build/commit_ (ESLint rule, `check-*.js`, CI job, test) vs. review-only (a human or
agent has to notice). The gap column is the prevention backlog.

| #     | Family                                                              | DB category          | Domain / rules                        | Codified (bug-track)                                   | Audit recurrence     | Existing guardrail                                                                            | Hard guard?       | Biggest gap → proposed guard                                                        |
| ----- | ------------------------------------------------------------------- | -------------------- | ------------------------------------- | ------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| **A** | Drizzle/Postgres **type-lies** & silent query semantics             | runtime/logic-errors | `database`, `typescript`              | ~25 (`drizzle` 19 / `postgres` 10)                     | ~80% full audits     | `database.md` + `typescript.md` rules; code-reviewer + database-specialist                    | Partial           | Raw `db.execute`/aggregate casts unlinted → **ast-grep rule + Zod-at-boundary**     |
| **B** | Missing-transaction / **check-then-act races**                      | logic-errors         | `database`                            | ~7 (`race-condition` 4 / `transactions` 3)             | ~60–80%              | `database.md` advisory-lock rules; code-reviewer "side-effects-in-tx"                         | No                | No atomicity lint → **ast-grep: check-then-write outside tx**                       |
| **C** | **Silent failures** / swallowed errors / dead guards                | logic-errors         | `api`, `client-state`, `ai-prompting` | ~10 (`error-handling`) **largest by finding-count**    | ~40% of all findings | `no-floating-promises`, `no-misused-promises`, `no-dead-apiRequest-guard`, `handleRouteError` | **Yes (routes)**  | Client mutations missing visible `onError` → **check-mutation-onerror.js**          |
| **D** | **Fix-one-miss-the-siblings** — parity drift                        | logic-errors (meta)  | `architecture`, `database`            | ~6 named                                               | ~30%                 | `drift-detect.sh` (fragile); code-reviewer "parallel paths in sync"                           | Weak              | Largest structural gap → **enum/field-list parity ast-grep + LSP-refs gate**        |
| **E** | **React hooks** lifecycle (closures, refs, cleanup, batching)       | logic-errors         | `hooks`, `performance`                | ~18 (`useref` 6 / `useeffect` 5 / `hooks` 7)           | ~40%                 | `hooks.md` rules; React Compiler (active); code-reviewer ref-mirror checks                    | Partial           | Cleanup-timer / ref-mirror timing unlinted → **eslint-plugin-react-hooks-extra**    |
| **F** | **React Navigation** (modal overlay, focus, order, beforeRemove)    | logic-errors         | `react-native`                        | ~8 (`react-navigation`)                                | ~30%                 | `react-native.md` rules; code-reviewer                                                        | **No**            | Zero lint coverage → **ast-grep: fullScreenModal dismiss / beforeRemove whitelist** |
| **G** | **Authz / IDOR** / tenant isolation                                 | logic/runtime-errors | `security`                            | ~17 (`security` 11 / `auth` 6; `idor` 12 kb)           | ~50% security        | `no-parseint-req` ESLint; `check-idor-storage.js`; `security.md`                              | **Yes**           | Polymorphic-FK target check + cache-clear-on-logout still review-only               |
| **H** | **Premium-gate / quota / tier parity** (revenue)                    | logic-errors         | `api`, `security`                     | ~3 named                                               | ~40% post-launch     | `api.md` read-gate rule; `security.md` `getEffectiveTierForUser` rule                         | No                | New read endpoint can skip gate → **check-premium-gate-parity.js**                  |
| **I** | **Accessibility** double-announce / mislabel / focus-trap           | logic-errors         | `accessibility`                       | ~14 (`accessibility` 5 / `voiceover` 5 / `talkback` 4) | ~30%                 | `check-accessibility.js` (3 patterns); `accessibility.md`; a11y-specialist                    | **Yes (partial)** | Double-announce-with-InlineError uncaught → **extend check-accessibility.js**       |
| **J** | **Casts over runtime validation** (`as` vs Zod)                     | runtime-errors       | `typescript`                          | ~16 (`typescript` 11 / `type-safety` 5)                | ~25%                 | `no-as-string-req` ESLint (req.\* only); `typescript.md`                                      | Partial           | `as` on responses/rows unlinted → **broaden `no-as-string-req` to wire data**       |
| **K** | **Regex / keyword-matching** edge cases (OCR / NLP)                 | logic-errors         | `ai-prompting`, `security`            | ~9 (`regex` 4 / `ocr` 5)                               | ~20% camera/AI       | `security.md` regex-bound rule; `ai-prompting.md` decimal-dose rule; evals                    | Weak (evals)      | Boundary/keyword-collision unguarded → **table-driven regex fixtures + evals**      |
| **L** | **AI/LLM safety & integration drift**                               | logic-errors         | `ai-prompting`, `security`            | ~16 (`openai` 4 + `ai-safety` 12 kb)                   | ~50% post-launch     | `ai-prompting.md` tool-schema rule; `mutation-goal-safety` eval; ai-llm-spec                  | Weak              | Tool schema↔handler drift unverified → **schema/handler parity test generator**    |
| **M** | **Agent / tooling false-positives** (grep-vs-read, drift fragility) | (meta)               | `architecture`, `lsp`                 | ~5 named + FP clusters                                 | every audit          | LSP-first rule; `merge-base` review rule; `drift-detect.sh`                                   | Weak              | Biggest tooling gap → **LSP-gate + mutation floor + `set -e` in hooks**             |
| **N** | **Sequential→parallel queries / missing indexes**                   | performance-issues   | `performance`, `database`             | **3 codified — under-codified!**                       | **~80% full audits** | `database.md` `Promise.all`-in-tx rule; performance-specialist                                | No                | Most-recurrent, least-codified → **ast-grep: sequential awaits + codify backlog**   |
| **O** | **Missing rate-limiters** on authenticated endpoints                | (security)           | `security`, `api`                     | folded into `security`                                 | ~60%                 | `security.md`; review; per-route `crudRateLimit`                                              | No                | No "limiter present?" check → **check-route-ratelimit.js**                          |
| **P** | **Helper-dedup / DRY** violations                                   | code-quality         | `architecture`                        | folded into `code-quality`                             | ~50% code-quality    | `architecture.md` "extract service" rule; jscpd-in-spirit                                     | No                | No dup detector → **jscpd CI threshold (advisory)**                                 |

**Coverage summary**

- **Well guarded (hard guard exists):** C (routes), G, I (partial).
- **Partially guarded (lint covers a slice):** A, E, J.
- **Review-only / biggest prevention gaps:** **M, L, F, D, H, N, O, P** — this is the actionable backlog.
- **Most-recurrent-yet-least-codified:** **N** (sequential queries) — appears in ~80% of full audits but only 3 DB entries, because it gets bundled into perf/DRY todos instead of `/codify`. A codification gap, not just a prevention gap.

---

## Methodology & data sources

| Source                                                                          | What it contributes                                                                                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/audits/` (45 manifests + CHANGELOG)                                       | Raw findings with file:line, severity, status, false-positive verdicts, codifications. The "audit recurrence %" column. |
| `ocrecipes_solutions` DB (500 / 109 bug)                                        | De-duplicated, tagged, severity-rated _clustered_ findings. The "codified count" column and the family taxonomy.        |
| `docs/rules/*.md` (14 files) + `eslint-plugin-ocrecipes` + `scripts/check-*.js` | The existing guardrail layer — what's already prevented. The "existing guardrail / hard guard" columns.                 |
| `inject-patterns.sh` + `/codify` + `AI_DRIFT_*`                                 | The write-time + scheduled machinery this doc plugs into (not parallels).                                               |

**Frequency caveat (repeat, because it matters):** counts are _codified occurrences_, conflating
"when a pattern was written down" with "when it was introduced." The DB was backfilled in 2026-05
(345 knowledge entries that month). Use **rank** and **audit-recurrence %** as the trend signal; use
raw counts only within a family, never as a cross-month time series.

---

## The families in detail

Each entry: **what it looks like · why it recurs · representative real fixes (from the DB) ·
existing guardrail · the gap & the proposed hard guard · the query that regenerates its count.**

### A. Drizzle/Postgres "type-lies" & silent query semantics · `database` `typescript`

**What.** The ORM's compile-time type asserts something Postgres doesn't honor at runtime, or a
query silently does the wrong thing.
**Why it recurs.** Drizzle's `sql<T>` is an _unchecked_ cast; Postgres returns `DECIMAL`/aggregate
columns as **strings**, partial unique indexes break `onConflictDoNothing({target})`, and
`.default([])` doesn't make the TS type non-null. Each is invisible until a row hits the edge case.
**Representative fixes:** _"PostgreSQL DECIMAL aggregates return strings — Drizzle `sql<number>` is a
lie"_ · _"`onConflictDoNothing({target})` silently no-ops on partial unique indexes"_ · _"`ADD COLUMN
.default()` leaves existing rows NULL"_ · _"Nullable FK inner join silently drops rows (LEFT JOIN +
COALESCE)"_ · _"node-postgres pooled connection is poisoned when ROLLBACK is skipped on query error."_
**Existing guardrail.** `database.md` (lines on `onConflictDoNothing`, `.default([]).notNull()`, raw
`db.execute` Zod), `typescript.md` (parseFloat aggregates). Review-enforced by database-specialist.
**Gap → guard.** No _hard_ guard on raw-SQL casts or aggregate string-coercion. **Propose:** an
ast-grep rule flagging `sql<number|Date>` on aggregate expressions and `db.execute(...)` results used
without a Zod parse (semgrep/ast-grep is the OSS-standard way to lint these AST shapes).
**Regenerate:** `… WHERE track='bug' AND ('drizzle'=ANY(tags) OR 'postgres'=ANY(tags))`.

### B. Missing-transaction / check-then-act races · `database`

**What.** Read → decide → write without holding a lock; or side-effects fired inside a transaction
that rolls back.
**Why it recurs.** The happy path passes every test; the race only shows under concurrency. New
endpoints copy the read-then-write shape without the advisory lock.
**Representative fixes:** _"Toggle Favourite Race Condition: Wrap Check-Then-Write in a Transaction"_
· _"Receipt-to-meal-plan route saved partial data without a transaction"_ · _"Side Effects Inside
db.transaction Silently Desync State on Rollback"_ · _"Read-then-write-then-check loses the
pre-mutation snapshot."_
**Existing guardrail.** `database.md` advisory-lock + recompute-after-mutation rules; code-reviewer
"side effects must fire after tx resolves."
**Gap → guard.** No automated atomicity check. **Propose:** ast-grep heuristic flagging a storage
`SELECT … existing` followed by an `INSERT/UPDATE` on the same table outside a `db.transaction` — high
recall, manual triage. Pair with a code-reviewer line.
**Regenerate:** `… WHERE track='bug' AND ('race-condition'=ANY(tags) OR 'transactions'=ANY(tags))`.

### C. Silent failures / swallowed errors / dead guards · `api` `client-state` `ai-prompting`

**What.** An error is caught and discarded, a mutation fails with no visible feedback, or a guard is
dead code so the failure path never runs.
**Why it recurs.** _This is the single largest finding-count family_ (the 2026-05-28 silent-failures
audit alone logged 46). Broad `try/catch` returning a fallback is the path of least resistance;
"haptics-only" error handlers look complete but leave most users with a silent no-op.
**Representative fixes:** _"Post-server-success local cleanup must not throw to the caller"_ · _"A
dead `if (!res.ok)` guard after apiRequest can silently kill a consumer's error branch"_ · _"A masked
read failure becomes a phantom baseline that corrupts the next write"_ · _"`z.array(z.string())
.catch()` silently drops the whole array."_
**Existing guardrail.** **Hard:** `no-floating-promises`, `@typescript-eslint/no-misused-promises`,
`no-dead-apiRequest-guard` (eslint-plugin-ocrecipes), mandatory `handleRouteError` at route catch.
`client-state.md` requires visible `onError` copy.
**Gap → guard.** The _client mutation_ side is review-only — a mutation with a haptics/VoiceOver-only
`onError` passes lint. **Propose:** `scripts/check-mutation-onerror.js` (zero-dep, joins the existing
`check-*.js` family) asserting every `useMutation` has a user-visible error path.
**Regenerate:** `… WHERE track='bug' AND 'error-handling'=ANY(tags)`.

### D. "Fix-one-miss-the-siblings" — parity drift · `architecture` `database` _(meta-pattern)_

**What.** A fix is applied at one call site but the same logic at N sibling sites is missed; or two
structures that must agree (schema↔handler, filter↔index, hash-fields↔cache-key) silently diverge.
**Why it recurs.** The fixer sees the one site in the diff, not the parallel copies. It's the most
_structural_ of the families — it's about what's **not** in the diff.
**Representative fixes:** _"Fix One Protocol Handler, Grep All Consumers"_ · _"Parallel Filter Paths
Drift — Fix One, Audit the Others"_ · _"cacheAffectingFields Must Stay in Sync with
calculateProfileHash"_ · _"OpenAI Tool Schema/Handler Drift — Phantom Parameters."_
**Existing guardrail.** `drift-detect.sh` (shell, fragile — sensitive to formatting/re-exports);
code-reviewer "grep every consumer after a schema change." LSP `findReferences` is the right tool but
not enforced.
**Gap → guard.** Largest structural gap. **Propose:** (1) make "run LSP `findReferences` before
editing a shared symbol" a _blocking_ reviewer step for parity-prone symbols; (2) ast-grep parity
rules for the known pairs (enum literal duplicated across files; filter param present in storage
signature but absent from the SQL).
**Regenerate:** `… WHERE track='bug' AND body ILIKE '%parity%' OR title ILIKE '%drift%'` (approx).

### E. React hooks lifecycle — closures, refs, cleanup, batching · `hooks` `performance`

**What.** Stale closures reading pre-render state, `useRef` misuse, cleanup reading setup-time refs,
React-19 batching collapsing `setState` in one frame.
**Why it recurs.** Hooks encode _timing_, which is invisible in the source. React 19 + the React
Compiler changed the rules (some manual memo is now redundant — see Failure Modes), so the mental
model keeps shifting.
**Representative fixes:** _"Stale Closure in React Callbacks — Use Refs for Synchronous Checks"_ ·
_"useEffect Cleanup Must Read Timer Refs at Cleanup Time, Not Setup Time"_ · _"React 19 finally-block
batching collapses setState calls in same synchronous frame"_ · _"React.memo + Ref-Only Props =
Component That Never Updates."_
**Existing guardrail.** `hooks.md` (ref-mirror, cleanup-time refs, mutate-not-mutation deps);
React Compiler auto-memoizes; code-reviewer ref-mirror timing checks.
**Gap → guard.** Cleanup-time-ref and ref-mirror timing have no lint. **Propose:** adopt
`eslint-plugin-react-hooks` exhaustive-deps in error mode where not already, plus a custom rule for
"timer ref captured at setup."
**Regenerate:** `… WHERE track='bug' AND ('useref'=ANY(tags) OR 'useeffect'=ANY(tags) OR 'hooks'=ANY(tags))`.

### F. React Navigation — modal overlay, focus dead-zones, registration order, beforeRemove · `react-native`

**What.** `fullScreenModal` not dismissed (needs `goBack()` after `navigate()`), `beforeRemove`
discard guards intercepting the screen's _own_ forward REPLACE, native-stack registration order
silently controlling animation direction, `isFocused` effect dead-zones.
**Why it recurs.** React Navigation's imperative edges aren't type-checked; each is learned by
hitting it.
**Representative fixes:** _"RN Modal Cannot Overlay a React Navigation transparentModal"_ ·
_"fullScreenModal dismissal requires navigation.goBack() after navigate()"_ · _"beforeRemove discard
guards intercept the screen's own forward REPLACE"_ · _"Native stack registration order controls
navigation direction."_
**Existing guardrail.** `react-native.md` rules; code-reviewer. **Zero hard guard.**
**Gap → guard.** **Propose:** ast-grep rules for `navigation.navigate(` in a modal-dismiss handler
without a following `goBack()`, and `beforeRemove` handlers calling `preventDefault()` without an
`e.data.action.type` whitelist. This is the highest-ROI new lint surface (review-only today, ~30%
recurrence).
**Regenerate:** `… WHERE track='bug' AND 'react-navigation'=ANY(tags)`.

### G. Authz / IDOR / tenant isolation · `security`

**What.** A resource read/write not scoped to the owner; polymorphic-FK junction insert that checks
the parent but not the target; mass-assignment via `Partial<User>`; query cache surviving logout.
**Why it recurs.** Every new resource type re-introduces the ownership-scoping requirement; it's easy
to scope mutations but forget _reads_.
**Representative fixes:** _"Polymorphic-FK junction insert verifies the parent but not the target
(IDOR)"_ · _"Mass-Assignment via Partial<User> in Storage Update Functions"_ ·
_"PersistQueryClientProvider cache survives logout — cross-user data visible on cold launch"_ ·
_"parseInt on req.userId returns NaN."_
**Existing guardrail.** **Hard:** `no-parseint-req` ESLint, `scripts/check-idor-storage.js`
pre-commit. `security.md` (scope reads by userId+visibility; field whitelist; polymorphic target
EXISTS). security-auditor + database-specialist.
**Gap → guard.** Polymorphic-FK target check and `queryClient.clear()` on all three teardown paths
are review-only. **Propose:** extend `check-idor-storage.js` to flag junction inserts lacking a
target EXISTS guard.
**Regenerate:** `… WHERE track='bug' AND ('security'=ANY(tags) OR 'auth'=ANY(tags) OR 'idor'=ANY(tags))`.

### H. Premium-gate / quota / tier parity · `api` `security`

**What.** A new write endpoint is gated but its read sibling isn't; a new generation endpoint skips
the quota check; `TIER_FEATURES[user.subscriptionTier]` indexed with the _raw_ (non-downgraded) tier
so lapsed users keep paid features.
**Why it recurs.** Gating is per-endpoint and manual; parity with siblings depends on the author
remembering the sibling exists. Directly a **revenue leak**.
**Representative fixes:** _"Expired-premium tier not downgraded before TIER_FEATURES lookup (systemic
revenue leak)"_ · _"New recipe generation endpoint skipped quota check"_ · _"Premium-Gate Parity
Missed the Read Endpoints."_
**Existing guardrail.** `api.md` (gate the read sibling too); `security.md` (`getEffectiveTierForUser`,
never raw `TIER_FEATURES[tier]`); code-reviewer.
**Gap → guard.** No automation. **Propose:** `scripts/check-premium-gate-parity.js` —flag any raw
`TIER_FEATURES[` index not via `getEffectiveTierForUser`, and surface read endpoints on paid paths
lacking a gate. (`security.md` already forbids the raw index — make it lint, not lore.)
**Regenerate:** `… WHERE track='bug' AND (title ILIKE '%tier%' OR title ILIKE '%premium%' OR title ILIKE '%quota%')`.

### I. Accessibility — double-announce / mislabel / focus-trap · `accessibility`

**What.** Live-region + `announceForAccessibility` firing twice; `accessibilityViewIsModal` hiding a
portal-rendered sheet; non-interactive `accessibilityRole="checkbox"` misleading screen readers;
decorative badges double-announced on interactive cards.
**Why it recurs.** iOS and Android announce differently; the "add a live region AND announce"
reflex double-fires when a component (e.g. `InlineError`) already announces.
**Representative fixes:** _"accessibilityViewIsModal hides portal-rendered BottomSheetModal from
VoiceOver"_ · _"accessibilityLiveRegion + announceForAccessibility causes double TalkBack
announcements"_ · _"InlineError + onError announceForAccessibility causes double VoiceOver announce."_
**Existing guardrail.** **Hard (partial):** `scripts/check-accessibility.js` (3 patterns) pre-commit.
`accessibility.md` (modal root, assertive live region, the InlineError-don't-double-announce
exception). accessibility-specialist.
**Gap → guard.** The check covers only 3 shapes; double-announce-with-InlineError and role/state
mismatches slip through. **Propose:** extend `check-accessibility.js` with the InlineError
double-announce and `role`-without-matching-`state` cases.
**Regenerate:** `… WHERE track='bug' AND ('accessibility'=ANY(tags) OR 'voiceover'=ANY(tags) OR 'talkback'=ANY(tags))`.

### J. Casts over runtime validation · `typescript`

**What.** `as` cast on external data instead of a type guard / Zod parse; truthy-sentinel defaults
(`x ?? []`) that mask a read failure; client Zod schema matching the Drizzle row type instead of the
JSON wire shape.
**Why it recurs.** `as` makes the type error disappear at the cost of a runtime lie; it's faster than
writing a guard, and the cost lands later.
**Representative fixes:** _"Unsafe Type Cast — Use Zod Validation Instead of 'as'"_ · _"Drizzle
`.default([])` does not make TypeScript type non-nullable"_ · _"Truthy sentinel default values bypass
fallback logic"_ · _"An ingestion-boundary Zod schema must be no stricter than the code that reads it."_
**Existing guardrail.** **Hard (narrow):** `no-as-string-req` ESLint (covers `req.params`/`req.query`
only). `typescript.md`.
**Gap → guard.** `as` on API responses, DB rows, and locally-parsed JSON is unlinted. **Propose:**
broaden the custom rule to flag `as` on known wire/row boundaries (response bodies, `db.execute`
results).
**Regenerate:** `… WHERE track='bug' AND ('typescript'=ANY(tags) OR 'type-safety'=ANY(tags))`.

### K. Regex / keyword-matching edge cases (OCR + nutrition NLP) · `ai-prompting` `security`

**What.** A classifier/safety regex misses a boundary case: 4-digit calorie targets, prefix lines
sharing a keyword, context-insensitive OCR char corrections (`S→5` everywhere), allergen matcher
false-flagging plant substitutes (almond milk → dairy).
**Why it recurs.** Real-world OCR/label text is adversarially messy; each new corpus surfaces a new
edge. Safety-relevant when it gates allergen/calorie warnings.
**Representative fixes:** _"Calorie restriction regex missed 4-digit unsafe targets (1000–1199 kcal)"_
· _"OCR Regex Must Account for Prefix Lines Sharing Keywords"_ · _"OCR Character Corrections Must Be
Context-Sensitive"_ · _"Allergen keyword matcher false-flags plant substitutes."_
**Existing guardrail.** `security.md` (bound every `.*` in safety regexes to ≥ input cap);
`ai-prompting.md` (allow decimals in dose patterns); evals + `mutation-goal-safety`.
**Gap → guard.** No regression net beyond evals. **Propose:** table-driven fixture suites (the
positive+negative cases the OSS Semgrep methodology recommends for every rule) for each
safety/classifier regex, run in CI.
**Regenerate:** `… WHERE track='bug' AND ('regex'=ANY(tags) OR 'ocr'=ANY(tags))`.

### L. AI/LLM safety & integration drift · `ai-prompting` `security`

**What.** AI suggests the user's own allergen; batch embeddings mapped by array position instead of
response index; OpenAI tool schema and handler parameter names drift; module-level OpenAI client
reappears; unsanitized user input reaching a prompt that "looks server-generated."
**Why it recurs.** The LLM boundary is dynamic and untyped; correctness depends on conventions the
compiler can't see (schema↔handler name match, index↔id mapping).
**Representative fixes:** _"AI ingredient substitution suggested user's own allergens"_ (critical) ·
_"Map OpenAI batch embeddings by response index, never by array position"_ · _"OpenAI Tool
Schema/Handler Drift — Phantom Parameters"_ · _"Unsanitized AI Prompt Parameter That Looked
Server-Generated."_
**Existing guardrail.** `ai-prompting.md` (schema=handler names; 4-guard parse; cacheAffectingFields
sync); `mutation-goal-safety` eval; ai-llm-specialist + security-auditor.
**Gap → guard.** Schema↔handler parity is unverified mechanically. **Propose:** a generated test that
asserts every tool's JSON-schema property set equals its handler's destructured params (catches
phantom params at CI, not runtime).
**Regenerate:** `… WHERE track='bug' AND ('openai'=ANY(tags) OR 'ai-safety'=ANY(tags) OR 'ai'=ANY(tags))`.

### M. Agent / tooling false-positives & fragility · `architecture` `lsp` _(meta)_

**What.** The harness itself misfires: lexical grep matching a definition line not the call site (or
the tool's own output), drift checks tripping on Prettier reformat / byte-equality, Stryker or lint
crashing but exiting 0, kimi-review re-flagging earlier fixes on cumulative diffs.
**Why it recurs.** Shell/grep tooling is line-oriented and type-blind; failures are silent (exit 0).
**Representative fixes:** _"kimi-review on cumulative working-tree diff re-flags earlier audit fixes"_
· _"Tier-detection grep matched the tool's own clean-output message"_ · _"Stale `.stryker-tmp` sandbox
OOMs type-aware ESLint — and the crash exits 0"_ · _"Prettier reformats generated files after commit,
breaking byte-equality drift checks."_
**Existing guardrail.** LSP-first rule (`docs/rules/lsp.md`); `merge-base` (not `base.sha`) review
rule; `drift-detect.sh`.
**Gap → guard.** Biggest tooling gap. **Propose:** (1) make LSP-over-grep a _gate_ for blast-radius
claims; (2) a mutation-score floor so Stryker can't pass on exit-0; (3) audit all hooks for `set -euo
pipefail` so a crash can't masquerade as success.
**Regenerate:** see [§ Agent Failure Modes](#agent-failure-modes-recurring-false-positives) — these are
mostly recorded as audit false-positives, not bug-track rows.

### N. Sequential→parallel queries / missing indexes · `performance` `database` ⚠ under-codified

**What.** Independent DB reads issued sequentially instead of `Promise.all`; N+1 loops; filtered
lookups doing full-table scans for want of a composite/GIN index; waterfall queries in SSE endpoints.
**Why it recurs — and why it's special.** It appears in **~80% of full audits** — the single most
_recurrent_ theme — yet has only **3 DB entries**, because it's routinely bundled into perf/DRY todos
(`gin-indexes-and-parallel-queries.md`) rather than `/codify`'d. **This is a codification gap as much
as a prevention gap.**
**Representative findings (from audits, mostly uncodified):** barcode sequential lookup loop;
meal-suggestions 5-query waterfall → 3 parallel; reminder scheduler serial fan-out;
`community_recipes.is_public` full-table scan → GIN index.
**Existing guardrail.** `database.md` (`Promise.all` for parallel queries in a transaction);
performance-specialist.
**Gap → guard.** **Propose:** (1) backfill-codify the recurring instances so the family is visible in
the DB; (2) an ast-grep heuristic for ≥2 independent `await storage.*` in sequence in a route handler.
**Regenerate:** `… WHERE category='performance-issues'` (will under-count until backfilled — see plan).

### O. Missing rate-limiters on authenticated endpoints · `security` `api`

**What.** Authenticated routes with no per-user/IP limiter; inconsistent application (some routes use
`crudRateLimit`, siblings don't); admin/search endpoints unguarded. The 2026-06-10 reverse-proxy
finding (all IP-keyed limiters collapsed to one global bucket) is the systemic cousin.
**Why it recurs.** Limiters are opt-in per route; new features forget them; there's no "this route is
unguarded" signal.
**Existing guardrail.** `security.md`; per-route `crudRateLimit`; review.
**Gap → guard.** No presence check. **Propose:** `scripts/check-route-ratelimit.js` enumerating
authenticated route registrations and flagging any without a limiter middleware (allowlist for
intentional exceptions).
**Regenerate:** `… WHERE track='bug' AND 'security'=ANY(tags) AND (title ILIKE '%rate%' OR title ILIKE '%limit%')`.

### P. Helper-dedup / DRY violations · `architecture` `code-quality`

**What.** Identical blocks repeated across 2–7 files with no extracted helper: ZodError catch
boilerplate (25+ sites), numeric-string Zod schema (15+), Multer config (7×), user serialization (4×),
recipe normalization tuple (4×).
**Why it recurs.** Copy-paste is locally cheaper than extraction; it's a _renewable_ code-quality
scope (a re-audit reliably regenerates ~as many findings as the first — see 2026-05-31 "bet
settlement").
**Existing guardrail.** `architecture.md` ("extract a service when a route makes 3+ parallel calls and
computes derived values inline"); code-reviewer.
**Gap → guard.** No duplication detector. **Propose:** `jscpd` in CI as an _advisory_ (non-blocking)
report with a copy-paste threshold — surfaces the clusters without gating noise (matches the project's
"report-only first" posture for new checks).
**Regenerate:** `… WHERE category='code-quality' AND track='bug'`.

---

## Agent failure modes (recurring false-positives)

Findings that _look_ like bugs but are not — recorded so the agent doesn't burn cycles re-deriving
them. Each is a recurring audit false-positive, with manifest citations.

| Failure mode                               | What happens                                                                                                                         | Cited in                                                                                                         | How to avoid it                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React Compiler makes memo moot**         | Flag a missing `React.memo`/`useCallback`/`useMemo` — but the React Compiler (active in `app.json`) already memoizes. ~5/full audit. | `2026-06-10-full` (M2/M3/L7 → FP), `2026-06-03-full` (H1 → FP)                                                   | Check `app.json` `experiments.reactCompiler` before flagging manual memoization. `useMemo` still needed for PureComponent props (FlatList `extraData`) + ref-read bailouts. |
| **grep-vs-read**                           | A lexical grep matches a _definition_ line, a keyword-collision, or the tool's own output — not the real call site.                  | `2026-06-02-reliability` (F1: "error middleware" matched def L141 not call L214), `2026-04-07-full-2` (L2 `S→5`) | Read the file / use LSP `findReferences`; never conclude from a grep line alone.                                                                                            |
| **kimi/LSP-less reviewer false CRITICALs** | An external reviewer with no type/LSP resolution emits self-contradictory or call-site-blind CRITICALs (≈2–3 per run).               | `2026-05-18-kimi` (H1 rerun), `2026-06-09-cleanup` (M2), `2026-05-22-security`                                   | Treat LSP-less review as advisory; verify every CRITICAL against the resolved call graph.                                                                                   |
| **Intentional "dead" code**                | An export reads as 0-caller dead code but is a rule-prescribed helper or documented `_testInternals`.                                | `2026-06-09-cleanup` (L9 `throwStatusError`), `2026-05-31-code-quality` (FP1 `_testInternals`)                   | Cross-check `docs/rules/` and the pattern-injection hook before deleting "dead" exports.                                                                                    |
| **Drift-check fragility**                  | "Drift" that's really a Prettier reformat, a byte-equality mismatch on semantically-equal code, or a crash-that-exited-0.            | `2026-04-26-full` (L22 prettier), `2026-06-10-full` (stryker fail-closed)                                        | Run the formatter first; require `set -e` in hooks; enforce a mutation floor.                                                                                               |

---

## Cross-cutting meta-patterns

Four shapes explain most of the families above. Naming them helps the agent generalize from one
instance to the unflagged siblings:

1. **"Silent by default."** The path of least resistance (broad `catch`, `?? []`, `.catch()` on a
   schema, haptics-only `onError`) _hides_ failure. Families **C, J, A** are all this shape. → Prefer
   loud failure; narrow every catch.
2. **"Type lies at the boundary."** Wherever data crosses an untyped edge (SQL result, LLM response,
   `req.*`, JSON), a cast asserts a shape Postgres/OpenAI/the client never promised. Families **A, J,
   L** share this. → Validate at the boundary (Zod), never `as`.
3. **"Fix one, miss the siblings."** The diff shows one site; the bug lives in the N copies not in the
   diff. Families **D, H, N, O** are this. → After any fix to a repeated shape, LSP-`findReferences`
   the symbol and audit every consumer.
4. **"The tool is line-oriented; the bug is semantic."** grep/shell/byte-diff can't see call graphs or
   types, so they false-positive and silently exit 0. Family **M**. → LSP over grep; `set -e` in every
   hook; mutation floor over coverage %.

---

## Prevention scorecard — the backlog, ranked by ROI

Highest-leverage missing guards (recurrence × severity × "no hard guard today"). All are **report-only
first** (the project's proven posture: ship a check that shows a red X without gating, promote to
blocking once noise is triaged — cf. CodeQL rollout, AI-drift v1).

| Rank | Guard to build                                                                  | Closes families | Type                    | Why first                                                                   |
| ---- | ------------------------------------------------------------------------------- | --------------- | ----------------------- | --------------------------------------------------------------------------- |
| 1    | `check-mutation-onerror.js`                                                     | C               | zero-dep `check-*.js`   | Largest family; client side is the hole; mirrors existing scripts           |
| 2    | ast-grep ruleset (navigation dismiss, beforeRemove, sequential-await, raw-cast) | F, N, B, A, D   | Semgrep/ast-grep        | One tool covers the 4 review-only structural families OSS-standard for this |
| 3    | `check-premium-gate-parity.js`                                                  | H               | zero-dep `check-*.js`   | Direct revenue leak; rule already exists, make it lint                      |
| 4    | tool schema↔handler parity test (generated)                                    | L               | generated Vitest        | AI-safety; catches phantom params at CI not runtime                         |
| 5    | `check-route-ratelimit.js`                                                      | O               | zero-dep `check-*.js`   | ~60% recurrence; presence check is mechanical                               |
| 6    | extend `check-accessibility.js` + `check-idor-storage.js`                       | I, G            | extend existing         | Cheap deltas to hard guards that already exist                              |
| 7    | `jscpd` advisory + **codify-backfill of family N**                              | P, N            | CI advisory + `/codify` | Closes the codification gap so N stops being invisible                      |
| 8    | hooks `set -euo pipefail` audit + Stryker score floor                           | M               | hardening               | Stops silent exit-0 failures across the harness                             |

---

## Operating Model — keeping this living

The goal isn't a snapshot; it's an **index that stays current and is wired to prevent recurrence.**
This is achievable _without new infrastructure_ because the project already has every needed
mechanism. trends.md plugs into them; it does not parallel them.

### 1. trends.md is a _generated view_, not a hand-maintained list

Every count and family in this doc derives from the `ocrecipes_solutions` DB (and the audit
CHANGELOG). So the refresh story is "re-run the query," exactly like `docs/solutions/` is a
regenerated mirror of the DB. Proposed generator (a script to add later — **not** created by this
report, per the no-code constraint):

```bash
# scripts/generate-trends.ts  (proposed)
#   1. Read a small hand-curated docs/trends.config.yaml: the 16 families, each with
#      { id, title, domain, rules_file, regenerating_sql, existing_guard, gap, proposed_guard }.
#   2. For each family, run regenerating_sql against ocrecipes_solutions → current codified count
#      + severity skew + top-N representative titles.
#   3. Cross-join the audit-recurrence % from a parsed docs/audits/CHANGELOG.md.
#   4. Render docs/trends.md from a template (the prose stays in the config; only the numbers and
#      example titles are regenerated). Stamp "Last generated: <date>".
#   npm run trends:generate   # re-render on demand / in CI
```

The _taxonomy and prose_ live in a tiny config (human-curated, rarely changes); the _numbers and
examples_ are pulled from the DB at generate-time. This is the same separation that keeps
`copilot-instructions.md` generated-but-stable from `scripts/lib/path-domains.ts`.

### 2. Indexing & search — reuse what exists, don't reinvent

- **Semantic + structured search** is already live: the `solutions-db` MCP server
  (`search_solutions`, `find_by_applies_to`, `sql`) over `tsvector` + embeddings. trends.md should
  _point at_ these, not duplicate them — each family lists the `tags`/`category` filter that pulls its
  members.
- **Write-time injection** is already live: `inject-patterns.sh` injects `docs/rules/<domain>.md`
  by path→domain. **The lightest-touch upgrade:** add a one-line pointer to the relevant trends.md
  family in each `docs/rules/<domain>.md` header, so the agent meets the trend context exactly when it
  edits that domain — no new hook.
- **For the agent to find it at all:** add a single line to `CLAUDE.md` → Key Patterns:
  _"Before fixing a bug, check `docs/trends.md` for the family and its known false-positives."_

### 3. Freshness — ride the existing scheduled-drift rail

`AI_DRIFT_CHECKLIST.md` already exists as _"a human-curated markdown table with stable IDs"_ and is
reviewed manually (the scheduled-runner design, `AI_DRIFT_AUTOMATION.md`, was deleted unbuilt in the
2026-07 harness sweep; every `DRIFT-*` row is still `status: pending`). So the rail to ride is the
existing checklist; extend it by adding **one row** rather than building a new system:

```
| DRIFT-010 | trends.md freshness | monthly | pending | — | — | docs/trends.md, ocrecipes_solutions DB |
  Run `npm run trends:generate --check`; flag if regenerated counts differ from the committed file
  (i.e. new codified bugs have landed since last generate) or if last-generated date > 35 days old. |
```

Report-only, like every other DRIFT row. When it flags, a human (or a `/codify`-aware session)
re-generates.

### 4. The closed loop (this is the actual goal)

```
   bug found ──▶ /codify ──▶ ocrecipes_solutions DB ──▶ npm run trends:generate ──▶ docs/trends.md
        ▲                                                          │
        │                                                          ▼
        └──────  prevention guard (lint / check-*.js / ast-grep / test)  ◀── Prevention Scorecard
                 catches the NEXT instance at commit/CI time, before it's a bug
```

Each link already exists except `trends:generate` (one script) and the scorecard guards (built
incrementally, report-only). The payoff compounds: as guards land, families drop down the ranking, and
trends.md becomes the _measure_ of how much recurring-error surface has been mechanically eliminated.

### What this is **not**

- Not a replacement for `docs/rules/` (binding per-domain rules) or the solutions DB (per-item store).
  It is the **aggregate + gap layer** above them.
- Not a new search engine — it points at the existing MCP search.
- Not auto-edited — like the AI-drift checklist, it's human-curated prose + machine-regenerated
  numbers; a scheduled check _reports_ staleness, it doesn't rewrite meaning.

---

## Sources & precedent

**Internal:** `docs/audits/CHANGELOG.md` + 45 manifests; `ocrecipes_solutions` DB; `docs/PATTERNS.md`;
`docs/rules/*.md`; `.claude/skills/codify/SKILL.md`; `docs/AI_DRIFT_CHECKLIST.md`; `eslint-plugin-ocrecipes`; `scripts/check-{accessibility,idor-storage,
hardcoded-colors}.js`.

**Open-source precedent (the "living rules/lessons for agents" ecosystem, 2026):**

- The ecosystem has converged on _"a markdown file the agent reads"_ — **AGENTS.md** (the emerging
  cross-tool standard, adopted by Codex/Cursor/Copilot/Aider/Windsurf/Zed), **.cursorrules**,
  Aider's **CONVENTIONS.md**, **CLAUDE.md**. OCRecipes already implements the richest version
  (CLAUDE.md + auto-injected `docs/rules/` + an auto-memory layer). trends.md adds the
  _frequency/aggregate_ layer these flat rule files lack.
  ([codersera](https://codersera.com/blog/agents-md-vs-claude-md-vs-cursor-rules-comparison-2026/),
  [buildbetter](https://blog.buildbetter.ai/agents-md-vs-cursorrules-vs-claude-skills-2026-comparison/),
  [Cursor docs](https://cursor.com/docs/rules))
- **Self-improving agent loops** keep an append-only progress/lessons log between runs and a separate
  auto-memory channel — the closed-loop idea behind § Operating Model.
  ([Addy Osmani — Self-Improving Coding Agents](https://addyosmani.com/blog/self-improving-agents/))
- **Codifying knowledge as automated checks:** custom **Semgrep / ast-grep** rules are the OSS-standard
  way to "turn a senior engineer's hard-won knowledge into a check that runs on every PR and prevents
  the mistake from being reintroduced" — AST-aware, unlike regex, and every rule ships with positive +
  negative test cases. This is the basis for the ast-grep items in the Prevention Scorecard.
  ([semgrep-rules](https://github.com/semgrep/semgrep-rules),
  [writing custom Semgrep rules](https://semgrep.dev/blog/2020/writing-semgrep-rules-a-methodology/))
- **Why prevention matters here:** industry data finds AI-assisted code carries ~1.7× the bug rate and
  ~2× the error-handling defects of human code, with systematic weakness in concurrency/ordering and
  edge/boundary cases — precisely families **C, B, K** above. The consensus mitigations (tests,
  linting, type-checking, schema validation, static analysis) are exactly this doc's Prevention
  Scorecard. ([Stack Overflow](https://stackoverflow.blog/2026/01/28/are-bugs-and-incidents-inevitable-with-ai-coding-agents/),
  [Ranger — common bugs in AI-generated code](https://www.ranger.net/post/common-bugs-ai-generated-code-fixes))

```

```
