# Notification Strategy — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a single in-process `notify()` facade + category registry that all notification producers call, plus the `notification_sends` ledger table and an additive (write/backfill-only) `notificationPrefs` column — with **zero user-visible behavior change**.

**Architecture:** A `notify(userId, category, payload)` facade in `server/services/notifications/` routes each notification through a static category registry to the right channel(s) (`sendPushToUser` for push, `createPendingReminder` for the in-app Coach badge), and records a row in the new `notification_sends` ledger for discretionary categories. The daily cron scheduler is refactored to call `notify()` instead of calling `sendPushToUser` / `createPendingReminder` directly. No category renames, no cap/quiet-hours enforcement, no new notifications — those are later phases.

**Tech Stack:** TypeScript (strict), Express, Drizzle ORM + PostgreSQL, Vitest (DB-transaction harness), expo-server-sdk (already wired).

**Spec:** `docs/superpowers/specs/2026-06-25-notification-strategy-design.md` (§5 Phase 0).

## Global Constraints

- **Zero behavior change.** No user-visible notification changes. The existing suite — `server/services/__tests__/notification-scheduler.test.ts` — must still describe the same outcomes (updated only for the internal `notify()` seam, never for changed behavior).
- **`notificationPrefs` is write/backfill-only this phase — never read.** Mute decisions continue to read `users.reminderMutes`. (The column is the expand step for Phase 1.)
- **No category renames.** Registry + producers keep today's keys: `commitment`, `daily-checkin`, `meal-log`.
- **Idempotency via the DB unique index**, never an in-memory accumulator (`pending_reminders_user_type_day_idx`; the new `notification_sends` gets its own day-bucket unique index).
- **Migrations:** `npm run db:push` for the local/dev + Vitest DB (stateless drizzle-kit). Per the Railway expand/contract rule, **prod schema is migrated manually before merge** — additive column + new table only, so the running build ignores both (zero-downtime). DB is `postgresql://localhost/nutricam`; Vitest hits the same DB.
- **TDD, frequent commits.** Each task ends green + committed. Storage tests use the transaction harness in `test/db-test-utils.ts` (`setupTestTransaction` / `rollbackTestTransaction` / `closeTestPool` / `createTestUser` / `getTestTx`) with `vi.mock("../../db", () => ({ get db() { return getTestTx(); } }))`.
- **Worktree:** all work happens in the `worktree-notification-strategy` worktree; commits land on its branch.

---

## File Structure

**Create:**

- `server/services/notifications/registry.ts` — static category registry (lane, channels, countsAgainstCap) + derived `NotificationCategoryKey` type. One responsibility: declare what each category is.
- `server/services/notifications/notify.ts` — the `notify()` facade. One responsibility: route a notification to its channels + ledger.
- `server/services/notifications/__tests__/notify.test.ts` — facade unit tests (mocked storage + push).
- `server/storage/notification-sends.ts` — storage module for the `notification_sends` ledger.
- `server/storage/__tests__/notification-sends.test.ts` — ledger storage tests (DB-tx harness).

**Modify:**

- `shared/schema.ts` — add `notificationSends` table + types; add `notificationPrefs` column to `users`.
- `shared/types/reminders.ts` — add `NotificationPrefs` + `NotificationQuietHours` types.
- `server/storage/index.ts` — wire `notification-sends` storage methods into the composed `storage` object.
- ~~`server/storage/users.ts` — add `"notificationPrefs"` to the update whitelist.~~ **DEFERRED to Phase 1** (see Task 3 Step 3) — no Phase-0 write path needs it.
- `server/services/notification-scheduler.ts` — route the three producers through `notify()`.
- `server/services/__tests__/notification-scheduler.test.ts` — update mocks/assertions for the `notify()` seam (same outcomes).

**Migration artifact:**

- `migrations/0011_notification_phase0.sql` — hand SQL for the additive column + new table + backfill, for the prod pre-merge migration (dev uses `db:push`).

---

## Task 1: `notification_sends` table + types

**Files:**

- Modify: `shared/schema.ts` (add table after `pushTokens`, ~line 1882)
- (No test file — schema is exercised by Task 2's storage tests.)

**Interfaces:**

- Produces: `notificationSends` table; `NotificationSend` (`$inferSelect`), `InsertNotificationSend` (`$inferInsert`). Columns: `id`, `userId`, `category: string`, `sentAt: Date`, `createdAt`. Unique index on `(userId, category, DATE(sentAt AT TIME ZONE 'UTC'))`.

- [ ] **Step 1: Add the table + types to `shared/schema.ts`**

Add immediately after the `pushTokens` block (after the `PushToken` / `InsertPushToken` type exports):

```typescript
/**
 * Notification governance ledger — one row per discretionary notification sent.
 * Powers the daily global cap and the winback cooldown (Phase 1+). Kept SEPARATE
 * from pending_reminders because that table is the coach in-app inbox and its read
 * path (hasPendingReminders/acknowledgeReminders) is type-agnostic — a ledger row
 * there would light the Coach badge. See the notification strategy spec, §4.
 */
export const notificationSends = pgTable(
  "notification_sends",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    category: text("category").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    // One discretionary send per user+category per UTC calendar day = the dedup
    // guard (mirrors pending_reminders' day-bucket index).
    uniqueIndex("notification_sends_user_category_day_idx").on(
      table.userId,
      table.category,
      sql`DATE(${table.sentAt} AT TIME ZONE 'UTC')`,
    ),
    // Supports the winback cooldown lookup (latest send for a user+category).
    index("notification_sends_user_category_sent_idx").on(
      table.userId,
      table.category,
      table.sentAt,
    ),
  ],
);

export type NotificationSend = typeof notificationSends.$inferSelect;
export type InsertNotificationSend = typeof notificationSends.$inferInsert;
```

(`pgTable`, `serial`, `varchar`, `text`, `timestamp`, `uniqueIndex`, `index`, `sql` are already imported at the top of `schema.ts` — verify no new import is needed.)

- [ ] **Step 2: Push the schema to the dev/test DB**

Run: `npm run db:push`
Expected: drizzle-kit reports creating `notification_sends` + its indexes, no destructive changes.

- [ ] **Step 3: Type-check**

Run: `npm run check:types`
Expected: PASS (new types compile; `NotificationSend.category` is `string`).

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(notifications): add notification_sends governance ledger table"
```

---

## Task 2: `notification_sends` storage module

**Files:**

- Create: `server/storage/notification-sends.ts`
- Modify: `server/storage/index.ts` (import + compose, near the push-tokens/reminders wiring ~line 309–318)
- Test: `server/storage/__tests__/notification-sends.test.ts`

**Interfaces:**

- Consumes: `notificationSends` table (Task 1); `db` from `../db`.
- Produces (added to the composed `storage` object):
  - `recordNotificationSend(data: { userId: string; category: string; sentAt: Date }): Promise<void>` — insert with `onConflictDoNothing` (idempotent per user+category+UTC-day).
  - `getLastNotificationSend(userId: string, category: string): Promise<Date | null>` — latest `sentAt` for the pair, or null. (Used by the Phase 1 winback cooldown.)

- [ ] **Step 1: Write the failing test** — `server/storage/__tests__/notification-sends.test.ts`

```typescript
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { recordNotificationSend, getLastNotificationSend } = await import(
  "../notification-sends"
);

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("notification-sends storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("records a send and returns it as the last send", async () => {
    const when = new Date("2026-06-25T10:00:00Z");
    await recordNotificationSend({
      userId: testUser.id,
      category: "winback",
      sentAt: when,
    });
    const last = await getLastNotificationSend(testUser.id, "winback");
    expect(last?.toISOString()).toBe(when.toISOString());
  });

  it("is idempotent for the same user+category+UTC-day (onConflictDoNothing)", async () => {
    const a = new Date("2026-06-25T08:00:00Z");
    const b = new Date("2026-06-25T20:00:00Z"); // same UTC day
    await recordNotificationSend({
      userId: testUser.id,
      category: "scan-nudge",
      sentAt: a,
    });
    await recordNotificationSend({
      userId: testUser.id,
      category: "scan-nudge",
      sentAt: b,
    });
    const rows = await tx
      .select()
      .from((await import("@shared/schema")).notificationSends);
    const scanRows = rows.filter((r) => r.category === "scan-nudge");
    expect(scanRows).toHaveLength(1); // second insert no-opped
  });

  it("returns null when there is no send for the pair", async () => {
    const last = await getLastNotificationSend(testUser.id, "winback");
    expect(last).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- server/storage/__tests__/notification-sends.test.ts`
Expected: FAIL — `Cannot find module "../notification-sends"`.

- [ ] **Step 3: Write the storage module** — `server/storage/notification-sends.ts`

```typescript
import { notificationSends } from "@shared/schema";
import { db } from "../db";
import { and, eq, desc } from "drizzle-orm";

/**
 * Record one discretionary notification send. Idempotent per (user, category,
 * UTC calendar day) via notification_sends_user_category_day_idx — a re-run the
 * same day is a no-op.
 */
export async function recordNotificationSend(data: {
  userId: string;
  category: string;
  sentAt: Date;
}): Promise<void> {
  await db.insert(notificationSends).values(data).onConflictDoNothing();
}

/** Latest sentAt for a user+category, or null if none (winback cooldown lookup). */
export async function getLastNotificationSend(
  userId: string,
  category: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ sentAt: notificationSends.sentAt })
    .from(notificationSends)
    .where(
      and(
        eq(notificationSends.userId, userId),
        eq(notificationSends.category, category),
      ),
    )
    .orderBy(desc(notificationSends.sentAt))
    .limit(1);
  return row?.sentAt ?? null;
}
```

- [ ] **Step 4: Wire into the composed storage object** — `server/storage/index.ts`

Add the import alongside the other storage imports (near line 32–33):

```typescript
import * as notificationSendsStorage from "./notification-sends";
```

Add to the composed `storage` object, right after the push-tokens block (~line 312):

```typescript
  // Notification governance ledger
  recordNotificationSend: notificationSendsStorage.recordNotificationSend,
  getLastNotificationSend: notificationSendsStorage.getLastNotificationSend,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:run -- server/storage/__tests__/notification-sends.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/storage/notification-sends.ts server/storage/index.ts server/storage/__tests__/notification-sends.test.ts
git commit -m "feat(notifications): notification_sends storage (record + last-send)"
```

---

## Task 3: `NotificationPrefs` type + `notificationPrefs` column + backfill

**Files:**

- Modify: `shared/types/reminders.ts` (add types)
- Modify: `shared/schema.ts` (add `notificationPrefs` column to the **`userProfiles`** table — that is where `reminderMutes` actually lives — after `reminderMutes` ~line 164; also import `NotificationPrefs`)
- Create: `migrations/0011_notification_phase0.sql` (additive column + backfill, for prod pre-merge)
- Test: `server/storage/__tests__/users-notification-prefs.test.ts`

> **⚠️ Table correction (deviation from the approved spec/plan — recorded for traceability):** the spec and the original plan both wrote `users.notificationPrefs`, but `reminder_mutes` is a column on **`user_profiles`** (verified against the live DB; the scheduler read path is `profile?.reminderMutes`). For the single-statement verbatim backfill to work, `notificationPrefs` MUST co-locate with `reminderMutes` on `user_profiles`. This changes only the table label — the approved architecture (extend `reminderMutes` → `notificationPrefs`, backfilled, one shared object) is preserved. **The original Step 3** (adding `notificationPrefs` to the `UpdatableProfileFields` update whitelist) **is deferred to Phase 1**: no Phase-0 code writes prefs through the update path (the backfill is raw SQL), so adding it now would expose premature, unvalidated client-writable jsonb on a health-adjacent table (YAGNI + the plan's own "write/backfill-only, never read" rule).

**Interfaces:**

- Produces: `NotificationPrefs` / `NotificationQuietHours` types; `user_profiles.notificationPrefs` jsonb column (default `'{}'::jsonb`, not null). **Not read anywhere this phase.**

- [ ] **Step 1: Add the types** — `shared/types/reminders.ts` (append)

```typescript
/** Quiet-hours window in the user's local time, "HH:MM" 24h. */
export type NotificationQuietHours = { start: string; end: string };

/**
 * Phase 0 staging shape for the unified notification preferences. `categories`
 * is a VERBATIM copy of reminderMutes (muted-boolean semantics, today's keys) —
 * NOT read this phase; Phase 1 flips reads here and renames the keys.
 */
export type NotificationPrefs = {
  categories: ReminderMutes;
  quietHours: NotificationQuietHours;
  ambientPush: boolean;
  transactionalEnabled: boolean;
};
```

- [ ] **Step 2: Add the column** — `shared/schema.ts`, in the **`userProfiles`** table (`pgTable("user_profiles", …)`, opens ~line 126) right after the `reminderMutes` block (~line 164, before `createdAt`)

```typescript
  notificationPrefs: jsonb("notification_prefs")
    .$type<NotificationPrefs>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
```

Update the existing import of reminder types at the top of `schema.ts` (currently `import type { ReminderMutes, ReminderType } from "./types/reminders";`) to also pull `NotificationPrefs`:

```typescript
import type {
  ReminderMutes,
  ReminderType,
  NotificationPrefs,
} from "./types/reminders";
```

- [ ] **Step 3: ~~Add to the update whitelist~~ — DEFERRED to Phase 1.** Do **not** modify `server/storage/users.ts` this phase. Rationale: nothing in Phase 0 writes `notificationPrefs` through the `updateUserProfile` path — the backfill (Step 6) is raw SQL and the `notify()` facade never touches prefs. Adding `"notificationPrefs"` to the `UpdatableProfileFields` Pick now would make it client-writable as unvalidated jsonb on a health-adjacent table with zero Phase-0 benefit. Phase 1 adds it to the whitelist together with read logic, validation, and the Profile → Notifications UI. (Note: the new column still flows into `InsertUserProfile` as an _optional_ field via the existing `createInsertSchema(userProfiles).omit({…})` — same exposure class as today's `reminderMutes`; no new write path is introduced by Step 2 alone.)

- [ ] **Step 4: Write the failing backfill test** — `server/storage/__tests__/users-notification-prefs.test.ts`

```typescript
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  createTestUserProfile,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { backfillNotificationPrefs } from "../notification-prefs-backfill";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

let tx: NodePgDatabase<typeof schema>;

describe("notificationPrefs backfill", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("copies reminderMutes verbatim into categories and defaults the new fields", async () => {
    const { userProfiles } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    // reminderMutes lives on user_profiles — create a user + profile with a mute
    // under TODAY's key.
    const user = await createTestUser(tx);
    await createTestUserProfile(tx, user.id, {
      reminderMutes: { "meal-log": true },
    });

    await backfillNotificationPrefs();

    const [row] = await tx
      .select({ prefs: userProfiles.notificationPrefs })
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.id));

    expect(row.prefs.categories).toEqual({ "meal-log": true }); // verbatim, no inversion
    expect(row.prefs.ambientPush).toBe(false);
    expect(row.prefs.transactionalEnabled).toBe(true);
    expect(row.prefs.quietHours).toEqual({ start: "21:00", end: "08:00" });
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm run test:run -- server/storage/__tests__/users-notification-prefs.test.ts`
Expected: FAIL — `Cannot find module "../notification-prefs-backfill"`.

- [ ] **Step 6: Write the backfill module** — `server/storage/notification-prefs-backfill.ts`

```typescript
import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * One-shot Phase 0 backfill: stage notificationPrefs from reminderMutes for every
 * user_profiles row whose notificationPrefs is still the empty default. categories
 * is a verbatim copy of reminder_mutes (muted-boolean semantics) — no inversion, no
 * key rename. Idempotent: only touches rows where notification_prefs = '{}'.
 */
export async function backfillNotificationPrefs(): Promise<void> {
  await db.execute(sql`
    UPDATE user_profiles
    SET notification_prefs = jsonb_build_object(
      'categories', reminder_mutes,
      'quietHours', jsonb_build_object('start', '21:00', 'end', '08:00'),
      'ambientPush', false,
      'transactionalEnabled', true
    )
    WHERE notification_prefs = '{}'::jsonb
  `);
}
```

- [ ] **Step 7: Push schema + run the test**

Run: `npm run db:push && npm run test:run -- server/storage/__tests__/users-notification-prefs.test.ts`
Expected: column created; test PASSES.

- [ ] **Step 8: Author the prod migration SQL** — `migrations/0011_notification_phase0.sql`

(`0011` is the next sequential number — the highest existing is `0010_users_pending_email.sql`. This file is for the manual prod pre-merge run; dev already applied the same change via `db:push`.)

```sql
-- Phase 0: notification_sends ledger + additive notificationPrefs column + backfill.
-- Additive only — the running build ignores both (zero-downtime expand step).

CREATE TABLE IF NOT EXISTS notification_sends (
  id          serial PRIMARY KEY,
  user_id     varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    text NOT NULL,
  sent_at     timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_sends_user_category_day_idx
  ON notification_sends (user_id, category, DATE(sent_at AT TIME ZONE 'UTC'));
CREATE INDEX IF NOT EXISTS notification_sends_user_category_sent_idx
  ON notification_sends (user_id, category, sent_at);

-- notificationPrefs co-locates with reminder_mutes, which is on user_profiles.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE user_profiles
SET notification_prefs = jsonb_build_object(
  'categories', reminder_mutes,
  'quietHours', jsonb_build_object('start', '21:00', 'end', '08:00'),
  'ambientPush', false,
  'transactionalEnabled', true
)
WHERE notification_prefs = '{}'::jsonb;
```

> **Prod runbook (do NOT run locally; before merging the PR):**
> `railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -f migrations/0011_notification_phase0.sql'`

- [ ] **Step 9: Type-check + commit**

Run: `npm run check:types`
Expected: PASS.

```bash
git add shared/types/reminders.ts shared/schema.ts \
  server/storage/notification-prefs-backfill.ts \
  server/storage/__tests__/users-notification-prefs.test.ts \
  migrations/0011_notification_phase0.sql
git commit -m "feat(notifications): stage notificationPrefs column + verbatim backfill (write-only)"
```

---

## Task 4: Category registry

**Files:**

- Create: `server/services/notifications/registry.ts`
- Test: `server/services/notifications/__tests__/registry.test.ts`

**Interfaces:**

- Produces:
  - `type NotificationLane = "transactional" | "governed"`
  - `type NotificationChannel = "push" | "in-app" | "local"`
  - `interface NotificationCategoryDef { lane: NotificationLane; channels: NotificationChannel[]; countsAgainstCap: boolean }`
  - `const NOTIFICATION_REGISTRY` — Phase 0 keys only: `commitment`, `daily-checkin`, `meal-log`.
  - `type NotificationCategoryKey = keyof typeof NOTIFICATION_REGISTRY`
  - `getCategoryDef(category: NotificationCategoryKey): NotificationCategoryDef`

- [ ] **Step 1: Write the failing test** — `server/services/notifications/__tests__/registry.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { NOTIFICATION_REGISTRY, getCategoryDef } from "../registry";

describe("notification registry", () => {
  it("commitment is governed, in-app + push, not capped (dated)", () => {
    const def = getCategoryDef("commitment");
    expect(def.lane).toBe("governed");
    expect(def.channels).toEqual(["in-app", "push"]);
    expect(def.countsAgainstCap).toBe(false);
  });

  it("daily-checkin and meal-log are ambient: in-app only, capped", () => {
    for (const key of ["daily-checkin", "meal-log"] as const) {
      const def = getCategoryDef(key);
      expect(def.lane).toBe("governed");
      expect(def.channels).toEqual(["in-app"]);
      expect(def.countsAgainstCap).toBe(true);
    }
  });

  it("registers exactly the three Phase 0 categories", () => {
    expect(Object.keys(NOTIFICATION_REGISTRY).sort()).toEqual([
      "commitment",
      "daily-checkin",
      "meal-log",
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- server/services/notifications/__tests__/registry.test.ts`
Expected: FAIL — `Cannot find module "../registry"`.

- [ ] **Step 3: Write the registry** — `server/services/notifications/registry.ts`

```typescript
/**
 * Static notification category registry. Declares, per category, its lane,
 * default channel(s), and whether it counts against the (Phase 1) discretionary
 * daily cap. Phase 0 registers only the categories today's producers emit; later
 * phases add value-delivery + reframed categories.
 */
export type NotificationLane = "transactional" | "governed";
export type NotificationChannel = "push" | "in-app" | "local";

export interface NotificationCategoryDef {
  lane: NotificationLane;
  channels: NotificationChannel[];
  /** Discretionary nudges count against the Phase 1 daily cap; dated/explicit ones don't. */
  countsAgainstCap: boolean;
}

export const NOTIFICATION_REGISTRY = {
  commitment: {
    lane: "governed",
    channels: ["in-app", "push"],
    countsAgainstCap: false, // dated coach follow-up, not discretionary
  },
  "daily-checkin": {
    lane: "governed",
    channels: ["in-app"],
    countsAgainstCap: true,
  },
  "meal-log": {
    lane: "governed",
    channels: ["in-app"],
    countsAgainstCap: true,
  },
} satisfies Record<string, NotificationCategoryDef>;

export type NotificationCategoryKey = keyof typeof NOTIFICATION_REGISTRY;

export function getCategoryDef(
  category: NotificationCategoryKey,
): NotificationCategoryDef {
  return NOTIFICATION_REGISTRY[category];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- server/services/notifications/__tests__/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/notifications/registry.ts server/services/notifications/__tests__/registry.test.ts
git commit -m "feat(notifications): category registry (commitment, daily-checkin, meal-log)"
```

---

## Task 5: `notify()` facade

**Files:**

- Create: `server/services/notifications/notify.ts`
- Test: `server/services/notifications/__tests__/notify.test.ts`

**Interfaces:**

- Consumes: `getCategoryDef` + `NotificationCategoryKey` (Task 4); `storage.createPendingReminder`, `storage.recordNotificationSend` (Task 2); `sendPushToUser` (existing).
- Produces:
  - `interface NotifyPayload { title?: string; body?: string; data?: Record<string, unknown>; context?: Record<string, unknown>; scheduledFor?: Date }`
  - `interface NotifyResult { pushDelivered: boolean }`
  - `async function notify(userId: string, category: NotificationCategoryKey, payload?: NotifyPayload): Promise<NotifyResult>`

  Behavior per registry def: `in-app` channel → `createPendingReminder({ userId, type: category, context: payload.context ?? {}, scheduledFor })` (idempotent via the unique index); `push` channel → `pushDelivered = await sendPushToUser(userId, title, body, data)`; `countsAgainstCap` → `recordNotificationSend({ userId, category, sentAt: scheduledFor })`. `scheduledFor` defaults to `new Date()`.

- [ ] **Step 1: Write the failing test** — `server/services/notifications/__tests__/notify.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../../storage";
import { sendPushToUser } from "../../push-notifications";
import { notify } from "../notify";

vi.mock("../../../storage", () => ({
  storage: {
    createPendingReminder: vi.fn(),
    recordNotificationSend: vi.fn(),
  },
}));
vi.mock("../../push-notifications", () => ({
  sendPushToUser: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("notify()", () => {
  it("commitment → in-app reminder + push, no ledger (not capped); returns delivery", async () => {
    vi.mocked(sendPushToUser).mockResolvedValue(true);
    const when = new Date("2026-06-25T09:00:00Z");

    const result = await notify("u1", "commitment", {
      title: "Coach reminder",
      body: "Walk 10k",
      data: { entryId: 7 },
      context: { notebookEntryId: 7, content: "Walk 10k" },
      scheduledFor: when,
    });

    expect(storage.createPendingReminder).toHaveBeenCalledWith({
      userId: "u1",
      type: "commitment",
      context: { notebookEntryId: 7, content: "Walk 10k" },
      scheduledFor: when,
    });
    expect(sendPushToUser).toHaveBeenCalledWith(
      "u1",
      "Coach reminder",
      "Walk 10k",
      { entryId: 7 },
    );
    expect(storage.recordNotificationSend).not.toHaveBeenCalled();
    expect(result.pushDelivered).toBe(true);
  });

  it("meal-log → in-app only + ledger row (capped), no push", async () => {
    const when = new Date("2026-06-25T12:00:00Z");

    const result = await notify("u1", "meal-log", {
      context: { lastLoggedAt: null },
      scheduledFor: when,
    });

    expect(storage.createPendingReminder).toHaveBeenCalledWith({
      userId: "u1",
      type: "meal-log",
      context: { lastLoggedAt: null },
      scheduledFor: when,
    });
    expect(storage.recordNotificationSend).toHaveBeenCalledWith({
      userId: "u1",
      category: "meal-log",
      sentAt: when,
    });
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(result.pushDelivered).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- server/services/notifications/__tests__/notify.test.ts`
Expected: FAIL — `Cannot find module "../notify"`.

- [ ] **Step 3: Write the facade** — `server/services/notifications/notify.ts`

```typescript
/**
 * The single front door for sending a user-facing notification. Producers call
 * notify() instead of sendPushToUser / createPendingReminder directly. Routes by
 * the category registry to the right channel(s) and records discretionary sends
 * in the notification_sends ledger. Phase 0: no cap/quiet-hours enforcement — pure
 * routing that preserves today's behavior.
 */
import { storage } from "../../storage";
import { sendPushToUser } from "../push-notifications";
import { getCategoryDef, type NotificationCategoryKey } from "./registry";

export interface NotifyPayload {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  context?: Record<string, unknown>;
  scheduledFor?: Date;
}

export interface NotifyResult {
  pushDelivered: boolean;
}

export async function notify(
  userId: string,
  category: NotificationCategoryKey,
  payload: NotifyPayload = {},
): Promise<NotifyResult> {
  const def = getCategoryDef(category);
  const scheduledFor = payload.scheduledFor ?? new Date();
  let pushDelivered = false;

  if (def.channels.includes("in-app")) {
    await storage.createPendingReminder({
      userId,
      type: category,
      context: payload.context ?? {},
      scheduledFor,
    });
  }

  if (def.channels.includes("push")) {
    pushDelivered = await sendPushToUser(
      userId,
      payload.title ?? "",
      payload.body ?? "",
      payload.data,
    );
  }

  if (def.countsAgainstCap) {
    await storage.recordNotificationSend({
      userId,
      category,
      sentAt: scheduledFor,
    });
  }

  return { pushDelivered };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- server/services/notifications/__tests__/notify.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/notifications/notify.ts server/services/notifications/__tests__/notify.test.ts
git commit -m "feat(notifications): notify() facade routing by category registry"
```

---

## Task 6: Route the scheduler producers through `notify()`

**Files:**

- Modify: `server/services/notification-scheduler.ts`
- Modify: `server/services/__tests__/notification-scheduler.test.ts`

**Interfaces:**

- Consumes: `notify` (Task 5).
- Behavior preserved: commitment → in-app + push, mark entry completed iff `pushDelivered`; daily-checkin / meal-log → in-app pending reminder (now also a ledger row). The explicit `hasPendingReminderToday` pre-checks are removed — `notify()` → `createPendingReminder` is idempotent via the unique index, so outcomes are unchanged.

- [ ] **Step 1: Update the commitment producer** — in `sendDueCommitmentReminders`, replace the `createPendingReminder` + `sendPushToUser` block (the `alreadyPending` check, the conditional create, and the `sendPushToUser` call) with a single `notify()` call.

Replace this region:

```typescript
      const tz = parseTimezone(tzMap.get(entry.userId));
      const alreadyPending = await storage.hasPendingReminderToday(
        entry.userId,
        "commitment",
        tz,
      );
      if (!alreadyPending) {
        await storage.createPendingReminder({
          userId: entry.userId,
          type: "commitment",
          context: {
            notebookEntryId: entry.id,
            content: entry.content.slice(0, 200),
          },
          scheduledFor: new Date(),
        });
      }

      const delivered = await sendPushToUser(
        entry.userId,
        "Coach reminder",
        entry.content.slice(0, 100),
        { entryId: entry.id },
      );

      if (delivered) {
```

with:

```typescript
      const { pushDelivered } = await notify(entry.userId, "commitment", {
        title: "Coach reminder",
        body: entry.content.slice(0, 100),
        data: { entryId: entry.id },
        context: {
          notebookEntryId: entry.id,
          content: entry.content.slice(0, 200),
        },
      });

      if (pushDelivered) {
```

(The surrounding `isMuted(profile?.reminderMutes, "commitment")` guard and the `updateNotebookEntryStatus(..., "completed")` call stay exactly as they are. `parseTimezone`/`tz` is no longer needed in this function — remove the now-unused `tz` line if it has no other use here; keep the `parseTimezone` import, still used by the other producers.)

- [ ] **Step 2: Update the daily-checkin producer** — in `sendDailyCheckinReminders`, replace the dedup + create block:

Replace:

```typescript
// Day-bucket in the user's stored timezone (NULL/invalid → "UTC").
const tz = parseTimezone(tzMap.get(userId));
const alreadyPending = await storage.hasPendingReminderToday(
  userId,
  "daily-checkin",
  tz,
);
if (alreadyPending) return;

const summary = await storage.getDailySummary(userId, new Date(), tz);

await storage.createPendingReminder({
  userId,
  type: "daily-checkin",
  context: { calories: Math.round(summary.totalCalories) },
  scheduledFor: new Date(),
});
```

with:

```typescript
// Day-bucket in the user's stored timezone (NULL/invalid → "UTC").
const tz = parseTimezone(tzMap.get(userId));
const summary = await storage.getDailySummary(userId, new Date(), tz);

await notify(userId, "daily-checkin", {
  context: { calories: Math.round(summary.totalCalories) },
});
```

- [ ] **Step 3: Update the meal-log producer** — in `sendMealLogReminders`, replace the dedup + create block (keep the `getDailyLogs` eligibility early-return):

Replace:

```typescript
const logs = await storage.getDailyLogs(userId, new Date(), tz);
if (logs.length > 0) return;
const alreadyPending = await storage.hasPendingReminderToday(
  userId,
  "meal-log",
  tz,
);
if (alreadyPending) return;

await storage.createPendingReminder({
  userId,
  type: "meal-log",
  context: { lastLoggedAt: null },
  scheduledFor: new Date(),
});
```

with:

```typescript
const logs = await storage.getDailyLogs(userId, new Date(), tz);
if (logs.length > 0) return;

await notify(userId, "meal-log", {
  context: { lastLoggedAt: null },
});
```

- [ ] **Step 4: Update imports** — at the top of `server/services/notification-scheduler.ts`, remove the now-unused direct `sendPushToUser` import and add `notify`:

Remove:

```typescript
import { sendPushToUser } from "./push-notifications";
```

Add (next to the other service imports):

```typescript
import { notify } from "./notifications/notify";
```

- [ ] **Step 5: Update the scheduler tests** — `server/services/__tests__/notification-scheduler.test.ts`

The scheduler no longer calls `sendPushToUser` / `createPendingReminder` / `hasPendingReminderToday` directly — it calls `notify()`. Mock `notify` instead and assert on it.

Replace the `vi.mock("../push-notifications", ...)` block with a mock of the facade:

```typescript
import { notify } from "../notifications/notify";

vi.mock("../notifications/notify", () => ({
  notify: vi.fn(),
}));
```

Remove `hasPendingReminderToday` and `createPendingReminder` from the `vi.mock("../../storage", ...)` method list (they're no longer called here); keep `getDueCommitmentsAllUsers`, `updateNotebookEntryStatus`, `getUserIdPage`, `getUserTimezones`, `getUserProfile`, `getDailyLogs`, `getDailySummary`.

In `beforeEach`, default the facade mock:

```typescript
vi.mocked(notify).mockResolvedValue({ pushDelivered: true });
```

Update assertions to the new seam. For the commitment "delivered → mark completed" test:

```typescript
expect(notify).toHaveBeenCalledWith(
  "user-1",
  "commitment",
  expect.objectContaining({
    title: "Coach reminder",
    data: { entryId: <entryId> },
  }),
);
expect(storage.updateNotebookEntryStatus).toHaveBeenCalledWith(
  <entryId>,
  "user-1",
  "completed",
);
```

For the "not delivered → not completed" case, set `vi.mocked(notify).mockResolvedValue({ pushDelivered: false })` and assert `updateNotebookEntryStatus` was NOT called.

For daily-checkin / meal-log tests, assert `notify(userId, "daily-checkin", ...)` / `notify(userId, "meal-log", ...)` were called (replacing the old `createPendingReminder` assertions); the mute-skip and meal-log "already logged → skip" cases now assert `notify` was NOT called.

- [ ] **Step 6: Run the scheduler suite**

Run: `npm run test:run -- server/services/__tests__/notification-scheduler.test.ts`
Expected: PASS — same number of behavioral cases, now asserting through `notify()`.

- [ ] **Step 7: Type-check + commit**

Run: `npm run check:types`
Expected: PASS (no remaining `sendPushToUser` reference in the scheduler).

```bash
git add server/services/notification-scheduler.ts server/services/__tests__/notification-scheduler.test.ts
git commit -m "refactor(notifications): route scheduler producers through notify() facade"
```

---

## Task 7: Facade-only guard (success criterion)

**Files:**

- Test: `server/services/notifications/__tests__/facade-only.test.ts`

**Interfaces:**

- Consumes: nothing at runtime — a source-grep guard enforcing the spec's success criterion ("No producer calls `sendPushToUser` / `createPendingReminder` directly — the facade is the only path").

- [ ] **Step 1: Write the guard test** — `server/services/notifications/__tests__/facade-only.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Files allowed to reference the low-level senders: the facade itself, the push
// service module, the storage module that defines createPendingReminder, and tests.
const ALLOWLIST = [
  "server/services/notifications/notify.ts",
  "server/services/push-notifications.ts",
  "server/storage/reminders.ts",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") return [];
      return walk(p);
    }
    return p.endsWith(".ts") ? [p] : [];
  });
}

describe("facade-only enforcement", () => {
  it("no producer calls sendPushToUser or createPendingReminder directly", () => {
    const files = walk("server").filter(
      (f) => !ALLOWLIST.some((a) => f.endsWith(a)),
    );
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        /\bsendPushToUser\s*\(/.test(src) ||
        /\bcreatePendingReminder\s*\(/.test(src)
      );
    });
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it passes (Task 6 already removed the direct calls)**

Run: `npm run test:run -- server/services/notifications/__tests__/facade-only.test.ts`
Expected: PASS. If it FAILS, the listed offender file still calls a low-level sender directly — route it through `notify()`.

- [ ] **Step 3: Commit**

```bash
git add server/services/notifications/__tests__/facade-only.test.ts
git commit -m "test(notifications): guard that notify() is the only send path"
```

---

## Self-Review

**Spec coverage (§5 Phase 0):**

- "build the `notify()` facade + category registry registered with today's keys" → Tasks 4 + 5.
- "route existing producers through it" → Task 6.
- "structure-only prefs migration preserving today's keys + new fields" → Task 3 (verbatim `categories` copy, `quietHours`/`ambientPush`/`transactionalEnabled` added; **not read** this phase).
- "add the `notification_sends` ledger table" → Tasks 1 + 2 (+ wired into `notify()` in Task 5).
- "No category renames, no new user-visible notifications. Pure refactor, fully under test." → registry/producers keep `commitment`/`daily-checkin`/`meal-log`; Lane A categories absent; behavior preserved; every task is TDD. Success criterion ("facade is the only path") → Task 7.
- Out of Phase 0 (correctly absent): quiet-hours/cap enforcement, selection pass, key rename, Profile Notifications screen, permission priming, Lane A wiring — all later phases per spec §5.

**Placeholder scan:** No TBD/TODO; every code + test step shows complete content. The prod migration filename is resolved to `0011` (next sequential after `0010_users_pending_email.sql`). **Post-review correction (2026-06-25):** Task 3 originally targeted the `users` table; the live DB shows `reminder_mutes` is on `user_profiles`, so the column, backfill, test, and prod migration were all moved to `user_profiles`, and the update-whitelist step was deferred to Phase 1 (no Phase-0 write path). Tasks 1–2 (`notification_sends`, keyed off `users(id)`) are unaffected.

**Type consistency:** `recordNotificationSend(data: {userId, category, sentAt})` defined in Task 2, called identically in Task 5. `notify(userId, category, payload)` / `NotifyResult.pushDelivered` defined in Task 5, consumed identically in Task 6. `NotificationCategoryKey` (Task 4) used as `notify`'s `category` param type (Task 5). `NotificationPrefs.categories: ReminderMutes` (Task 3) matches the verbatim backfill (Task 3 Step 8 SQL + Step 6 module).
