# Audit: Unfinished Features, Specs & Plans

> **Date:** 2026-05-16
> **Trigger:** User requested audit specifically for unfinished features, specs, and plans
> **Domains:** code-quality, product-completeness
> **Baseline:** Tests skipped per CLAUDE.md (do not run at session start or to self-verify)
> **Resumed:** 2026-05-16 — discovery (9 findings) re-verified against current `main` HEAD `263b7485` (post-#192) in a fresh worktree; original `audit-2026-05-16b` worktree retired.

## Findings

Each finding has a lifecycle: `open` → `fixing` → `verified` or `deferred` or `false-positive`.

**Status key:**

- `open` — Found but not yet addressed
- `fixing` — Work in progress
- `verified` — Fix applied AND confirmed by test/grep/type-check
- `deferred` — Intentionally postponed (must link to todo)
- `false-positive` — Agent was wrong or issue was already fixed

### Critical

| ID  | Finding | Domain | Agent | File(s) | Status | Verification |
| --- | ------- | ------ | ----- | ------- | ------ | ------------ |
| —   | —       | —      | —     | —       | —      | —            |

### High

| ID  | Finding                                                                                                                                                                                                                                                                       | Domain               | Agent            | File(s)                                         | Status   | Verification                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | "Upgrade to Coach Pro" CTA in daily-limit banner is static text — not wrapped in Pressable, clicking it does nothing. `CoachProScreen` exists in `ChatStackNavigator` and `UpgradeModal` exists; neither is wired up. Conversion blocker when user hits daily coaching limit. | product-completeness | manual discovery | `client/components/coach/CoachChat.tsx:599-601` | verified | CTA wrapped in `Pressable` (`accessibilityRole="button"`, label, `hitSlop`) opening `UpgradeModal` via local `showUpgrade` state — same pattern as 4 other screens. Banner `View` has no `accessible={true}` so the button stays its own a11y node. grep confirms; 20/20 coach component tests pass; kimi-review: no findings. No direct CoachChat render test exists. |

### Medium

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Domain               | Agent            | File(s)                                                | Status   | Verification                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | ------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `mergeReceiptItems` ignores `_local` parameter — always returns AI items. Confidence-based OCR fallback is documented in-function but not implemented. `_local` is a prefixed-underscore dead parameter.                                                                                                                                                                                                                                                                                                                                                                                                    | code-quality         | manual discovery | `client/screens/receipt-review-utils.ts:27-36`         | deferred | Genuine design task: `LocalReceiptItem` (`rawName`/`price`/`quantity`) and AI `ReceiptItem` are not interconvertible and share no correspondence key — a "fall back to local item" mapping is undefined. Todo: `todos/2026-05-16-receipt-ocr-confidence-fallback.md`                                                                      |
| M2  | `buildCoachContext` hardcodes `goals: null`, so the coach-context panel endpoint (`GET /api/coach/context`) never sends goal data. `CoachDashboard.tsx:96` is built to render `goals.calories - todayIntake` (remaining calories) — a permanently dead UI branch. **Original prescribed fix (`calculateGoals`) was wrong**: `userProfiles` has no `weight`/`height`/`age`/`gender`; the AI prompt path (`coach-pro-chat.ts:401`) already populates goals separately from persisted `users.dailyCalorieGoal` columns. Real fix: populate from the already-fetched `user` row, mirroring `coach-pro-chat.ts`. | code-quality         | manual discovery | `server/services/coach-context-builder.ts:74`          | verified | `CoachContextData.goals` type widened to `{calories,protein,carbs,fat}\|null`; populated from `user.dailyCalorieGoal/...` (mirrors `coach-pro-chat.ts:401-405`, `\|\| 0` macro coercion). 15/15 tests pass incl. 2 new (column population + null-macro→0). kimi-review unavailable (401 auth outage) — deferred to Phase 6 code-reviewer. |
| M3  | RecipeBrowserScreen "Safe for me" allergen filter disabled — TODO comment says waiting on search service support. The client state variable was removed entirely; no UI surface exists.                                                                                                                                                                                                                                                                                                                                                                                                                     | product-completeness | manual discovery | `client/screens/meal-plan/RecipeBrowserScreen.tsx:275` | deferred | Confirmed blocked: `recipe-search.ts` has no allergen-filtering capability (filters cuisine/diet/difficulty/`source` only). Backend feature work. Todo: `todos/2026-05-16-recipe-search-allergen-filter.md`                                                                                                                               |
| M4  | SearchFilterSheet "Online (Spoonacular)" source option commented out — Spoonacular catalog is backend-integrated but not exposed as a filter option in the UI.                                                                                                                                                                                                                                                                                                                                                                                                                                              | product-completeness | manual discovery | `client/components/meal-plan/SearchFilterSheet.tsx:47` | deferred | Confirmed blocked: `recipe-search.ts` filters `r.source` against local-DB recipes only; Spoonacular results need an inline external-API search path that doesn't exist. Todo: `todos/2026-05-16-recipe-search-spoonacular-source.md`                                                                                                      |

### Low

| ID  | Finding                                                                                                                                                                                                                         | Domain               | Agent            | File(s)                                     | Status         | Verification                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | ------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `profile-hub.ts` hardcodes `unit: "lbs"` — no user measurement unit preference system exists; weight always displays in imperial regardless of user locale or preference.                                                       | code-quality         | manual discovery | `server/services/profile-hub.ts:54`         | deferred       | Needs a new unit-preference system (schema column + settings UI + migration) — a feature, not a one-line fix. Todo: `todos/2026-05-16-user-measurement-unit-preference.md`                                                                                                    |
| L2  | ROADMAP backlog item "Verification streak premium unlocks" (beyond display — actual feature unlocks for high verifiers) has no corresponding todo tracking it.                                                                  | product-completeness | manual discovery | `docs/ROADMAP.md:126`                       | verified       | Tracking todo created: `todos/2026-05-16-verification-streak-premium-unlocks.md`. The finding _was_ the missing todo; it now exists.                                                                                                                                          |
| L3  | `shared/schema.ts:364` has a TODO to migrate all timestamp columns to `withTimezone` for consistency. References "todo 010" which is in `todos/archive/`.                                                                       | code-quality         | manual discovery | `shared/schema.ts:364`                      | verified       | Root cause: a `status: backlog` todo was mis-filed in `todos/archive/` (archive = resolved per project convention, so `/todo` never picks it up). Relocated to `todos/timestamp-timezone-consistency.md`; schema comment updated to reference the active path. grep confirms. |
| L4  | `docs/plans/phase-4-continuation-prompt.md` is a stale handoff artifact — Phase 4 features (pantry, meal confirmation endpoint) are implemented but this file was never cleaned up. Creates confusion about what is/isn't done. | documentation        | manual discovery | `docs/plans/phase-4-continuation-prompt.md` | false-positive | File does not exist at current `main` HEAD `263b7485` — already removed. `ls` + `git log` confirm.                                                                                                                                                                            |

## Deferred Items

Items marked `deferred` must have a linked todo and rationale.

| ID  | Todo                                                   | Rationale                                                                                                                                              |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | `todos/2026-05-16-receipt-ocr-confidence-fallback.md`  | No correspondence key between `LocalReceiptItem` and AI `ReceiptItem`; the confidence-fallback mapping is an unresolved design task, not a wiring fix. |
| M3  | `todos/2026-05-16-recipe-search-allergen-filter.md`    | `recipe-search.ts` has no allergen-filtering capability — re-adding "Safe for me" requires backend feature work + recipe allergen data.                |
| M4  | `todos/2026-05-16-recipe-search-spoonacular-source.md` | Local search filters `r.source` against the DB only; surfacing Spoonacular needs an inline external-API search/merge path that does not exist.         |
| L1  | `todos/2026-05-16-user-measurement-unit-preference.md` | No measurement-unit preference exists; a fix requires a schema column, settings UI, and migration — a feature, not a one-liner.                        |

## Summary

| Severity  | Found | Verified | Deferred | False-positive | Open  |
| --------- | ----- | -------- | -------- | -------------- | ----- |
| Critical  | 0     | 0        | 0        | 0              | 0     |
| High      | 1     | 1        | 0        | 0              | 0     |
| Medium    | 4     | 1        | 3        | 0              | 0     |
| Low       | 4     | 2        | 1        | 1              | 0     |
| **Total** | 9     | 4        | 4        | 1              | **0** |

## Fix Commits

| Commit     | Description                                                              |
| ---------- | ------------------------------------------------------------------------ |
| `f322dae9` | fix: resolve unfinished-features audit findings (4 verified, 4 deferred) |

## Codification (Phase 8)

Completed after fixes are committed.

### Patterns Extracted

| Finding | Pattern                                                                                                                                                                                                                                                                          | Added To                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| M2      | Dead UI branch from a context-builder hardcoding a placeholder field — inline/duplicated response types let a server-side `null` literal drift from a client consumer that renders the field, invisible to `tsc`. Includes the "verify the prescribed fix's premise" sub-lesson. | `docs/solutions/logic-errors/dead-ui-branch-from-duplicated-context-types-2026-05-16.md` (new) |

### Learnings Extracted

| Finding | Learning Title                                                                            | Category        |
| ------- | ----------------------------------------------------------------------------------------- | --------------- |
| M2      | Folded into the solution doc above (Root Cause + Prevention) — no separate learning file. | Bug Post-Mortem |

### Code Reviewer Updates

| Finding | New Check Added                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2      | `code-reviewer.md` §12 Code Quality — flag any service/builder return field hardcoded to a dead placeholder (`null`/`[]`/`0`) when its type allows real values; grep client consumers for a dead render branch. |

### Specialist Agent Updates

| Finding | Agent Updated | New Check Added                                                                                                               |
| ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| —       | —             | None — the code-reviewer §12 check covers the Phase 6 gate; no specialist-agent update warranted for a single Medium finding. |

**Codification commit:** the `docs: codify patterns and learnings from unfinished-features audit` commit, immediately following fix commit `f322dae9`.

## Post-Audit Notes

- Discovery scope was custom ("unfinished features, specs, plans") — not a standard domain audit. Used grep-based code search + docs/plans + docs/ROADMAP + docs/brainstorms analysis rather than specialist subagents.
- No baseline test run performed per CLAUDE.md policy (do not run at session start or to self-verify).
- **Resumed 2026-05-16** in a fresh worktree off `main` HEAD `263b7485` (post-#192). Discovery's 9 findings were re-verified against current code: 8 confirmed, L4 reclassified false-positive (file already removed).
- **M2 was a real finding with a wrong prescribed fix.** The manifest claimed the AI coach "never knows targets" — false: `coach-pro-chat.ts` populates the AI prompt's `CoachContext.goals` separately. The actual bug is the `GET /api/coach/context` _panel_ endpoint: `buildCoachContext` hardcoded `goals: null`, leaving `CoachDashboard`'s remaining-calories display (`goals.calories - todayIntake`) permanently dead. Fixed by populating from persisted `users.daily*Goal` columns. `calculateGoals` was never relevant — `userProfiles` has no physical-profile columns.
- **Phase 5 verification:** `check:types` 0 errors; `lint` 0 errors (9 pre-existing warnings, none from this audit). Targeted tests for the full changed surface pass: `coach-context-builder.test.ts` 15/15 (incl. 2 new), `coach-context.test.ts` route 12/12, coach component tests 20/20. `CoachChat.tsx` has no render test (additive wiring); `schema.ts` change is comment-only. Full `test:run` delegated to CI per CLAUDE.md.
- **kimi-review outage:** per-fix kimi-review succeeded for H1 ("no findings") but began returning `401 — User not found` for M2 onward (mid-session credential/quota failure). Remaining fixes covered by Phase 6 code-reviewer subagent instead.
- **Phase 6 code review:** multi-file review of the fix diff returned APPROVE — 0 Critical/High/Medium. Two LOW notes: (1) CTA `hitSlop` bumped `12 → 16` to meet the ≥44pt touch-target rule (fixed inline); (2) no test for the unreachable "user present + null `dailyCalorieGoal`" branch — skipped: `dailyCalorieGoal` has a DB default, and the `goals: null` path is already covered by the existing undefined-user test.
- **PR #193 review feedback:** a review of the PR surfaced 4 LOW items, all addressed: (1) H1 now passes `onUpgrade={() => setIsAtDailyLimit(false)}` to `UpgradeModal` so the limit banner clears immediately after a successful upgrade rather than lingering until the next send; (2) the relocated timestamp todo had a stale `schema.ts:305` reference (refreshed to `:366`; `withTimezone` is still on `savedItems.createdAt` only) and a stale `updated` date; (3) it is renamed to the `YYYY-MM-DD-slug` convention (`todos/2026-03-27-timestamp-timezone-consistency.md`, using its `created` date); (4) a follow-up todo for `CoachChat` render-test coverage was created (`todos/2026-05-16-coachchat-render-test-coverage.md`).
