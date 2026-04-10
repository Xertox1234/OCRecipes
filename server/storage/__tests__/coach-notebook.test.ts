import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  getActiveNotebookEntries,
  createNotebookEntry,
  createNotebookEntries,
  updateNotebookEntryStatus,
  getCommitmentsWithDueFollowUp,
  archiveOldEntries,
  getNotebookEntryCount,
} from "../coach-notebook";

const { mockDb, mockReturning } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  return {
    mockReturning,
    mockDb: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: mockReturning,
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    },
  };
});

vi.mock("../../db", () => ({ db: mockDb }));

const mockEntry = {
  id: 1,
  userId: "user-1",
  type: "insight",
  content: "User prefers high-protein meals",
  status: "active",
  followUpDate: null,
  sourceConversationId: 42,
  createdAt: new Date("2026-04-01"),
  updatedAt: new Date("2026-04-01"),
};

describe("Coach Notebook Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain methods to return `this`
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockReturning.mockResolvedValue([]);
  });

  describe("getActiveNotebookEntries", () => {
    it("returns entries from the query chain", async () => {
      // orderBy is the terminal call for this query — mock it to resolve
      mockDb.orderBy.mockResolvedValue([mockEntry]);

      const result = await getActiveNotebookEntries("user-1");

      expect(result).toEqual([mockEntry]);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });

    it("returns empty array when no entries exist", async () => {
      mockDb.orderBy.mockResolvedValue([]);

      const result = await getActiveNotebookEntries("user-1");

      expect(result).toEqual([]);
    });

    it("passes type filter when types are provided", async () => {
      mockDb.orderBy.mockResolvedValue([]);

      await getActiveNotebookEntries("user-1", ["insight", "goal"]);

      // where() should be called with the type filter included
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe("createNotebookEntry", () => {
    it("inserts a single entry and returns it", async () => {
      mockReturning.mockResolvedValue([mockEntry]);

      const result = await createNotebookEntry({
        userId: "user-1",
        type: "insight",
        content: "User prefers high-protein meals",
        status: "active",
        sourceConversationId: 42,
      });

      expect(result).toEqual(mockEntry);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockReturning).toHaveBeenCalled();
    });
  });

  describe("createNotebookEntries", () => {
    it("returns empty array for empty input without calling db", async () => {
      const result = await createNotebookEntries([]);

      expect(result).toEqual([]);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("batch inserts multiple entries", async () => {
      const entries = [
        {
          userId: "user-1",
          type: "insight" as const,
          content: "A",
          status: "active" as const,
        },
        {
          userId: "user-1",
          type: "goal" as const,
          content: "B",
          status: "active" as const,
        },
      ];
      mockReturning.mockResolvedValue([
        { ...mockEntry, id: 1, content: "A" },
        { ...mockEntry, id: 2, content: "B" },
      ]);

      const result = await createNotebookEntries(entries);

      expect(result).toHaveLength(2);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(entries);
    });
  });

  describe("updateNotebookEntryStatus", () => {
    it("updates status and returns the updated entry", async () => {
      const updated = { ...mockEntry, status: "archived" };
      mockReturning.mockResolvedValue([updated]);

      const result = await updateNotebookEntryStatus(1, "user-1", "archived");

      expect(result).toEqual(updated);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });

    it("returns undefined when entry not found or wrong user", async () => {
      mockReturning.mockResolvedValue([]);

      const result = await updateNotebookEntryStatus(
        999,
        "wrong-user",
        "archived",
      );

      expect(result).toBeUndefined();
    });
  });

  describe("getCommitmentsWithDueFollowUp", () => {
    it("returns due commitments", async () => {
      const commitment = {
        ...mockEntry,
        type: "commitment",
        followUpDate: new Date("2026-04-01"),
      };
      mockDb.orderBy.mockResolvedValue([commitment]);

      const result = await getCommitmentsWithDueFollowUp("user-1");

      expect(result).toEqual([commitment]);
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe("archiveOldEntries", () => {
    it("returns count of archived entries", async () => {
      mockReturning.mockResolvedValue([mockEntry, { ...mockEntry, id: 2 }]);

      const count = await archiveOldEntries("user-1", 30);

      expect(count).toBe(2);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("returns 0 when no entries to archive", async () => {
      mockReturning.mockResolvedValue([]);

      const count = await archiveOldEntries("user-1", 30);

      expect(count).toBe(0);
    });
  });

  describe("getNotebookEntryCount", () => {
    it("returns count from query", async () => {
      mockDb.where.mockResolvedValue([{ count: 5 }]);

      const count = await getNotebookEntryCount("user-1", "insight");

      expect(count).toBe(5);
    });

    it("returns 0 when query returns empty", async () => {
      mockDb.where.mockResolvedValue([]);

      const count = await getNotebookEntryCount("user-1", "insight");

      expect(count).toBe(0);
    });
  });
});
