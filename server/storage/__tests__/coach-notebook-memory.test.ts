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
import { coachNotebook, userProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));
vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { createNotebookEntries, archiveOldEntries, updateNotebookEntry } =
  await import("../coach-notebook");
const {
  confirmNotebookEntries,
  rejectNotebookEntries,
  markNotebookEntriesShown,
  getUnseenNotebookSaves,
  getConfirmedNotebookEntries,
  clearNotebook,
} = await import("../coach-notebook-memory");

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
  });
});
