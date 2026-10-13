# Notification Strategy — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorming) → ready for implementation planning
**Scope:** A governing strategy for all user-facing notifications in OCRecipes. Consolidates today's fragmented mechanisms behind one front door, adds a re-engagement lane, and realigns the surviving nudges to the camera-first identity.

---

## 1. Problem & Context

OCRecipes already has substantial notification _machinery_, but no coherent _strategy_. The pieces were each bolted on by a separate feature, so the same logical event can fire through up to three different channels with no deliberate routing.

**What exists today:**

| Piece                                                                      | Behavior                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/services/push-notifications.ts` (`sendPushToUser`)                 | Production-grade remote push via Expo Push Service (token chunking, 30s timeout, auto-cleanup of `DeviceNotRegistered`). Gated on `EXPO_ACCESS_TOKEN`. Only **commitment** reminders call it. |
| `server/services/notification-scheduler.ts`                                | Cron: 09:00 commitments + daily-checkin, 12:00 meal-log nudge. daily-checkin/meal-log only write in-app `pending_reminders` (no push).                                                        |
| `pending_reminders` table + `server/routes/reminders.ts` → Coach-tab badge | In-app "pending reminder" dot; acknowledged in-app. Idempotency via `pending_reminders_user_type_day_idx` unique index + `onConflictDoNothing`.                                               |
| `client/hooks/useNotebookNotifications.ts`                                 | On-device local notifications for commitment follow-ups (push fallback).                                                                                                                      |
| `client/lib/notifications.ts`                                              | OS permission request + Android `coach-reminders` channel setup.                                                                                                                              |
| `users.reminderMutes` (jsonb) + `CoachRemindersScreen`                     | Per-category mute for 3 coach categories only.                                                                                                                                                |
| `server/services/store-notifications.ts`                                   | Apple ASSN V2 / Google RTDN billing webhooks. **Server-to-server, not user-facing — out of scope.**                                                                                           |

**The gaps this strategy closes:**

1. No deliberate channel routing — events scatter across push / in-app / local with no rule.
2. Health-tracking remnants — `daily-checkin` / `meal-log` predate PR #384 ("retire 5 health-tracking features to refocus on camera/food") and only badge in-app.
3. No re-engagement / win-back lane at all.
4. No unified preferences or permission-priming UX (only 3 mute toggles buried in a premium-gated screen).

**Strategic decisions made during brainstorming:**

- **Intent:** _Balanced + governed_ — value-delivery + measured re-engagement + coach nudges, held in check by frequency cap, quiet hours, and a preferences center.
- **Remnants:** _Reframe to camera-first_ — `meal-log` → "scan something today?", `daily-checkin` → light daily recap.
- **Re-engagement:** _Single value-anchored nudge_ — one win-back after N days inactive, anchored to something real; no sequences.
- **Preferences UI:** _Both / split_ — Coach-lane toggles stay in `CoachRemindersScreen`; a new Profile → Notifications screen owns global settings. Both read/write one shared `notificationPrefs`.

---

## 2. Architecture — Two-Lane In-Process Facade

Every producer (route handler, cron job, service) stops calling `sendPushToUser` / `createPendingReminder` directly and instead calls a single in-process facade:

```
notify(userId, categoryKey, payloadContext)
```

This is a **module in the existing Express monolith** — not a separate service, queue, or RPC. The facade consults a static **category registry** (lane, default channel(s), copy template per category) and routes through one of two lanes:

### Lane A — Transactional (must-deliver)

Value-delivery events the user is waiting on. **Bypasses frequency cap and quiet hours.** Respects only OS permission + a master `transactionalEnabled` opt-out. Delivered immediately via `sendPushToUser` (push-only — no Coach-badge record).

### Lane B — Governed (engagement)

Reframed coach nudges + re-engagement. Flows through the **policy gate** before any channel:

1. **Preference check** — per-category enabled flag (extends today's `reminderMutes`).
2. **Quiet hours** — per-user window, timezone-aware (reuses the scheduler's `parseTimezone` + stored-tz path).
3. **Frequency cap** — _discretionary only_; a single daily selection pass sends at most one discretionary nudge (the highest-priority of those eligible), recorded in a dedicated `notification_sends` ledger (the same unique-index idempotency pattern, TOCTOU-safe — **not** `pending_reminders`; see §4).
4. **Route** to channel (push / in-app badge / local).

### Why this over alternatives

- **vs. a single uniform chokepoint:** splitting lanes guarantees a cap/quiet-hours bug can never starve a transactional delivery — transactional never touches the gate. (This was the strongest critique from the adversarial review.)
- **vs. an advisory `shouldSend()` helper each producer optionally calls:** too weak for "governed" — producers can forget it. The facade is the _only_ path.
- **vs. an event outbox / queue table + worker:** YAGNI for this app (queues are deferred until a scaling trigger). Its one genuinely good property — dedup via unique constraint — is adopted directly, since the codebase already has it.

> **Note on scale:** this design is mostly _consolidation_. The three channels, the `pending_reminders` idempotency pattern, timezone day-bucketing, and Expo push already exist. The facade puts a single front door on machinery that today has three side doors.

---

## 3. Notification Taxonomy

| Category key             | Purpose                                | Lane              | Counts against cap? | Trigger                                                                                                                                                        |
| ------------------------ | -------------------------------------- | ----------------- | :-----------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recipe-image-ready`     | Value-delivery                         | A · transactional |          —          | Async Runware/DALL-E image finishes (incl. URL-imported recipes)                                                                                               |
| `recipe-import-complete` | Value-delivery                         | A · transactional |          —          | A URL→recipe import finishes processing                                                                                                                        |
| `user-set`               | User-scheduled                         | A · transactional |          —          | User explicitly set this reminder for this time (existing `user-set`)                                                                                          |
| `commitment`             | Coach nudge                            | B · governed      |     No (dated)      | Coach-notebook follow-up due (existing — kept)                                                                                                                 |
| `scan-nudge`             | Coach nudge (reframed `meal-log`)      | B · governed      |       **Yes**       | User hasn't scanned/captured anything today                                                                                                                    |
| `daily-recap`            | Coach nudge (reframed `daily-checkin`) | B · governed      |       **Yes**       | Light end-of-day recap of what they scanned                                                                                                                    |
| `winback`                | Re-engagement (net-new)                | B · governed      |       **Yes**       | N days inactive — value-anchored (e.g. "finish the recipe you started" / a saved recipe — a reliably-available anchor, not the deferred verified-product data) |

**Cap rule:** the frequency cap applies only to _discretionary_ nudges (`scan-nudge`, `daily-recap`, `winback`) — the ones the app decides to send. Reminders the user or coach _explicitly scheduled_ (`commitment`, `user-set`) always fire on their date; throttling those would break a commitment the user made to themselves.

**v1 Lane A set:** `recipe-image-ready` + `recipe-import-complete` only (both already async). `product-verified` is deferred — it depends on the Verified Product pipeline exposing a per-user completion hook.

**Explicitly out of scope:**

- **Store server webhooks** (Apple ASSN V2 / Google RTDN) — server-to-server entitlement revocation, never reach the user. Untouched.
- **Email** (Resend email-verification) — a separate channel for auth, not push.
- **Subscription-expiry reminders** — plausible future transactional category, but billing-lifecycle, not camera-first. Deferred candidate, not v1.
- **`product-verified`** — deferred Lane A candidate (see above).

---

## 4. Channel Routing & Governance

### Channel routing

| Category                 | Push (Expo) | In-app badge | Local (fallback) |
| ------------------------ | :---------: | :----------: | :--------------: |
| `recipe-image-ready`     |     ✅      |      —       |        —         |
| `recipe-import-complete` |     ✅      |      —       |        —         |
| `user-set`               |     ✅      |      —       |  ✅ if push off  |
| `commitment`             |     ✅      |      ✅      |  ✅ if push off  |
| `winback`                |     ✅      |      —       |        —         |
| `scan-nudge`             | — (opt-in)  |      ✅      |        —         |
| `daily-recap`            | — (opt-in)  |      ✅      |        —         |

**Routing rule:** intentional/time-sensitive → push; ambient → in-app badge. `winback` is the only discretionary category that pushes by default (re-engagement must reach an away user) and is also the most rate-limited. `scan-nudge` / `daily-recap` are ambient — they surface as the Coach-tab dot when the user next opens the app, escalating to push only on explicit opt-in. **Lane A is push-only** — value-delivery does _not_ write a Coach-badge row (that surface is coaching-only; a general in-app notification inbox is out of scope, §3).

### Governance parameters (defaults — all tunable)

- **Frequency cap — GLOBAL, enforced at a single daily selection pass** (discretionary only). A first-come unique-index "slot claim" does **not** work: the categories fire from different crons (today 09:00 check-in, 12:00 meal-log), so first-writer-wins lets the _schedule_ — not the priority — decide, inverting the ranking below. Instead, discretionary nudges are chosen together, once per user per day:
  1. Gather every discretionary category eligible for the user that day.
  2. Pick the single highest-priority one by the ranking **`winback` > `scan-nudge` > `daily-recap`** (win-back rarest + highest value; scan-nudge drives the core scan action; daily-recap passive — and as an _end-of-day_ recap its natural evaluation is late-day, not the inherited 09:00).
  3. Send exactly that one and record it in the `notification_sends` ledger (§ Data model). Sending only one _is_ the global cap (≤1 discretionary/user/day); the ledger row also dedups re-runs (`onConflictDoNothing` on `(user, category, local-day)`).
  - This requires consolidating today's independent discretionary crons into the single selection pass — the _mechanism_ is for writing-plans; the **ranking is confirmed** (§9).
  - **`winback` cooldown:** additionally suppressed for **30 days** after its last send (query `notification_sends`), independent of the daily cap.
- **Quiet hours** (Lane B only): default **21:00–08:00 local**, timezone-aware via the existing `parseTimezone` + stored-tz path. Lane A ignores quiet hours.
- **Preferences model:** extend `users.reminderMutes` (3 booleans) into `users.notificationPrefs` (jsonb): per-category enable/disable, `quietHours {start,end}`, an `ambientPush` opt-in toggle, and a master `transactionalEnabled`. Backfilled from existing `reminderMutes` on migration.
- **Permission priming** (iOS + Android 13+ both need runtime grant): **never ask at cold launch.** Prime contextually at the first moment push pays off (setting a commitment, or kicking off an async import/image), behind a custom pre-permission explainer so a "No" doesn't permanently burn the OS prompt.

### Preferences UI (both / split — over one shared `notificationPrefs`)

- **`CoachRemindersScreen`** keeps the coach-lane category toggles (`commitment`, `scan-nudge`, `daily-recap`).
- **New Profile → Notifications screen** owns global settings: quiet-hours window, OS permission status + re-prompt, `transactionalEnabled` master, `winback` toggle, `ambientPush` opt-in, value-delivery toggles.
- Both surfaces read/write the same `notificationPrefs` object — they cannot drift.

### Data model touch points

- `users.reminderMutes` → `users.notificationPrefs` (jsonb), adding `quietHours {start,end}`, `ambientPush`, `transactionalEnabled`. **Phasing matters (§5):** Phase 0 migrates _structure only, preserving today's keys_ (`meal-log`/`commitment`/`daily-checkin`); the category **rename** (`meal-log`→`scan-nudge`, `daily-checkin`→`daily-recap`) lands in Phase 1 **atomically with the producer + registry rename**, so no window exists where a producer reads a key the prefs no longer have (a split would silently un-mute previously-muted users).
- **New `notification_sends` ledger table** — the governance accounting store (dedup + global cap + `winback` cooldown), unique on `(user, category, local-day)`. **Why a new table, not `pending_reminders`:** verified 2026-06-25 that `hasPendingReminders` / `acknowledgeReminders` ([storage/reminders.ts](server/storage/reminders.ts)) select **all** unacknowledged rows with **no type filter** — so a cap/ledger row written into `pending_reminders` would light the premium-gated **Coach badge** and be swept by acknowledge (parsed as a malformed `CoachContextItem`). A dedicated single-purpose ledger is simpler than threading a type filter through every consumer — and a send-ledger is **not** a queue, so the deferred-queue decision stands.
- `pending_reminders` stays the **coach in-app inbox** (the badge): read path unchanged; in Phase 1 its `type` values are renamed to `scan-nudge` / `daily-recap`.

---

## 5. Phased Rollout

Consolidation-first — most risk lives in the refactor, so de-risk that before adding anything new.

- **Phase 0 — Foundation (zero behavior change):** build the `notify()` facade + category registry registered with **today's** keys; route existing producers (commitment cron, daily-checkin/meal-log writes) through it; **structure-only** prefs migration `reminderMutes` → `notificationPrefs` _preserving today's keys_ + new fields; add the `notification_sends` ledger table. No category renames, no new user-visible notifications. Pure refactor, fully under test.
- **Phase 1 — Reframe coach nudges (atomic rename):** rename prefs keys + producer triggers + registry **together** (`meal-log`→`scan-nudge`, `daily-checkin`→`daily-recap`) + new copy — done in one coordinated change so no muted user is transiently un-muted. Consolidate the discretionary crons into the single daily selection pass; quiet hours + global cap + priority ranking go live.
- **Phase 2 — Value-delivery + prefs UI:** wire `recipe-image-ready` + `recipe-import-complete` transactional pushes; ship the Profile → Notifications screen + contextual permission priming.
- **Phase 3 — Win-back:** inactivity detection (N days, no scan), value-anchored copy, 30-day cooldown. Highest product risk, last, behind the cap.
- **Deferred:** `product-verified`, subscription-expiry.

> Phase 0 is the whole bet: making the facade a behavior-preserving refactor first turns every later phase into a small, isolated change _through a tested front door_. It also makes the strategy reversible — dropping `winback` is deleting one registry entry, not untangling call sites.

**Scope note for planning:** Phase 0 alone is the scope of the _first_ writing-plans plan. Do not attempt to plan all four phases at once — each later phase gets its own plan once its predecessor lands.

---

## 6. Testing Strategy

Vitest, reusing the patterns in `server/services/__tests__/push-notifications.test.ts` and `notification-scheduler.test.ts`:

- Facade routing: category → lane → channel.
- Policy gate: prefs, quiet hours, cap.
- Cap + priority (`notification_sends`): the daily selection pass, given several eligible discretionary categories, sends exactly one = the highest-priority (`winback` > `scan-nudge` > `daily-recap`); a re-run the same day is a no-op (dedup).
- `winback` 30-day cooldown (from `notification_sends`).
- `notification_sends` writes never surface in the Coach badge: `hasPendingReminders` stays false after a ledger/cap write (the §4 Finding-1 regression guard).
- Prefs migration: Phase 0 asserts a **key-preserving** structure migration (zero behavior change); Phase 1 asserts the **atomic remap** (`meal-log`→`scan-nudge`, `daily-checkin`→`daily-recap`) preserves each mute under its new key with no mid-migration un-mute.
- Cross-platform permission priming (iOS + Android 13+); Android channel already set up.

---

## 7. Success Criteria

- No producer calls `sendPushToUser` / `createPendingReminder` directly — the facade is the only path (grep/lint guard).
- Lane B always honors prefs + quiet hours; Lane A always bypasses them.
- No duplicate sends (unique-index proven in test).
- OS permission is never requested at cold launch.
- Governance writes (`notification_sends` cap/ledger rows) never appear in the Coach badge or acknowledge flow.
- Prefs migration preserves every mute: Phase 0 key-preserving (zero behavior change), Phase 1 atomic remap with no mid-migration un-mute.

---

## 8. Risks & Mitigations

| Risk                                                                                                                                                                                                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lane A completion hooks (verified 2026-06-25): `recipe-import-complete` is clean — the route handler ([recipe-import.ts](server/routes/recipe-import.ts)) has `userId` in scope. `recipe-image-ready` finishes in `generateAndPatchRecipeImage` ([recipe-generation.ts:371](server/services/recipe-generation.ts)) keyed by `recipeId` with **no `userId` in scope.** | Phase 2 resolves the owning/importing user from the recipe before `notify()` (or threads `userId` through that call path). v1 trimmed to these two known-async events; `product-verified` deferred.         |
| Quiet-hours DST / timezone bug suppresses or mistimes a whole tz cohort                                                                                                                                                                                                                                                                                               | Reuse the already-tested `parseTimezone` + stored-tz path; unit-test a DST boundary.                                                                                                                        |
| Schema migration is DDL — Phase 0 adds the `notification_sends` table + `notificationPrefs` column (key-preserving); Phase 1 renames `pending_reminders.type` values                                                                                                                                                                                                  | Per the Railway expand/contract rule: **migrate prod before merge**; old build ignores the new column/table. The Phase 1 value-rename is the riskier step — ship prefs + producer + data together (see §5). |
| OS permission denial is permanent                                                                                                                                                                                                                                                                                                                                     | Custom pre-permission explainer before the native dialog.                                                                                                                                                   |
| `winback` feels spammy                                                                                                                                                                                                                                                                                                                                                | Single nudge, value-anchored, counts against the cap, 30-day cooldown, opt-out in prefs.                                                                                                                    |

---

## 9. Open Decisions for Implementation Planning

- ✅ **Confirmed 2026-06-25: discretionary priority ranking `winback` > `scan-nudge` > `daily-recap`,** enforced by the single daily selection pass (§4) — a first-come unique-index claim was rejected because the cron schedule would override the ranking. Open for writing-plans: the selection pass's run-time and the cron-consolidation mechanism.
- `recipe-image-ready` **target-user resolution:** map `recipeId` → owning/importing `userId` at the image-gen completion point (community-recipe ownership semantics) — required before this category can `notify()`.
- Exact `winback` inactivity threshold `N` (days) and the value-anchor source (new verified products vs. saved recipe vs. unfinished import).
- Whether `recipe-import-complete` and `recipe-image-ready` collapse into one "your recipe is ready" notification when both fire for the same recipe.
- Final default quiet-hours window and daily cap number (defaults proposed; confirm against any analytics).
