import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";
import { extractNotebookEntries } from "../notebook-extraction";
import { extractAndStoreNotebook } from "../coach-pro-chat/notebook";

vi.mock("../../storage", () => ({
  storage: {
    areCoachNotesPaused: vi.fn(),
    getNotebookEntryTotal: vi.fn().mockResolvedValue(0),
    createNotebookEntries: vi.fn(),
    archiveOldEntries: vi.fn(),
  },
}));
vi.mock("../notebook-extraction", () => ({
  extractNotebookEntries: vi.fn(),
}));

const turn = {
  messageHistory: [],
  content: "I have type 2 diabetes",
  textContent: "Thanks for telling me.",
  userId: "u1",
  conversationId: 7,
  today: new Date("2026-11-24T12:00:00Z"),
  tz: "UTC",
  wroteCard: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractNotebookEntries).mockResolvedValue([
    {
      type: "preference",
      content: "Has type 2 diabetes",
      label: null,
      followUpDate: null,
    },
  ]);
});

// Owner ruling 2026-11-24 (coach chat audit M52).
describe("extractAndStoreNotebook after a health-consent withdrawal", () => {
  it("neither reads the turn for notes nor saves any while paused", async () => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(true);

    await extractAndStoreNotebook(turn);

    expect(extractNotebookEntries).not.toHaveBeenCalled();
    expect(storage.createNotebookEntries).not.toHaveBeenCalled();
  });

  it("saves notes as before when not paused", async () => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(false);

    await extractAndStoreNotebook(turn);

    expect(storage.createNotebookEntries).toHaveBeenCalledTimes(1);
  });
});
