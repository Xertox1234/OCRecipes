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
import { coachNotebook, pendingReminders, userProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));
vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const {
  createNotebookEntries,
  archiveOldEntries,
  updateNotebookEntry,
  updateNotebookEntryStatus,
  deleteNotebookEntry,
  getNotebookEntries,
} = await import("../coach-notebook");
const {
  acceptCommitment,
  confirmNotebookEntries,
  rejectNotebookEntries,
  markNotebookEntriesShown,
  getUnseenNotebookSaves,
  getConfirmedNotebookEntries,
  clearNotebook,
  updateMoodScore,
} = await import("../coach-notebook-memory");

const { withdrawHealthConsent, getReminderMutes } = await import(
  "../user-profiles"
);

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;
let other: schema.User;

const DAY = 24 * 60 * 60 * 1000;

async function insert(
  values: Partial<typeof coachNotebook.$inferInsert> & {
    type: string;
    content: string;
  },
  userId = user.id,
) {
  const [row] = await tx
    .insert(coachNotebook)
    .values({ userId, status: "active", ...values })
    .returning();
  return row;
}

async function row(id: number) {
  const [r] = await tx
    .select()
    .from(coachNotebook)
    .where(eq(coachNotebook.id, id));
  return r;
}

describe("visible memory storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
    other = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("createNotebookEntries — repeats refresh instead of piling up", () => {
    it("refreshes an active match instead of inserting a duplicate", async () => {
      const old = await insert({
        type: "preference",
        content: "User avoids dairy.",
        updatedAt: new Date(Date.now() - 10 * DAY),
        confirmedAt: new Date(),
      });
      const inserted = await createNotebookEntries([
        {
          userId: user.id,
          type: "preference",
          content: "user avoids dairy",
          dedupeKey: "k1",
        },
      ]);
      expect(inserted).toEqual([]);
      const after = await row(old.id);
      expect(after.updatedAt.getTime()).toBeGreaterThan(Date.now() - DAY);
      expect(after.confirmedAt).not.toBeNull();
    });

    it("never re-saves a fact the user rejected", async () => {
      await insert({
        type: "preference",
        content: "User avoids dairy",
        status: "rejected",
      });
      const inserted = await createNotebookEntries([
        {
          userId: user.id,
          type: "preference",
          content: "User avoids dairy",
          dedupeKey: "k2",
        },
      ]);
      expect(inserted).toEqual([]);
    });

    it("still inserts a different fact, and matches only the same type and user", async () => {
      await insert({ type: "goal", content: "User avoids dairy" });
      await insert(
        { type: "preference", content: "User avoids dairy" },
        other.id,
      );
      const inserted = await createNotebookEntries([
        {
          userId: user.id,
          type: "preference",
          content: "User avoids dairy",
          dedupeKey: "k3",
        },
        {
          userId: user.id,
          type: "preference",
          content: "User likes spicy food",
          dedupeKey: "k4",
        },
      ]);
      expect(inserted.map((r) => r.content)).toEqual([
        "User avoids dairy",
        "User likes spicy food",
      ]);
    });
  });

  describe("archiveOldEntries", () => {
    it("keeps confirmed entries and archives unconfirmed ones after 30 days", async () => {
      const old = new Date(Date.now() - 31 * DAY);
      const kept = await insert({
        type: "goal",
        content: "User aims for 120 g protein",
        updatedAt: old,
        confirmedAt: old,
      });
      const faded = await insert({
        type: "insight",
        content: "User snacks late",
        updatedAt: old,
      });
      await archiveOldEntries(user.id, 30);
      expect((await row(kept.id)).status).toBe("active");
      expect((await row(faded.id)).status).toBe("archived");
    });
  });

  describe("updateNotebookEntry", () => {
    it("editing confirms the entry and labels a commitment with the user's words", async () => {
      const c = await insert({
        type: "commitment",
        content: "The user agreed to add seeds",
      });
      await updateNotebookEntry(c.id, user.id, {
        content: "pumpkin seeds on my salad",
      });
      const after = await row(c.id);
      expect(after.confirmedAt).not.toBeNull();
      expect(after.label).toBe("pumpkin seeds on my salad");
    });

    it("a status-only change does not confirm", async () => {
      const c = await insert({ type: "commitment", content: "x" });
      await updateNotebookEntry(c.id, user.id, { status: "archived" });
      expect((await row(c.id)).confirmedAt).toBeNull();
    });
  });

  describe("confirm / reject / shown", () => {
    it("confirms only this user's entries and marks them shown", async () => {
      const mine = await insert({ type: "goal", content: "a" });
      const theirs = await insert({ type: "goal", content: "b" }, other.id);
      const n = await confirmNotebookEntries(user.id, [mine.id, theirs.id]);
      expect(n).toBe(1);
      expect((await row(mine.id)).confirmedAt).not.toBeNull();
      expect((await row(mine.id)).shownAt).not.toBeNull();
      expect((await row(theirs.id)).confirmedAt).toBeNull();
    });

    it("rejects only this user's entries", async () => {
      const mine = await insert({ type: "goal", content: "a" });
      const theirs = await insert({ type: "goal", content: "b" }, other.id);
      expect(await rejectNotebookEntries(user.id, [mine.id, theirs.id])).toBe(
        1,
      );
      expect((await row(mine.id)).status).toBe("rejected");
      expect((await row(theirs.id)).status).toBe("active");
    });

    it("lists unseen speakable saves oldest first; marking one shown leaves the other", async () => {
      const a = await insert({
        type: "preference",
        content: "a",
        createdAt: new Date(Date.now() - 60_000),
      });
      const b = await insert({ type: "goal", content: "b" });
      await insert({ type: "insight", content: "hidden type" });
      await insert({
        type: "goal",
        content: "old",
        createdAt: new Date(Date.now() - 8 * DAY),
      });
      await insert({ type: "goal", content: "seen", shownAt: new Date() });
      await insert({ type: "goal", content: "theirs" }, other.id);

      expect((await getUnseenNotebookSaves(user.id)).map((r) => r.id)).toEqual([
        a.id,
        b.id,
      ]);
      await markNotebookEntriesShown(user.id, [a.id]);
      expect((await getUnseenNotebookSaves(user.id)).map((r) => r.id)).toEqual([
        b.id,
      ]);
    });

    it("lists only confirmed, active, speakable entries", async () => {
      const ok = await insert({
        type: "goal",
        content: "a",
        confirmedAt: new Date(),
      });
      await insert({ type: "goal", content: "unconfirmed" });
      await insert({
        type: "insight",
        content: "hidden",
        confirmedAt: new Date(),
      });
      await insert({
        type: "goal",
        content: "rejected",
        status: "rejected",
        confirmedAt: new Date(),
      });
      expect(
        (await getConfirmedNotebookEntries(user.id)).map((r) => r.id),
      ).toEqual([ok.id]);
    });
  });

  describe("getNotebookEntries default listing", () => {
    it("leaves out removed (rejected) and archived entries", async () => {
      const ok = await insert({ type: "goal", content: "kept" });
      await insert({ type: "goal", content: "undone", status: "rejected" });
      await insert({ type: "goal", content: "old", status: "archived" });
      expect((await getNotebookEntries(user.id)).map((r) => r.id)).toEqual([
        ok.id,
      ]);
    });
  });

  describe("a reminder copy goes when its note does (M26)", () => {
    async function withReminder(owner = user.id) {
      const row = await insert(
        { type: "commitment", content: "Eat more greens" },
        owner,
      );
      await tx.insert(pendingReminders).values({
        userId: owner,
        type: "commitment",
        context: { notebookEntryId: row.id, content: row.content },
        scheduledFor: new Date(),
      });
      return row;
    }
    const left = (owner = user.id) =>
      tx
        .select({ id: pendingReminders.id })
        .from(pendingReminders)
        .where(eq(pendingReminders.userId, owner));

    it("on Remove, leaving another user's alone", async () => {
      const mine = await withReminder();
      const theirs = await withReminder(other.id);
      await rejectNotebookEntries(user.id, [mine.id, theirs.id]);
      expect(await left()).toHaveLength(0);
      expect(await left(other.id)).toHaveLength(1);
    });

    it.each(["archived", "completed", "rejected"])(
      "when the user sets it %s",
      async (status) => {
        const row = await withReminder();
        await updateNotebookEntry(row.id, user.id, { status });
        expect(await left()).toHaveLength(0);
      },
    );

    it("on delete, and never by another user", async () => {
      const row = await withReminder();
      await deleteNotebookEntry(row.id, other.id);
      await updateNotebookEntry(row.id, other.id, { status: "archived" });
      expect(await left()).toHaveLength(1);
      await deleteNotebookEntry(row.id, user.id);
      expect(await left()).toHaveLength(0);
    });

    it("but not when the reminder job completes it, or the note stays active", async () => {
      const row = await withReminder();
      await updateNotebookEntry(row.id, user.id, { content: "Eat greens" });
      await updateNotebookEntryStatus(row.id, user.id, "completed", "active");
      expect(await left()).toHaveLength(1);
    });
  });

  it("getReminderMutes reads many users' mutes, and only the ones asked for", async () => {
    await tx
      .insert(userProfiles)
      .values({ userId: user.id, reminderMutes: { commitment: true } })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { reminderMutes: { commitment: true } },
      });
    expect((await getReminderMutes([user.id])).get(user.id)).toEqual({
      commitment: true,
    });
    expect((await getReminderMutes([other.id])).has(user.id)).toBe(false);
    expect((await getReminderMutes([])).size).toBe(0);
  });

  describe("acceptCommitment (L57, L64)", () => {
    const date = new Date("2030-01-04T00:00:00Z");
    const card = { title: "Eat more greens", followUpDate: date };
    const mine = () =>
      tx.select().from(coachNotebook).where(eq(coachNotebook.userId, user.id));

    it("saves an active, confirmed, labelled commitment, once", async () => {
      expect(await acceptCommitment(user.id, card)).toBe("saved");
      expect(await acceptCommitment(user.id, card)).toBe("saved");
      const rows = await mine();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "commitment",
        status: "active",
        content: "Eat more greens",
        label: "Eat more greens",
        followUpDate: date,
      });
      expect(rows[0].confirmedAt).not.toBeNull();
      expect(rows[0].shownAt).not.toBeNull();
    });

    it("confirms the note the extraction already saved, keeping its label", async () => {
      const row = await insert({
        type: "commitment",
        content: "eat more greens.",
        label: "your greens",
      });
      await acceptCommitment(user.id, card);
      const rows = await mine();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: row.id,
        label: "your greens",
        followUpDate: date,
      });
      expect(rows[0].confirmedAt).not.toBeNull();
    });

    it("keeps the saved date when the card's is unusable", async () => {
      await insert({
        type: "commitment",
        content: "Eat more greens",
        followUpDate: date,
      });
      await acceptCommitment(user.id, { ...card, followUpDate: null });
      expect((await mine())[0].followUpDate).toEqual(date);
    });

    it("does not touch another user's or a removed note", async () => {
      const theirs = await insert(
        { type: "commitment", content: "Eat more greens" },
        other.id,
      );
      const removed = await insert({
        type: "commitment",
        content: "Eat more greens",
        status: "rejected",
      });
      await acceptCommitment(user.id, card);
      const rows = await mine();
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === removed.id)?.status).toBe("rejected");
      const [t] = await tx
        .select()
        .from(coachNotebook)
        .where(eq(coachNotebook.id, theirs.id));
      expect(t.confirmedAt).toBeNull();
    });

    it("adds nothing to a full notebook", async () => {
      await tx.insert(coachNotebook).values(
        Array.from({ length: 500 }, (_, i) => ({
          userId: user.id,
          type: "goal",
          content: `Goal ${i}`,
          status: "active",
        })),
      );
      expect(await acceptCommitment(user.id, card)).toBe("full");
      expect(await mine()).toHaveLength(500);
    });
  });

  describe("a repeated commitment takes the new date (L67)", () => {
    const date = new Date("2030-01-04T00:00:00Z");
    const again = (followUpDate: Date | null, label: string | null = null) =>
      createNotebookEntries([
        {
          userId: user.id,
          type: "commitment",
          content: "Eat more greens",
          status: "active",
          followUpDate,
          label,
          dedupeKey: `k${Math.random()}`,
        },
      ]);
    const read = async (id: number) =>
      (
        await tx.select().from(coachNotebook).where(eq(coachNotebook.id, id))
      )[0];

    it("sets the date, and the label only when there was none", async () => {
      const row = await insert({
        type: "commitment",
        content: "Eat more greens",
      });
      expect(await again(date, "more greens")).toHaveLength(0);
      expect(await read(row.id)).toMatchObject({
        followUpDate: date,
        label: "more greens",
      });
      await again(date, "other words");
      expect((await read(row.id)).label).toBe("more greens");
    });

    it("keeps the old date when the repeat has none", async () => {
      const row = await insert({
        type: "commitment",
        content: "Eat more greens",
        followUpDate: date,
      });
      await again(null);
      expect((await read(row.id)).followUpDate).toEqual(date);
    });
  });

  describe("clearNotebook", () => {
    it("deletes every row for the user, hidden ones too, and resets mood", async () => {
      await insert({ type: "goal", content: "a" });
      await insert({ type: "emotional_context", content: "b" });
      const keep = await insert({ type: "goal", content: "theirs" }, other.id);
      await tx.insert(userProfiles).values({
        userId: user.id,
        moodScore: -1.5,
        moodUpdatedAt: new Date(),
      });

      await clearNotebook(user.id);

      const left = await tx
        .select()
        .from(coachNotebook)
        .where(eq(coachNotebook.userId, user.id));
      expect(left).toEqual([]);
      expect(await row(keep.id)).toBeTruthy();
      const [profile] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, user.id));
      expect(profile.moodScore).toBe(0);
      expect(profile.moodUpdatedAt).toBeNull();
    });

    // Coach chat audit 2026-11-24, L108: the note extraction of the latest
    // turn runs after the reply and can finish after the user tapped Clear.
    describe("a turn that started before the clear (L108)", () => {
      const note = (content: string) => ({
        userId: user.id,
        type: "goal",
        content,
        status: "active",
        dedupeKey: `k-${content}`,
      });
      const consented = () =>
        tx.insert(userProfiles).values({
          userId: user.id,
          healthDataConsentAt: new Date("2026-01-01T00:00:00Z"),
        });
      const profile = async () =>
        (
          await tx
            .select()
            .from(userProfiles)
            .where(eq(userProfiles.userId, user.id))
        )[0];

      it("stamps the profile with the time of the clear", async () => {
        await consented();
        const before = Date.now();
        await clearNotebook(user.id);
        const stamp = (await profile()).notebookClearedAt;
        expect(stamp?.getTime()).toBeGreaterThanOrEqual(before);
      });

      it("writes no note from a turn that started before the clear", async () => {
        await consented();
        const turnStart = new Date(Date.now() - 5_000);
        await clearNotebook(user.id);

        const written = await createNotebookEntries([note("late")], {
          turnStart,
        });

        expect(written).toEqual([]);
        expect(
          await tx
            .select()
            .from(coachNotebook)
            .where(eq(coachNotebook.userId, user.id)),
        ).toEqual([]);
      });

      it("still writes notes from a turn that started after the clear", async () => {
        await consented();
        await clearNotebook(user.id);
        const turnStart = new Date(Date.now() + 5_000);

        const written = await createNotebookEntries([note("fresh")], {
          turnStart,
        });

        expect(written).toHaveLength(1);
      });

      it("writes as before for a user who never cleared", async () => {
        await consented();
        const written = await createNotebookEntries([note("plain")], {
          turnStart: new Date(),
        });
        expect(written).toHaveLength(1);
      });

      it("takes no mood nudge from a turn that started before the clear", async () => {
        await consented();
        const turnStart = new Date(Date.now() - 5_000);
        await clearNotebook(user.id);

        await updateMoodScore(user.id, -1, turnStart);

        expect((await profile()).moodScore).toBe(0);
        expect((await profile()).moodUpdatedAt).toBeNull();
      });

      it("still takes the mood nudge from a turn after the clear", async () => {
        await consented();
        await clearNotebook(user.id);

        await updateMoodScore(user.id, -1, new Date(Date.now() + 5_000));

        expect((await profile()).moodScore).toBe(-1);
      });
    });
  });

  describe("updateMoodScore", () => {
    it("decays the stored score, adds the nudge and stamps the time", async () => {
      const t0 = new Date("2026-11-05T12:00:00Z");
      const now = new Date("2026-11-08T12:00:00Z");
      await tx.insert(userProfiles).values({
        userId: user.id,
        moodScore: 2,
        moodUpdatedAt: t0,
        healthDataConsentAt: t0,
      });
      await updateMoodScore(user.id, -0.5, now);
      const [p] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, user.id));
      expect(p.moodScore).toBeCloseTo(0.5);
      expect(p.moodUpdatedAt).toEqual(now);
    });

    // Privacy audit H2: the mood signal is health-derived — no consent, no
    // health data. It is not inferred for a user without the consent.
    it("does nothing for a user who has not given the health-data consent", async () => {
      await tx.insert(userProfiles).values({ userId: user.id });
      await updateMoodScore(user.id, 1, new Date("2026-11-08T12:00:00Z"));
      const [p] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, user.id));
      expect(p.moodScore).toBe(0);
      expect(p.moodUpdatedAt).toBeNull();
    });

    it("does nothing for a user without a profile", async () => {
      await expect(
        updateMoodScore(user.id, 1, new Date()),
      ).resolves.toBeUndefined();
    });
  });

  // Owner ruling 2026-11-24 (coach chat audit M52, R179): at withdrawal the
  // user chooses what happens to the notes Coach saved.
  describe("withdrawHealthConsent and Coach's notes", () => {
    async function seed() {
      await tx
        .insert(userProfiles)
        .values({ userId: user.id, healthDataConsentAt: new Date() });
      await tx.insert(userProfiles).values({ userId: other.id });
      for (const u of [user, other]) {
        await createNotebookEntries([
          {
            userId: u.id,
            type: "commitment",
            content: "Check blood sugar after dinner",
            status: "active",
            dedupeKey: `withdraw-${u.id}`,
          },
        ]);
        await tx.insert(pendingReminders).values([
          {
            userId: u.id,
            type: "commitment",
            context: { label: "Check blood sugar after dinner" },
            scheduledFor: new Date(),
          },
          {
            userId: u.id,
            type: "meal-log",
            context: {},
            scheduledFor: new Date(),
          },
        ]);
      }
    }
    const notesOf = (id: string) =>
      tx.select().from(coachNotebook).where(eq(coachNotebook.userId, id));
    const remindersOf = async (id: string) =>
      (
        await tx
          .select()
          .from(pendingReminders)
          .where(eq(pendingReminders.userId, id))
      )
        .map((r) => r.type)
        .sort();

    it("deletes the notes and their reminder copies when asked to", async () => {
      await seed();

      await withdrawHealthConsent(user.id, { deleteCoachNotes: true });

      expect(await notesOf(user.id)).toEqual([]);
      expect(await remindersOf(user.id)).toEqual(["meal-log"]);
      // Another account is untouched.
      expect(await notesOf(other.id)).toHaveLength(1);
      expect(await remindersOf(other.id)).toEqual(["commitment", "meal-log"]);
    });

    // R179: "Clear everything Coach knows" left the commitment text behind
    // in the reminder rows.
    it("clearNotebook removes the reminder copies of commitments too", async () => {
      await seed();

      await clearNotebook(user.id);

      expect(await notesOf(user.id)).toEqual([]);
      expect(await remindersOf(user.id)).toEqual(["meal-log"]);
      expect(await remindersOf(other.id)).toEqual(["commitment", "meal-log"]);
    });

    it("deletes nothing for an account with no profile (nothing to withdraw)", async () => {
      await createNotebookEntries([
        {
          userId: user.id,
          type: "goal",
          content: "Eat more fibre",
          status: "active",
          dedupeKey: "no-profile",
        },
      ]);

      expect(
        await withdrawHealthConsent(user.id, { deleteCoachNotes: true }),
      ).toBeUndefined();
      expect(await notesOf(user.id)).toHaveLength(1);
    });

    it("keeps the notes when not asked to delete them", async () => {
      await seed();

      await withdrawHealthConsent(user.id);

      expect(await notesOf(user.id)).toHaveLength(1);
      expect(await remindersOf(user.id)).toEqual(["commitment", "meal-log"]);
    });
  });
});
