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

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Mock the logger so we can assert on M-4 dedupeKey-missing warns
vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Import AFTER mocking
const {
  getActiveNotebookEntries,
  createNotebookEntry,
  createNotebookEntries,
  updateNotebookEntryStatus,
  getCommitmentsWithDueFollowUp,
  archiveOldEntries,
  getNotebookEntryCount,
} = await import("../coach-notebook");
const { logger } = await import("../../lib/logger");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("Coach Notebook Storage", () => {
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

  // --------------------------------------------------------------------------
  // createNotebookEntry
  // --------------------------------------------------------------------------
  describe("createNotebookEntry", () => {
    it("creates and returns an entry with correct fields", async () => {
      const result = await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "User prefers high-protein meals",
        status: "active",
      });

      expect(result).toBeDefined();
      expect(result.id).toBeTypeOf("number");
      expect(result.userId).toBe(testUser.id);
      expect(result.type).toBe("insight");
      expect(result.content).toBe("User prefers high-protein meals");
      expect(result.status).toBe("active");
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  // --------------------------------------------------------------------------
  // createNotebookEntries
  // --------------------------------------------------------------------------
  describe("createNotebookEntries", () => {
    it("returns empty array for empty input without inserting", async () => {
      const result = await createNotebookEntries([]);
      expect(result).toEqual([]);
    });

    it("batch inserts multiple entries", async () => {
      const result = await createNotebookEntries([
        {
          userId: testUser.id,
          type: "insight",
          content: "Content A",
          status: "active",
        },
        {
          userId: testUser.id,
          type: "goal",
          content: "Content B",
          status: "active",
        },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("insight");
      expect(result[1].type).toBe("goal");
    });

    // M-4: defense-in-depth warn when dedupeKey is missing. NULL dedupeKeys
    // bypass the unique-index dedup because Postgres treats NULLs as distinct,
    // so we log-warn so call sites can be tracked down and fixed.
    it("warns once per call when entries are missing dedupeKey", async () => {
      vi.mocked(logger.warn).mockClear();

      await createNotebookEntries([
        {
          userId: testUser.id,
          type: "insight",
          content: "No dedupeKey A",
          status: "active",
        },
        {
          userId: testUser.id,
          type: "goal",
          content: "No dedupeKey B",
          status: "active",
        },
      ]);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "coach_notebook.dedupeKey_missing",
          userId: testUser.id,
          missingDedupeKey: 2,
          totalEntries: 2,
        }),
        expect.stringContaining("missing dedupeKey"),
      );
    });

    it("does not warn when all entries have a dedupeKey", async () => {
      vi.mocked(logger.warn).mockClear();

      await createNotebookEntries([
        {
          userId: testUser.id,
          type: "insight",
          content: "With key A",
          status: "active",
          dedupeKey: "fingerprint-a",
        },
        {
          userId: testUser.id,
          type: "goal",
          content: "With key B",
          status: "active",
          dedupeKey: "fingerprint-b",
        },
      ]);

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("warns with partial missing count when only some entries lack a dedupeKey", async () => {
      vi.mocked(logger.warn).mockClear();

      await createNotebookEntries([
        {
          userId: testUser.id,
          type: "insight",
          content: "With key",
          status: "active",
          dedupeKey: "fingerprint-c",
        },
        {
          userId: testUser.id,
          type: "goal",
          content: "Empty-string key",
          status: "active",
          dedupeKey: "",
        },
        {
          userId: testUser.id,
          type: "preference",
          content: "Null key",
          status: "active",
        },
      ]);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "coach_notebook.dedupeKey_missing",
          missingDedupeKey: 2,
          totalEntries: 3,
        }),
        expect.any(String),
      );
    });
  });

  // --------------------------------------------------------------------------
  // getActiveNotebookEntries
  // --------------------------------------------------------------------------
  describe("getActiveNotebookEntries", () => {
    it("filters by userId and active status", async () => {
      const otherUser = await createTestUser(tx);

      await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "My entry",
        status: "active",
      });
      await createNotebookEntry({
        userId: otherUser.id,
        type: "insight",
        content: "Other user entry",
        status: "active",
      });
      await createNotebookEntry({
        userId: testUser.id,
        type: "goal",
        content: "Archived entry",
        status: "archived",
      });

      const result = await getActiveNotebookEntries(testUser.id);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("My entry");
      expect(result[0].userId).toBe(testUser.id);
      expect(result[0].status).toBe("active");
    });

    it("returns empty array when no entries exist", async () => {
      const result = await getActiveNotebookEntries(testUser.id);
      expect(result).toEqual([]);
    });

    it("returns at most 100 entries (bounded query)", async () => {
      // Insert 105 active entries in batches (MAX_ENTRIES_PER_BATCH = 10)
      for (let batch = 0; batch < 11; batch++) {
        const batchSize = batch < 10 ? 10 : 5;
        const entries = Array.from({ length: batchSize }, (_, i) => ({
          userId: testUser.id,
          type: "insight" as const,
          content: `Entry ${batch * 10 + i}`,
          status: "active" as const,
        }));
        await createNotebookEntries(entries);
      }

      const result = await getActiveNotebookEntries(testUser.id);

      expect(result).toHaveLength(100);
    });

    it("filters by type when types are provided", async () => {
      await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "Insight entry",
        status: "active",
      });
      await createNotebookEntry({
        userId: testUser.id,
        type: "goal",
        content: "Goal entry",
        status: "active",
      });
      await createNotebookEntry({
        userId: testUser.id,
        type: "preference",
        content: "Preference entry",
        status: "active",
      });

      const result = await getActiveNotebookEntries(testUser.id, [
        "insight",
        "goal",
      ]);

      expect(result).toHaveLength(2);
      const types = result.map((e) => e.type);
      expect(types).toContain("insight");
      expect(types).toContain("goal");
      expect(types).not.toContain("preference");
    });
  });

  // --------------------------------------------------------------------------
  // updateNotebookEntryStatus
  // --------------------------------------------------------------------------
  describe("updateNotebookEntryStatus", () => {
    it("changes status and updates updatedAt", async () => {
      const entry = await createNotebookEntry({
        userId: testUser.id,
        type: "commitment",
        content: "Eat more vegetables",
        status: "active",
      });

      const updated = await updateNotebookEntryStatus(
        entry.id,
        testUser.id,
        "completed",
      );

      expect(updated).toBeDefined();
      expect(updated!.status).toBe("completed");
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        entry.updatedAt.getTime(),
      );
    });

    it("returns undefined when entry not found", async () => {
      const result = await updateNotebookEntryStatus(
        999999,
        testUser.id,
        "archived",
      );
      expect(result).toBeUndefined();
    });

    it("returns undefined when userId does not match", async () => {
      const otherUser = await createTestUser(tx);
      const entry = await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "My insight",
        status: "active",
      });

      const result = await updateNotebookEntryStatus(
        entry.id,
        otherUser.id,
        "archived",
      );
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getCommitmentsWithDueFollowUp
  // --------------------------------------------------------------------------
  describe("getCommitmentsWithDueFollowUp", () => {
    it("returns only due commitments", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      // Due commitment (follow-up in the past)
      await createNotebookEntry({
        userId: testUser.id,
        type: "commitment",
        content: "Past commitment",
        status: "active",
        followUpDate: pastDate,
      });

      // Not due yet (follow-up in the future)
      await createNotebookEntry({
        userId: testUser.id,
        type: "commitment",
        content: "Future commitment",
        status: "active",
        followUpDate: futureDate,
      });

      // Non-commitment type with past follow-up
      await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "Insight with follow-up",
        status: "active",
        followUpDate: pastDate,
      });

      // Archived commitment with past follow-up
      await createNotebookEntry({
        userId: testUser.id,
        type: "commitment",
        content: "Archived commitment",
        status: "archived",
        followUpDate: pastDate,
      });

      const result = await getCommitmentsWithDueFollowUp(testUser.id);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Past commitment");
      expect(result[0].type).toBe("commitment");
      expect(result[0].status).toBe("active");
    });

    it("returns empty array when no commitments are due", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      await createNotebookEntry({
        userId: testUser.id,
        type: "commitment",
        content: "Future commitment",
        status: "active",
        followUpDate: futureDate,
      });

      const result = await getCommitmentsWithDueFollowUp(testUser.id);
      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // archiveOldEntries
  // --------------------------------------------------------------------------
  describe("archiveOldEntries", () => {
    it("archives entries older than threshold", async () => {
      // Create an entry with an old updatedAt by first creating it
      // then updating to simulate age
      const { coachNotebook } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const entry = await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "Old entry",
        status: "active",
      });

      // Manually set updatedAt to 60 days ago
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);
      await tx
        .update(coachNotebook)
        .set({ updatedAt: oldDate })
        .where(eq(coachNotebook.id, entry.id));

      // Create a recent entry that should NOT be archived
      await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "Recent entry",
        status: "active",
      });

      const count = await archiveOldEntries(testUser.id, 30);

      expect(count).toBe(1);

      // Verify old entry was archived
      const active = await getActiveNotebookEntries(testUser.id);
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe("Recent entry");
    });

    it("returns 0 when no entries to archive", async () => {
      const count = await archiveOldEntries(testUser.id, 30);
      expect(count).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // getNotebookEntryCount
  // --------------------------------------------------------------------------
  describe("getNotebookEntryCount", () => {
    it("counts by type and active status", async () => {
      await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "Insight 1",
        status: "active",
      });
      await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "Insight 2",
        status: "active",
      });
      await createNotebookEntry({
        userId: testUser.id,
        type: "goal",
        content: "Goal 1",
        status: "active",
      });
      // Archived insight should not be counted
      await createNotebookEntry({
        userId: testUser.id,
        type: "insight",
        content: "Archived insight",
        status: "archived",
      });

      const insightCount = await getNotebookEntryCount(testUser.id, "insight");
      const goalCount = await getNotebookEntryCount(testUser.id, "goal");

      expect(insightCount).toBe(2);
      expect(goalCount).toBe(1);
    });

    it("returns 0 when no entries of the type exist", async () => {
      const count = await getNotebookEntryCount(testUser.id, "insight");
      expect(count).toBe(0);
    });
  });
});
