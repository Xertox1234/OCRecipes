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

  // The extraction is a model call that takes seconds: a withdrawal can land
  // while it runs.
  it("saves nothing when the withdrawal lands during the extraction", async () => {
    vi.mocked(storage.areCoachNotesPaused)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await extractAndStoreNotebook(turn);

    expect(extractNotebookEntries).toHaveBeenCalledTimes(1);
    expect(storage.createNotebookEntries).not.toHaveBeenCalled();
  });

  it("saves notes as before when not paused", async () => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(false);

    await extractAndStoreNotebook(turn);

    expect(storage.createNotebookEntries).toHaveBeenCalledTimes(1);
  });

  // L108: storage drops the write when the user cleared the notebook after
  // this turn started, so it needs the turn's start.
  it("hands the turn's start to the write", async () => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(false);

    await extractAndStoreNotebook(turn);

    expect(vi.mocked(storage.createNotebookEntries).mock.calls[0][1]).toEqual({
      turnStart: turn.today,
    });
  });
});

// Coach chat audit 2026-11-24 (L49): the history already ends with this
// turn's question, and it was appended a second time.
describe("extractAndStoreNotebook — the turn's question", () => {
  beforeEach(() => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(false);
    vi.mocked(storage.getNotebookEntryTotal).mockResolvedValue(0);
  });

  const sent = () =>
    vi.mocked(extractNotebookEntries).mock.calls[0][0] as {
      role: string;
      content: string;
    }[];

  it("is sent once when the history already ends with it", async () => {
    await extractAndStoreNotebook({
      ...turn,
      messageHistory: [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: turn.content },
      ],
    });
    expect(sent().map((m) => m.content)).toEqual([
      "Earlier question",
      "Earlier answer",
      turn.content,
      turn.textContent,
    ]);
  });

  it("is added when the history does not hold it", async () => {
    await extractAndStoreNotebook({
      ...turn,
      messageHistory: [{ role: "assistant", content: "Earlier answer" }],
    });
    expect(sent().map((m) => m.content)).toEqual([
      "Earlier answer",
      turn.content,
      turn.textContent,
    ]);
  });
});

// Coach chat audit 2026-11-24 (M43): on a refused turn only the mood counts.
describe("extractAndStoreNotebook — moodOnly", () => {
  beforeEach(() => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(false);
    vi.mocked(storage.getNotebookEntryTotal).mockResolvedValue(0);
  });

  it("runs the extraction for its mood nudge and saves no entry", async () => {
    await extractAndStoreNotebook({ ...turn, moodOnly: true });
    expect(extractNotebookEntries).toHaveBeenCalledTimes(1);
    expect(storage.createNotebookEntries).not.toHaveBeenCalled();
  });

  it("saves entries on an ordinary turn (control)", async () => {
    await extractAndStoreNotebook(turn);
    expect(storage.createNotebookEntries).toHaveBeenCalledTimes(1);
  });
});
