import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db", () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return { db: mockDb };
});

import {
  getActiveNotebookEntries,
  createNotebookEntry,
  createNotebookEntries,
  updateNotebookEntryStatus,
  getCommitmentsWithDueFollowUp,
  archiveOldEntries,
  getNotebookEntryCount,
} from "../coach-notebook";

describe("Coach Notebook Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports getActiveNotebookEntries", () => {
    expect(typeof getActiveNotebookEntries).toBe("function");
  });

  it("exports createNotebookEntry", () => {
    expect(typeof createNotebookEntry).toBe("function");
  });

  it("exports createNotebookEntries", () => {
    expect(typeof createNotebookEntries).toBe("function");
  });

  it("exports updateNotebookEntryStatus", () => {
    expect(typeof updateNotebookEntryStatus).toBe("function");
  });

  it("exports getCommitmentsWithDueFollowUp", () => {
    expect(typeof getCommitmentsWithDueFollowUp).toBe("function");
  });

  it("exports archiveOldEntries", () => {
    expect(typeof archiveOldEntries).toBe("function");
  });

  it("exports getNotebookEntryCount", () => {
    expect(typeof getNotebookEntryCount).toBe("function");
  });

  it("createNotebookEntries returns empty array for empty input", async () => {
    const result = await createNotebookEntries([]);
    expect(result).toEqual([]);
  });
});
