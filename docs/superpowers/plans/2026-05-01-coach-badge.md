# Coach Tab Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small red dot on the Coach tab when the server has queued a proactive reminder for the user; tapping the tab navigates into Coach chat where the AI opens with a contextual message drawn from the pending reminder(s).

**Architecture:** A new `pendingReminders` DB table is the source of truth. The existing daily cron at 09:00 is extended (and a new 12:00 PM cron added) to insert rows for meal-log nudges, commitment follow-ups, and daily check-ins. The client polls `GET /api/reminders/pending` on every app-foreground event; the dot clears when `POST /api/reminders/acknowledge` is called (on Coach tab focus), which also returns the context the AI uses to craft its opening message. Per-category muting is stored as JSONB on `userProfiles` and managed via a new settings screen.

**Tech Stack:** Drizzle ORM + PostgreSQL (schema + storage), Express 5 (routes), TanStack Query v5 + React Native (client), Vitest + Supertest (tests).

**Spec:** `docs/superpowers/specs/2026-05-01-coach-badge-design.md`

---

## File Map

| File                                                       | Action | Responsibility                                                                                |
| ---------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `shared/schema.ts`                                         | Modify | Add `pendingReminders` table + `reminderMutes` JSONB column on `userProfiles`                 |
| `shared/types/reminders.ts`                                | Create | `CoachContextItem` discriminated union + `ReminderMutes` type                                 |
| `server/storage/reminders.ts`                              | Create | CRUD for `pendingReminders`                                                                   |
| `server/storage/users.ts`                                  | Modify | Add `getAllUserIds()` + `reminderMutes` to `UpdatableProfileFields`                           |
| `server/storage/index.ts`                                  | Modify | Export new reminders storage functions + `getAllUserIds`                                      |
| `server/__tests__/factories/reminders.ts`                  | Create | `createMockPendingReminder` factory                                                           |
| `server/__tests__/factories/index.ts`                      | Modify | Re-export new factory                                                                         |
| `server/services/notification-scheduler.ts`                | Modify | Add `sendDailyCheckinReminders()`, `sendMealLogReminders()`, second cron at 12:00 PM          |
| `server/services/__tests__/notification-scheduler.test.ts` | Modify | Tests for new scheduler functions                                                             |
| `server/routes/reminders.ts`                               | Create | `GET /api/reminders/pending`, `POST /api/reminders/acknowledge`, `PATCH /api/reminders/mutes` |
| `server/routes/__tests__/reminders.test.ts`                | Create | Route-level tests                                                                             |
| `server/routes.ts`                                         | Modify | Register reminders routes                                                                     |
| `client/hooks/usePendingReminders.ts`                      | Create | Polls `GET /api/reminders/pending` on app foreground                                          |
| `client/hooks/useAcknowledgeReminders.ts`                  | Create | Mutation for `POST /api/reminders/acknowledge`                                                |
| `client/hooks/__tests__/usePendingReminders.test.ts`       | Create | Hook unit tests                                                                               |
| `client/hooks/__tests__/useAcknowledgeReminders.test.ts`   | Create | Hook unit tests                                                                               |
| `client/navigation/MainTabNavigator.tsx`                   | Modify | Add red dot overlay to Coach tab icon                                                         |
| `client/screens/CoachProScreen.tsx`                        | Modify | Call `acknowledge()` on screen focus                                                          |
| `client/screens/ChatListScreen.tsx`                        | Modify | Call `acknowledge()` on screen focus                                                          |
| `client/screens/CoachRemindersScreen.tsx`                  | Create | Mute toggles for each reminder category                                                       |
| `client/navigation/ProfileStackNavigator.tsx`              | Modify | Add `CoachReminders` route                                                                    |
| `client/screens/SettingsScreen.tsx`                        | Modify | Add "Coach Reminders" nav item                                                                |

---

## Task 1: Schema — `pendingReminders` table + `reminderMutes` column

**Files:**

- Modify: `shared/schema.ts`
- Modify: `server/__tests__/factories/user.ts`

- [ ] **Step 1: Add `ReminderMutes` type import to schema**

  Open `shared/schema.ts`. At the top, after the existing type imports, add:

  ```ts
  import type { ReminderMutes } from "./types/reminders";
  ```

  (This file doesn't exist yet — you'll create it in Task 2. TypeScript will complain until then; that's fine.)

- [ ] **Step 2: Add `reminderMutes` column to `userProfiles` table**

  In `shared/schema.ts`, inside the `userProfiles` table definition, add after `glp1StartDate`:

  ```ts
  reminderMutes: jsonb("reminder_mutes")
    .$type<ReminderMutes>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
  ```

- [ ] **Step 3: Add `pendingReminders` table**

  In `shared/schema.ts`, after the `userProfiles` table (around line 90), add:

  ```ts
  export const pendingReminders = pgTable(
    "pending_reminders",
    {
      id: serial("id").primaryKey(),
      userId: varchar("user_id")
        .references(() => users.id, { onDelete: "cascade" })
        .notNull(),
      type: text("type").notNull(),
      context: jsonb("context")
        .$type<Record<string, unknown>>()
        .notNull()
        .default({}),
      scheduledFor: timestamp("scheduled_for").notNull(),
      acknowledgedAt: timestamp("acknowledged_at"),
      createdAt: timestamp("created_at")
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    },
    (table) => ({
      userPendingIdx: index("pending_reminders_user_pending_idx").on(
        table.userId,
        table.acknowledgedAt,
      ),
    }),
  );
  ```

- [ ] **Step 4: Create `shared/types/reminders.ts` (needed by schema)**

  This file is fully built in Task 2, but create it now with just enough to unblock the schema import:

  ```ts
  export type ReminderType =
    | "meal-log"
    | "commitment"
    | "daily-checkin"
    | "user-set";

  export type ReminderMutes = {
    "meal-log"?: boolean;
    commitment?: boolean;
    "daily-checkin"?: boolean;
  };

  export type CoachContextItem =
    | { type: "meal-log"; mealType: string; lastLoggedAt: string | null }
    | { type: "commitment"; notebookEntryId: number; content: string }
    | { type: "daily-checkin"; calories: number; goal: number }
    | { type: "user-set"; message: string };
  ```

- [ ] **Step 5: Verify types compile**

  ```bash
  npm run check:types
  ```

  Expected: no errors.

- [ ] **Step 6: Push schema to DB**

  ```bash
  npm run db:push
  ```

  Expected: Drizzle applies the two schema changes (new column on `user_profiles`, new table `pending_reminders`).

- [ ] **Step 7: Update `UserProfile` factory**

  In `server/__tests__/factories/user.ts`, add `reminderMutes: {}` to `userProfileDefaults`:

  ```ts
  const userProfileDefaults: UserProfile = {
    id: 1,
    userId: "1",
    allergies: [],
    healthConditions: [],
    dietType: null,
    foodDislikes: [],
    primaryGoal: null,
    activityLevel: null,
    householdSize: 1,
    cuisinePreferences: [],
    cookingSkillLevel: null,
    cookingTimeAvailable: null,
    glp1Mode: false,
    glp1Medication: null,
    glp1StartDate: null,
    reminderMutes: {}, // ← add this
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };
  ```

- [ ] **Step 8: Verify tests still pass**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass (no test references the new column yet).

- [ ] **Step 9: Commit**

  ```bash
  git add shared/schema.ts shared/types/reminders.ts server/__tests__/factories/user.ts
  git commit -m "feat: add pendingReminders table and reminderMutes column to schema"
  ```

---

## Task 2: Storage — `reminders` module

**Files:**

- Create: `server/storage/reminders.ts`
- Create: `server/__tests__/factories/reminders.ts`
- Modify: `server/__tests__/factories/index.ts`
- Modify: `server/storage/index.ts`

- [ ] **Step 1: Create the factory**

  Create `server/__tests__/factories/reminders.ts`:

  ```ts
  import type { PendingReminder } from "@shared/schema";

  const pendingReminderDefaults: PendingReminder = {
    id: 1,
    userId: "1",
    type: "daily-checkin",
    context: {},
    scheduledFor: new Date("2026-05-01T09:00:00Z"),
    acknowledgedAt: null,
    createdAt: new Date("2026-05-01T09:00:00Z"),
  };

  export function createMockPendingReminder(
    overrides: Partial<PendingReminder> = {},
  ): PendingReminder {
    return { ...pendingReminderDefaults, ...overrides };
  }
  ```

  Note: `PendingReminder` is automatically inferred by Drizzle from the `pendingReminders` table as `typeof pendingReminders.$inferSelect`. Add the export to `shared/schema.ts`:

  ```ts
  export type PendingReminder = typeof pendingReminders.$inferSelect;
  export type InsertPendingReminder = typeof pendingReminders.$inferInsert;
  ```

- [ ] **Step 2: Export factory from index**

  In `server/__tests__/factories/index.ts`, add:

  ```ts
  export { createMockPendingReminder } from "./reminders";
  ```

- [ ] **Step 3: Write the storage module**

  Create `server/storage/reminders.ts`:

  ```ts
  import { pendingReminders, userProfiles } from "@shared/schema";
  import type { CoachContextItem, ReminderType } from "@shared/types/reminders";
  import { db } from "../db";
  import { and, eq, isNull, gte, lt } from "drizzle-orm";
  import { getDayBounds } from "./helpers";

  export async function createPendingReminder(data: {
    userId: string;
    type: ReminderType;
    context: Record<string, unknown>;
    scheduledFor: Date;
  }): Promise<void> {
    await db.insert(pendingReminders).values(data);
  }

  export async function hasPendingReminderToday(
    userId: string,
    type: ReminderType,
  ): Promise<boolean> {
    const { startOfDay, endOfDay } = getDayBounds(new Date());
    const [existing] = await db
      .select({ id: pendingReminders.id })
      .from(pendingReminders)
      .where(
        and(
          eq(pendingReminders.userId, userId),
          eq(pendingReminders.type, type),
          isNull(pendingReminders.acknowledgedAt),
          gte(pendingReminders.createdAt, startOfDay),
          lt(pendingReminders.createdAt, endOfDay),
        ),
      )
      .limit(1);
    return !!existing;
  }

  export async function hasPendingReminders(userId: string): Promise<boolean> {
    const [existing] = await db
      .select({ id: pendingReminders.id })
      .from(pendingReminders)
      .where(
        and(
          eq(pendingReminders.userId, userId),
          isNull(pendingReminders.acknowledgedAt),
        ),
      )
      .limit(1);
    return !!existing;
  }

  export async function acknowledgeReminders(
    userId: string,
  ): Promise<CoachContextItem[]> {
    const pending = await db
      .select()
      .from(pendingReminders)
      .where(
        and(
          eq(pendingReminders.userId, userId),
          isNull(pendingReminders.acknowledgedAt),
        ),
      );

    if (pending.length === 0) return [];

    await db
      .update(pendingReminders)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          eq(pendingReminders.userId, userId),
          isNull(pendingReminders.acknowledgedAt),
        ),
      );

    return pending.map((r) => ({
      type: r.type as CoachContextItem["type"],
      ...r.context,
    })) as CoachContextItem[];
  }
  ```

- [ ] **Step 4: Wire into `server/storage/index.ts`**

  Add at the top of the imports block:

  ```ts
  import * as remindersStorage from "./reminders";
  ```

  Add the functions to the `storage` object (grouped with other reminder-related storage):

  ```ts
  // Reminders
  createPendingReminder: remindersStorage.createPendingReminder,
  hasPendingReminderToday: remindersStorage.hasPendingReminderToday,
  hasPendingReminders: remindersStorage.hasPendingReminders,
  acknowledgeReminders: remindersStorage.acknowledgeReminders,
  ```

- [ ] **Step 5: Verify types compile**

  ```bash
  npm run check:types
  ```

  Expected: no errors.

- [ ] **Step 6: Run tests**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add shared/schema.ts server/storage/reminders.ts server/storage/index.ts server/__tests__/factories/reminders.ts server/__tests__/factories/index.ts
  git commit -m "feat: add pending reminders storage module"
  ```

---

## Task 3: Storage — `getAllUserIds` + `reminderMutes` in profile updates

**Files:**

- Modify: `server/storage/users.ts`
- Modify: `server/storage/index.ts`

- [ ] **Step 1: Add `getAllUserIds` to `server/storage/users.ts`**

  After the `deleteUser` function, add:

  ```ts
  /** Returns all user IDs. Used by the notification scheduler for batch reminder checks. */
  export async function getAllUserIds(): Promise<string[]> {
    const rows = await db.select({ id: users.id }).from(users);
    return rows.map((r) => r.id);
  }
  ```

- [ ] **Step 2: Add `reminderMutes` to `UpdatableProfileFields`**

  In `server/storage/users.ts`, find the `UpdatableProfileFields` type (around line 234) and add `"reminderMutes"` to the `Pick` list:

  ```ts
  type UpdatableProfileFields = Pick<
    InsertUserProfile,
    | "allergies"
    | "healthConditions"
    | "dietType"
    | "foodDislikes"
    | "primaryGoal"
    | "activityLevel"
    | "householdSize"
    | "cuisinePreferences"
    | "cookingSkillLevel"
    | "cookingTimeAvailable"
    | "glp1Mode"
    | "glp1Medication"
    | "glp1StartDate"
    | "reminderMutes" // ← add this
  >;
  ```

- [ ] **Step 3: Wire `getAllUserIds` into `server/storage/index.ts`**

  Add to the `storage` object under the Users section:

  ```ts
  getAllUserIds: users.getAllUserIds,
  ```

- [ ] **Step 4: Verify types compile**

  ```bash
  npm run check:types
  ```

  Expected: no errors.

- [ ] **Step 5: Run tests**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add server/storage/users.ts server/storage/index.ts
  git commit -m "feat: add getAllUserIds and reminderMutes to profile updates"
  ```

---

## Task 4: Notification scheduler extension

**Files:**

- Modify: `server/services/notification-scheduler.ts`
- Modify: `server/services/__tests__/notification-scheduler.test.ts`

- [ ] **Step 1: Write failing tests**

  In `server/services/__tests__/notification-scheduler.test.ts`, add to the `vi.mock("../../storage", ...)` mock — extend the storage mock to include the new functions:

  ```ts
  vi.mock("../../storage", () => ({
    storage: {
      getDueCommitmentsAllUsers: vi.fn(),
      updateNotebookEntryStatus: vi.fn(),
      getAllUserIds: vi.fn(),
      getUserProfile: vi.fn(),
      getDailyLogs: vi.fn(),
      hasPendingReminderToday: vi.fn(),
      createPendingReminder: vi.fn(),
    },
  }));
  ```

  Then add these test suites at the end of the file:

  ```ts
  describe("sendDailyCheckinReminders", () => {
    it("creates a daily-checkin reminder for unmuted users", async () => {
      vi.mocked(storage.getAllUserIds).mockResolvedValue(["user-1"]);
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
      );
      vi.mocked(storage.getDailyLogs).mockResolvedValue([]);
      vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
      vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

      await sendDailyCheckinReminders();

      expect(storage.createPendingReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          type: "daily-checkin",
        }),
      );
    });

    it("skips users with daily-checkin muted", async () => {
      vi.mocked(storage.getAllUserIds).mockResolvedValue(["user-1"]);
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({
          userId: "user-1",
          reminderMutes: { "daily-checkin": true },
        }),
      );
      vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);

      await sendDailyCheckinReminders();

      expect(storage.createPendingReminder).not.toHaveBeenCalled();
    });

    it("skips if daily-checkin reminder already exists today", async () => {
      vi.mocked(storage.getAllUserIds).mockResolvedValue(["user-1"]);
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
      );
      vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(true);

      await sendDailyCheckinReminders();

      expect(storage.createPendingReminder).not.toHaveBeenCalled();
    });
  });

  describe("sendMealLogReminders", () => {
    it("creates a meal-log reminder when no logs exist today", async () => {
      vi.mocked(storage.getAllUserIds).mockResolvedValue(["user-1"]);
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
      );
      vi.mocked(storage.getDailyLogs).mockResolvedValue([]);
      vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
      vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

      await sendMealLogReminders();

      expect(storage.createPendingReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          type: "meal-log",
        }),
      );
    });

    it("skips when logs already exist today", async () => {
      vi.mocked(storage.getAllUserIds).mockResolvedValue(["user-1"]);
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
      );
      vi.mocked(storage.getDailyLogs).mockResolvedValue([
        { id: 1 } as Parameters<typeof createMockUserProfile>[0] as never,
      ]);
      vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);

      await sendMealLogReminders();

      expect(storage.createPendingReminder).not.toHaveBeenCalled();
    });
  });
  ```

  Also add the import at the top of the test file:

  ```ts
  import {
    sendDueCommitmentReminders,
    sendDailyCheckinReminders,
    sendMealLogReminders,
    startNotificationScheduler,
    stopNotificationScheduler,
  } from "../notification-scheduler";
  import { createMockUserProfile } from "../../__tests__/factories";
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  npm run test:run -- server/services/__tests__/notification-scheduler.test.ts
  ```

  Expected: FAIL — `sendDailyCheckinReminders` and `sendMealLogReminders` are not exported.

- [ ] **Step 3: Implement the new scheduler functions**

  Replace the contents of `server/services/notification-scheduler.ts` with:

  ```ts
  import cron from "node-cron";
  import { logger } from "../lib/logger";
  import { storage } from "../storage";
  import { sendPushToUser } from "./push-notifications";
  import type { ReminderMutes } from "@shared/types/reminders";

  function isMuted(
    mutes: ReminderMutes | null | undefined,
    type: keyof ReminderMutes,
  ): boolean {
    return !!(mutes as Record<string, boolean> | null | undefined)?.[type];
  }

  /** Fire the commitment reminder batch for all due commitments. */
  export async function sendDueCommitmentReminders(): Promise<void> {
    let entries;
    try {
      entries = await storage.getDueCommitmentsAllUsers();
    } catch (err) {
      logger.error(
        { err },
        "notification-scheduler: failed to fetch due commitments",
      );
      return;
    }

    if (entries.length === 0) return;

    logger.info(
      { count: entries.length },
      "notification-scheduler: sending commitment reminders",
    );

    for (const entry of entries) {
      try {
        // Write pending reminder (regardless of push success)
        const alreadyPending = await storage.hasPendingReminderToday(
          entry.userId,
          "commitment",
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
          await storage.updateNotebookEntryStatus(
            entry.id,
            entry.userId,
            "completed",
          );
        }
      } catch (err) {
        logger.error(
          { err, entryId: entry.id },
          "notification-scheduler: failed to process commitment entry",
        );
      }
    }
  }

  /** Create a daily check-in pending reminder for each unmuted user. */
  export async function sendDailyCheckinReminders(): Promise<void> {
    let userIds: string[];
    try {
      userIds = await storage.getAllUserIds();
    } catch (err) {
      logger.error(
        { err },
        "notification-scheduler: failed to fetch user IDs for daily checkin",
      );
      return;
    }

    for (const userId of userIds) {
      try {
        const profile = await storage.getUserProfile(userId);
        const mutes = profile?.reminderMutes as ReminderMutes | null;
        if (isMuted(mutes, "daily-checkin")) continue;

        const alreadyPending = await storage.hasPendingReminderToday(
          userId,
          "daily-checkin",
        );
        if (alreadyPending) continue;

        const logs = await storage.getDailyLogs(userId, new Date());
        const calories = logs.reduce(
          (sum, l) => sum + Number(l.calories ?? 0),
          0,
        );

        await storage.createPendingReminder({
          userId,
          type: "daily-checkin",
          context: { calories: Math.round(calories) },
          scheduledFor: new Date(),
        });
      } catch (err) {
        logger.error(
          { err, userId },
          "notification-scheduler: failed daily-checkin reminder for user",
        );
      }
    }
  }

  /** Create a meal-log pending reminder for users who have no logs today. */
  export async function sendMealLogReminders(): Promise<void> {
    let userIds: string[];
    try {
      userIds = await storage.getAllUserIds();
    } catch (err) {
      logger.error(
        { err },
        "notification-scheduler: failed to fetch user IDs for meal-log reminders",
      );
      return;
    }

    for (const userId of userIds) {
      try {
        const profile = await storage.getUserProfile(userId);
        const mutes = profile?.reminderMutes as ReminderMutes | null;
        if (isMuted(mutes, "meal-log")) continue;

        const logs = await storage.getDailyLogs(userId, new Date());
        if (logs.length > 0) continue;

        const alreadyPending = await storage.hasPendingReminderToday(
          userId,
          "meal-log",
        );
        if (alreadyPending) continue;

        await storage.createPendingReminder({
          userId,
          type: "meal-log",
          context: { lastLoggedAt: null },
          scheduledFor: new Date(),
        });
      } catch (err) {
        logger.error(
          { err, userId },
          "notification-scheduler: failed meal-log reminder for user",
        );
      }
    }
  }

  let scheduledTask: ReturnType<typeof cron.schedule> | null = null;
  let mealLogTask: ReturnType<typeof cron.schedule> | null = null;

  export function startNotificationScheduler(): void {
    if (scheduledTask) return;

    // 09:00 daily — commitments + daily check-in
    scheduledTask = cron.schedule("0 9 * * *", () => {
      sendDueCommitmentReminders().catch((err) => {
        logger.error(
          { err },
          "notification-scheduler: unhandled error in commitment cron",
        );
      });
      sendDailyCheckinReminders().catch((err) => {
        logger.error(
          { err },
          "notification-scheduler: unhandled error in daily-checkin cron",
        );
      });
    });

    // 12:00 daily — meal-log nudge for users who haven't logged anything yet today
    mealLogTask = cron.schedule("0 12 * * *", () => {
      sendMealLogReminders().catch((err) => {
        logger.error(
          { err },
          "notification-scheduler: unhandled error in meal-log cron",
        );
      });
    });

    logger.info(
      "notification-scheduler: started (09:00 commitments+checkin, 12:00 meal-log)",
    );
  }

  export function stopNotificationScheduler(): void {
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
    }
    if (mealLogTask) {
      mealLogTask.stop();
      mealLogTask = null;
    }
  }
  ```

- [ ] **Step 4: Fix the getDailyLogs mock in the test**

  The `getDailyLogs` mock for "logs already exist" test needs a proper DailyLog object. Replace the incomplete mock value:

  ```ts
  it("skips when logs already exist today", async () => {
    vi.mocked(storage.getAllUserIds).mockResolvedValue(["user-1"]);
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
    );
    // Any truthy array means logs exist — shape doesn't matter for this test
    vi.mocked(storage.getDailyLogs).mockResolvedValue([
      { id: 1, userId: "user-1", calories: "500" } as never,
    ]);
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);

    await sendMealLogReminders();

    expect(storage.createPendingReminder).not.toHaveBeenCalled();
  });
  ```

- [ ] **Step 5: Run tests**

  ```bash
  npm run test:run -- server/services/__tests__/notification-scheduler.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 6: Run full suite**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add server/services/notification-scheduler.ts server/services/__tests__/notification-scheduler.test.ts
  git commit -m "feat: extend notification scheduler with daily-checkin and meal-log reminders"
  ```

---

## Task 5: API routes — `GET /api/reminders/pending`, `POST /api/reminders/acknowledge`, `PATCH /api/reminders/mutes`

**Files:**

- Create: `server/routes/reminders.ts`
- Create: `server/routes/__tests__/reminders.test.ts`
- Modify: `server/routes.ts`

- [ ] **Step 1: Write failing tests**

  Create `server/routes/__tests__/reminders.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import express from "express";
  import request from "supertest";
  import { storage } from "../../storage";
  import { register } from "../reminders";
  import { createMockUserProfile } from "../../__tests__/factories";

  vi.mock("../../storage", () => ({
    storage: {
      hasPendingReminders: vi.fn(),
      acknowledgeReminders: vi.fn(),
      getUserProfile: vi.fn(),
      updateUserProfile: vi.fn(),
    },
  }));

  vi.mock("../../middleware/auth");
  vi.mock("express-rate-limit");

  function createApp() {
    const app = express();
    app.use(express.json());
    register(app);
    return app;
  }

  describe("GET /api/reminders/pending", () => {
    let app: express.Express;
    beforeEach(() => {
      app = createApp();
      vi.clearAllMocks();
    });

    it("returns hasPending: true when reminders exist", async () => {
      vi.mocked(storage.hasPendingReminders).mockResolvedValue(true);

      const res = await request(app).get("/api/reminders/pending");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasPending: true });
    });

    it("returns hasPending: false when no reminders", async () => {
      vi.mocked(storage.hasPendingReminders).mockResolvedValue(false);

      const res = await request(app).get("/api/reminders/pending");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasPending: false });
    });
  });

  describe("POST /api/reminders/acknowledge", () => {
    let app: express.Express;
    beforeEach(() => {
      app = createApp();
      vi.clearAllMocks();
    });

    it("acknowledges reminders and returns coachContext", async () => {
      vi.mocked(storage.acknowledgeReminders).mockResolvedValue([
        { type: "daily-checkin", calories: 1200 } as never,
      ]);

      const res = await request(app).post("/api/reminders/acknowledge");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        acknowledged: 1,
        coachContext: [{ type: "daily-checkin", calories: 1200 }],
      });
    });

    it("returns acknowledged: 0 when nothing pending", async () => {
      vi.mocked(storage.acknowledgeReminders).mockResolvedValue([]);

      const res = await request(app).post("/api/reminders/acknowledge");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ acknowledged: 0, coachContext: [] });
    });
  });

  describe("PATCH /api/reminders/mutes", () => {
    let app: express.Express;
    beforeEach(() => {
      app = createApp();
      vi.clearAllMocks();
    });

    it("merges mute settings with existing and saves", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({ reminderMutes: { "meal-log": false } }),
      );
      vi.mocked(storage.updateUserProfile).mockResolvedValue(
        createMockUserProfile({
          reminderMutes: { "meal-log": false, "daily-checkin": true },
        }),
      );

      const res = await request(app)
        .patch("/api/reminders/mutes")
        .send({ "daily-checkin": true });

      expect(res.status).toBe(200);
      expect(res.body.reminderMutes).toEqual({
        "meal-log": false,
        "daily-checkin": true,
      });
      expect(storage.updateUserProfile).toHaveBeenCalledWith(
        "1",
        expect.objectContaining({
          reminderMutes: { "meal-log": false, "daily-checkin": true },
        }),
      );
    });

    it("rejects unknown reminder type keys", async () => {
      const res = await request(app)
        .patch("/api/reminders/mutes")
        .send({ unknown: true });

      expect(res.status).toBe(400);
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  npm run test:run -- server/routes/__tests__/reminders.test.ts
  ```

  Expected: FAIL — `../reminders` module not found.

- [ ] **Step 3: Create the route file**

  Create `server/routes/reminders.ts`:

  ```ts
  import type { Express, Response } from "express";
  import { z } from "zod";
  import { storage } from "../storage";
  import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
  import { handleRouteError } from "./_helpers";
  import { sendError } from "../lib/api-errors";
  import { ErrorCode } from "@shared/constants/error-codes";
  import type { ReminderMutes } from "@shared/types/reminders";

  const mutesSchema = z.object({
    "meal-log": z.boolean().optional(),
    commitment: z.boolean().optional(),
    "daily-checkin": z.boolean().optional(),
  });

  export function register(app: Express): void {
    // GET /api/reminders/pending
    app.get(
      "/api/reminders/pending",
      requireAuth,
      async (req: AuthenticatedRequest, res: Response) => {
        try {
          const hasPending = await storage.hasPendingReminders(req.userId);
          res.json({ hasPending });
        } catch (error) {
          handleRouteError(res, error, "check pending reminders");
        }
      },
    );

    // POST /api/reminders/acknowledge
    app.post(
      "/api/reminders/acknowledge",
      requireAuth,
      async (req: AuthenticatedRequest, res: Response) => {
        try {
          const coachContext = await storage.acknowledgeReminders(req.userId);
          res.json({ acknowledged: coachContext.length, coachContext });
        } catch (error) {
          handleRouteError(res, error, "acknowledge reminders");
        }
      },
    );

    // PATCH /api/reminders/mutes
    app.patch(
      "/api/reminders/mutes",
      requireAuth,
      async (req: AuthenticatedRequest, res: Response) => {
        try {
          const parsed = mutesSchema.safeParse(req.body);
          if (!parsed.success) {
            return sendApiError(
              res,
              400,
              "Invalid mute keys",
              ErrorCode.VALIDATION_ERROR,
            );
          }

          const profile = await storage.getUserProfile(req.userId);
          const existing = (profile?.reminderMutes ?? {}) as ReminderMutes;
          const updated: ReminderMutes = { ...existing, ...parsed.data };

          await storage.updateUserProfile(req.userId, {
            reminderMutes: updated,
          });
          res.json({ reminderMutes: updated });
        } catch (error) {
          handleRouteError(res, error, "update reminder mutes");
        }
      },
    );
  }
  ```

- [ ] **Step 4: Run tests**

  ```bash
  npm run test:run -- server/routes/__tests__/reminders.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 5: Register routes in `server/routes.ts`**

  Add import near the other route imports:

  ```ts
  import { register as registerReminders } from "./routes/reminders";
  ```

  Add the registration call inside `registerRoutes(app)` (alongside other `register*` calls):

  ```ts
  registerReminders(app);
  ```

- [ ] **Step 6: Run full suite**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add server/routes/reminders.ts server/routes/__tests__/reminders.test.ts server/routes.ts
  git commit -m "feat: add reminders API routes (pending, acknowledge, mutes)"
  ```

---

## Task 6: Client hooks — `usePendingReminders` + `useAcknowledgeReminders`

**Files:**

- Create: `client/hooks/usePendingReminders.ts`
- Create: `client/hooks/useAcknowledgeReminders.ts`
- Create: `client/hooks/__tests__/usePendingReminders.test.ts`
- Create: `client/hooks/__tests__/useAcknowledgeReminders.test.ts`

- [ ] **Step 1: Write failing test for `usePendingReminders`**

  Create `client/hooks/__tests__/usePendingReminders.test.ts`:

  ```ts
  // @vitest-environment jsdom
  import { renderHook, act, waitFor } from "@testing-library/react";
  import { usePendingReminders } from "../usePendingReminders";
  import { createQueryWrapper } from "../../../test/utils/query-wrapper";

  const { mockApiRequest } = vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
  }));

  vi.mock("@/lib/query-client", () => ({
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  }));

  vi.mock("react-native", () => ({
    AppState: {
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
  }));

  describe("usePendingReminders", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns hasPending: true when the API reports pending reminders", async () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ hasPending: true }),
      });

      const { result } = renderHook(() => usePendingReminders(), { wrapper });

      await waitFor(() => expect(result.current.hasPending).toBe(true));
    });

    it("returns hasPending: false when no reminders pending", async () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ hasPending: false }),
      });

      const { result } = renderHook(() => usePendingReminders(), { wrapper });

      await waitFor(() => expect(result.current.hasPending).toBe(false));
    });

    it("defaults to false before the query resolves", () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockReturnValue(new Promise(() => {})); // never resolves

      const { result } = renderHook(() => usePendingReminders(), { wrapper });

      expect(result.current.hasPending).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run test — verify it fails**

  ```bash
  npm run test:run -- client/hooks/__tests__/usePendingReminders.test.ts
  ```

  Expected: FAIL — module `../usePendingReminders` not found.

- [ ] **Step 3: Implement `usePendingReminders`**

  Create `client/hooks/usePendingReminders.ts`:

  ```ts
  import { useEffect } from "react";
  import { AppState } from "react-native";
  import { useQuery, useQueryClient } from "@tanstack/react-query";
  import { apiRequest } from "@/lib/query-client";

  const QUERY_KEY = ["/api/reminders/pending"] as const;

  export function usePendingReminders(): { hasPending: boolean } {
    const queryClient = useQueryClient();

    const { data } = useQuery<{ hasPending: boolean }>({
      queryKey: QUERY_KEY,
      queryFn: async () => {
        const res = await apiRequest("GET", "/api/reminders/pending");
        return res.json();
      },
    });

    useEffect(() => {
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        }
      });
      return () => sub.remove();
    }, [queryClient]);

    return { hasPending: data?.hasPending ?? false };
  }
  ```

- [ ] **Step 4: Run test**

  ```bash
  npm run test:run -- client/hooks/__tests__/usePendingReminders.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 5: Write failing test for `useAcknowledgeReminders`**

  Create `client/hooks/__tests__/useAcknowledgeReminders.test.ts`:

  ```ts
  // @vitest-environment jsdom
  import { renderHook, act, waitFor } from "@testing-library/react";
  import { useAcknowledgeReminders } from "../useAcknowledgeReminders";
  import { createQueryWrapper } from "../../../test/utils/query-wrapper";

  const { mockApiRequest } = vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
  }));

  vi.mock("@/lib/query-client", () => ({
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  }));

  describe("useAcknowledgeReminders", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("calls POST /api/reminders/acknowledge and returns coachContext", async () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockResolvedValue({
        json: () =>
          Promise.resolve({
            acknowledged: 1,
            coachContext: [{ type: "daily-checkin", calories: 1200 }],
          }),
      });

      const { result } = renderHook(() => useAcknowledgeReminders(), {
        wrapper,
      });

      await act(async () => {
        await result.current.acknowledge();
      });

      await waitFor(() =>
        expect(result.current.coachContext).toEqual([
          { type: "daily-checkin", calories: 1200 },
        ]),
      );

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/reminders/acknowledge",
      );
    });

    it("coachContext starts as an empty array", () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useAcknowledgeReminders(), {
        wrapper,
      });

      expect(result.current.coachContext).toEqual([]);
    });
  });
  ```

- [ ] **Step 6: Run test — verify it fails**

  ```bash
  npm run test:run -- client/hooks/__tests__/useAcknowledgeReminders.test.ts
  ```

  Expected: FAIL — module `../useAcknowledgeReminders` not found.

- [ ] **Step 7: Implement `useAcknowledgeReminders`**

  Create `client/hooks/useAcknowledgeReminders.ts`:

  ```ts
  import { useState } from "react";
  import { useMutation, useQueryClient } from "@tanstack/react-query";
  import { apiRequest } from "@/lib/query-client";
  import type { CoachContextItem } from "@shared/types/reminders";

  export function useAcknowledgeReminders() {
    const queryClient = useQueryClient();
    const [coachContext, setCoachContext] = useState<CoachContextItem[]>([]);

    const mutation = useMutation({
      mutationFn: async () => {
        const res = await apiRequest("POST", "/api/reminders/acknowledge");
        return res.json() as Promise<{
          acknowledged: number;
          coachContext: CoachContextItem[];
        }>;
      },
      onSuccess: (data) => {
        setCoachContext(data.coachContext);
        queryClient.invalidateQueries({ queryKey: ["/api/reminders/pending"] });
      },
    });

    return {
      acknowledge: mutation.mutateAsync,
      coachContext,
    };
  }
  ```

- [ ] **Step 8: Run both hook tests**

  ```bash
  npm run test:run -- client/hooks/__tests__/usePendingReminders.test.ts client/hooks/__tests__/useAcknowledgeReminders.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 9: Run full suite**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [ ] **Step 10: Commit**

  ```bash
  git add client/hooks/usePendingReminders.ts client/hooks/useAcknowledgeReminders.ts client/hooks/__tests__/usePendingReminders.test.ts client/hooks/__tests__/useAcknowledgeReminders.test.ts
  git commit -m "feat: add usePendingReminders and useAcknowledgeReminders hooks"
  ```

---

## Task 7: Tab badge dot

**Files:**

- Modify: `client/navigation/MainTabNavigator.tsx`

- [ ] **Step 1: Import `usePendingReminders` and update `AnimatedTabIcon`**

  In `client/navigation/MainTabNavigator.tsx`:
  1. Add import at the top:

     ```ts
     import { usePendingReminders } from "@/hooks/usePendingReminders";
     ```

  2. Add `showDot` prop to the `AnimatedTabIcon` component signature (lines 47–52):

     ```tsx
     function AnimatedTabIcon({
       name,
       color,
       size,
       focused,
     }: {
       name: keyof typeof Feather.glyphMap;
       color: string;
       size: number;
       focused: boolean;
     }) {
     ```

     Replace with:

     ```tsx
     function AnimatedTabIcon({
       name,
       color,
       size,
       focused,
     }: {
       name: keyof typeof Feather.glyphMap;
       color: string;
       size: number;
       focused: boolean;
     }) {
     ```

     No change to the signature itself — the dot will be rendered outside `AnimatedTabIcon` in the parent.

  3. In `MainTabNavigator()`, add `usePendingReminders` call after the existing hooks:

     ```tsx
     const { hasPending } = usePendingReminders();
     ```

  4. Replace the Coach tab `tabBarIcon` option (around lines 162–170):

     ```tsx
     <Tab.Screen
       name="CoachTab"
       component={ChatStackNavigator}
       options={{
         title: "Coach",
         tabBarIcon: ({ color, size, focused }) => (
           <View style={styles.iconWrapper}>
             <AnimatedTabIcon
               name="message-circle"
               size={size}
               color={color}
               focused={focused}
             />
             {hasPending && (
               <View
                 style={[styles.dot, { borderColor: theme.backgroundDefault }]}
               />
             )}
           </View>
         ),
       }}
     />
     ```

  5. Add the new styles to `StyleSheet.create` at the bottom of the file:

     ```ts
     const styles = StyleSheet.create({
       container: {
         flex: 1,
       },
       iconWrapper: {
         position: "relative",
       },
       dot: {
         position: "absolute",
         top: -2,
         right: -2,
         width: 9,
         height: 9,
         borderRadius: 5,
         backgroundColor: "#EF4444", // hardcoded — red-500, badge is always red
         borderWidth: 2,
       },
     });
     ```

- [ ] **Step 2: Verify types compile**

  ```bash
  npm run check:types
  ```

  Expected: no errors.

- [ ] **Step 3: Run full suite**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add client/navigation/MainTabNavigator.tsx
  git commit -m "feat: add red dot badge to Coach tab icon"
  ```

---

## Task 8: Acknowledge on screen focus

**Files:**

- Modify: `client/screens/CoachProScreen.tsx`
- Modify: `client/screens/ChatListScreen.tsx`

- [ ] **Step 1: Modify `CoachProScreen.tsx`**
  1. Add imports at the top:

     ```ts
     import { useFocusEffect } from "@react-navigation/native";
     import { useAcknowledgeReminders } from "@/hooks/useAcknowledgeReminders";
     ```

  2. Inside `CoachProScreen()`, after the existing hooks, add:

     ```ts
     const { acknowledge, coachContext } = useAcknowledgeReminders();

     useFocusEffect(
       useCallback(() => {
         acknowledge().catch(() => {});
       }, [acknowledge]),
     );
     ```

  3. The proactive AI message (passing `coachContext` to the chat to generate an opening line) requires server-side system-prompt injection support in `handleCoachChat`. This is out of scope for Phase 1. The badge clearing via `acknowledge()` is the primary deliverable. The `coachContext` return value from `useAcknowledgeReminders` is available for a follow-up task to wire up.

- [ ] **Step 2: Modify `ChatListScreen.tsx`**
  1. Add imports at the top:

     ```ts
     import { useFocusEffect } from "@react-navigation/native";
     import { useAcknowledgeReminders } from "@/hooks/useAcknowledgeReminders";
     ```

  2. Inside `ChatListScreen()`, after the existing hooks, add:

     ```ts
     const { acknowledge } = useAcknowledgeReminders();

     useFocusEffect(
       useCallback(() => {
         acknowledge().catch(() => {});
       }, [acknowledge]),
     );
     ```

     Note: `useCallback` is already imported in `ChatListScreen.tsx`.

- [ ] **Step 3: Verify types compile**

  ```bash
  npm run check:types
  ```

  Expected: no errors.

- [ ] **Step 4: Run full suite**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add client/screens/CoachProScreen.tsx client/screens/ChatListScreen.tsx
  git commit -m "feat: acknowledge pending reminders when Coach screen gains focus"
  ```

---

## Task 9: Mute settings screen

**Files:**

- Create: `client/screens/CoachRemindersScreen.tsx`
- Modify: `client/navigation/ProfileStackNavigator.tsx`
- Modify: `client/screens/SettingsScreen.tsx`

- [ ] **Step 1: Create `CoachRemindersScreen.tsx`**

  Create `client/screens/CoachRemindersScreen.tsx`:

  ```tsx
  import React, { useCallback, useState } from "react";
  import { View, Switch, ScrollView, StyleSheet, Platform } from "react-native";
  import { useSafeAreaInsets } from "react-native-safe-area-context";
  import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
  import { ThemedText } from "@/components/ThemedText";
  import { useTheme } from "@/hooks/useTheme";
  import { useHaptics } from "@/hooks/useHaptics";
  import { apiRequest } from "@/lib/query-client";
  import {
    Spacing,
    BorderRadius,
    FontFamily,
    withOpacity,
  } from "@/constants/theme";
  import type { ReminderMutes } from "@shared/types/reminders";

  interface ReminderToggleConfig {
    key: keyof ReminderMutes;
    label: string;
    description: string;
  }

  const REMINDER_TYPES: ReminderToggleConfig[] = [
    {
      key: "meal-log",
      label: "Meal logging nudges",
      description:
        "Reminder at noon when you haven't logged anything yet today",
    },
    {
      key: "commitment",
      label: "Commitment follow-ups",
      description:
        "Alerts when a goal you told the Coach about is due for review",
    },
    {
      key: "daily-checkin",
      label: "Daily check-in",
      description: "Morning briefing with your calorie progress",
    },
  ];

  function useReminderMutes() {
    return useQuery<{ reminderMutes: ReminderMutes }>({
      queryKey: ["/api/reminders/mutes"],
      queryFn: async () => {
        const res = await apiRequest("GET", "/api/user/dietary-profile");
        const profile = await res.json();
        return {
          reminderMutes: (profile.reminderMutes ?? {}) as ReminderMutes,
        };
      },
    });
  }

  function useUpdateReminderMute() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (mutes: Partial<ReminderMutes>) => {
        const res = await apiRequest("PATCH", "/api/reminders/mutes", mutes);
        return res.json() as Promise<{ reminderMutes: ReminderMutes }>;
      },
      onSuccess: (data) => {
        queryClient.setQueryData(["/api/reminders/mutes"], data);
      },
    });
  }

  export default function CoachRemindersScreen() {
    const { theme } = useTheme();
    const haptics = useHaptics();
    const insets = useSafeAreaInsets();
    const { data, isLoading } = useReminderMutes();
    const updateMute = useUpdateReminderMute();

    const handleToggle = useCallback(
      (key: keyof ReminderMutes, value: boolean) => {
        haptics.selection();
        updateMute.mutate({ [key]: !value });
      },
      [haptics, updateMute],
    );

    const mutes = data?.reminderMutes ?? {};

    return (
      <ScrollView
        style={{ backgroundColor: theme.backgroundDefault }}
        contentContainerStyle={[
          styles.container,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
      >
        <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
          Turn off categories you don't want the Coach to remind you about.
        </ThemedText>

        <View
          style={[styles.card, { backgroundColor: theme.backgroundSecondary }]}
        >
          {REMINDER_TYPES.map((item, index) => {
            const isMuted = !!mutes[item.key];
            const isEnabled = !isMuted;
            const isLast = index === REMINDER_TYPES.length - 1;

            return (
              <View key={item.key}>
                <View
                  style={styles.row}
                  accessible
                  accessibilityRole="switch"
                  accessibilityLabel={item.label}
                  accessibilityValue={{ text: isEnabled ? "on" : "off" }}
                >
                  <View style={styles.labelContainer}>
                    <ThemedText style={styles.label}>{item.label}</ThemedText>
                    <ThemedText
                      style={[
                        styles.description,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {item.description}
                    </ThemedText>
                  </View>
                  <Switch
                    value={isEnabled}
                    onValueChange={() => handleToggle(item.key, isMuted)}
                    trackColor={{
                      false: withOpacity(theme.textSecondary, 0.3),
                      true: theme.link,
                    }}
                    thumbColor={
                      Platform.OS === "android" ? "#FFFFFF" : undefined
                    }
                    disabled={isLoading || updateMute.isPending}
                  />
                </View>
                {!isLast && (
                  <View
                    style={[
                      styles.divider,
                      {
                        backgroundColor: withOpacity(theme.textSecondary, 0.12),
                      },
                    ]}
                  />
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  }

  const styles = StyleSheet.create({
    container: {
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 20,
    },
    card: {
      borderRadius: BorderRadius.lg,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      padding: Spacing.md,
      gap: Spacing.md,
    },
    labelContainer: {
      flex: 1,
      gap: 2,
    },
    label: {
      fontFamily: FontFamily.medium,
      fontSize: 15,
    },
    description: {
      fontSize: 13,
      lineHeight: 18,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: Spacing.md,
    },
  });
  ```

- [ ] **Step 2: Add `CoachReminders` route to `ProfileStackNavigator`**

  In `client/navigation/ProfileStackNavigator.tsx`:
  1. Add import:

     ```ts
     import CoachRemindersScreen from "@/screens/CoachRemindersScreen";
     ```

  2. Add to `ProfileStackParamList`:

     ```ts
     CoachReminders: undefined;
     ```

  3. Add the screen inside `Stack.Navigator`:

     ```tsx
     <Stack.Screen
       name="CoachReminders"
       component={CoachRemindersScreen}
       options={{
         headerTitle: () => (
           <HeaderTitle title="Coach Reminders" showIcon={false} />
         ),
       }}
     />
     ```

- [ ] **Step 3: Add "Coach Reminders" to `SettingsScreen.tsx`**

  In `client/screens/SettingsScreen.tsx`:
  1. Add `coachReminders` to `SETTINGS_ITEMS`:

     ```ts
     const SETTINGS_ITEMS: SettingsItemConfig[] = [
       { id: "editProfile", icon: "edit-2", label: "Edit Profile" },
       {
         id: "healthkit",
         icon: "heart",
         label: "Apple Health",
         premiumKey: "healthKitSync",
         iosOnly: true,
       },
       {
         id: "glp1",
         icon: "activity",
         label: "GLP-1 Companion",
         premiumKey: "glp1Companion",
       },
       {
         id: "goals",
         icon: "target",
         label: "Nutrition Goals",
         premiumKey: "adaptiveGoals",
       },
       { id: "coachReminders", icon: "bell", label: "Coach Reminders" }, // ← add
       { id: "subscription", icon: "credit-card", label: "Subscription" },
       { id: "signout", icon: "log-out", label: "Sign Out", danger: true },
     ];
     ```

  2. Find the `handlePress` / `onPress` handler in `SettingsScreen` (the switch/if block that maps `id` to navigation). Add a case for `coachReminders`:

     ```ts
     case "coachReminders":
       navigation.navigate("CoachReminders");
       break;
     ```

- [ ] **Step 4: Add `CoachReminders` to the navigation type in `client/types/navigation.ts`**

  Find `ProfileScreenNavigationProp` (or the `ProfileStackParamList` reference in `client/types/navigation.ts`) and ensure `CoachReminders: undefined` is included. This is derived from `ProfileStackParamList` which you already updated in Step 2, so this step may be a no-op — just verify with:

  ```bash
  npm run check:types
  ```

  Expected: no errors.

- [ ] **Step 5: Run full suite**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add client/screens/CoachRemindersScreen.tsx client/navigation/ProfileStackNavigator.tsx client/screens/SettingsScreen.tsx
  git commit -m "feat: add Coach Reminders mute settings screen"
  ```

---

## Self-Review Checklist

After all tasks are implemented, verify:

- [ ] `npm run check:types` passes with zero errors
- [ ] `npm run test:run` passes all tests
- [ ] `npm run lint` passes
- [ ] Red dot appears on Coach tab when a user has pending reminders (test manually with simulator — temporarily call `createPendingReminder` for your test user at server startup, or use `curl -X POST http://localhost:3000/api/reminders/acknowledge` to confirm the endpoint works)
- [ ] Dot disappears when you tap the Coach tab
- [ ] Mute toggles in Settings → Coach Reminders save correctly (toggle off daily-checkin, verify no daily-checkin row appears in `pending_reminders` table after next scheduler run)
- [ ] Free users (ChatListScreen) also clear the dot on focus
