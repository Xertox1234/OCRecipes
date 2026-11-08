// @vitest-environment jsdom
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import NotebookScreen from "../NotebookScreen";

const { mockUseNotebookEntries, mockRefetch, mockToast } = vi.hoisted(() => ({
  mockUseNotebookEntries: vi.fn(),
  mockRefetch: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useNotebook", () => ({
  useNotebookEntries: () => mockUseNotebookEntries(),
  useUpdateNotebookEntry: () => ({ mutate: vi.fn() }),
  useDeleteNotebookEntry: () => ({ mutate: vi.fn() }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), goBack: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => mockToast,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotebookScreen", () => {
  it("says there are no entries when the notebook is genuinely empty", () => {
    mockUseNotebookEntries.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    renderComponent(<NotebookScreen />);

    expect(screen.getByText("No entries yet")).toBeDefined();
  });

  // The row shows the note in second person; its screen-reader label must say
  // the same thing, not the model's raw "The user has…" text (2026-11-02).
  it("labels an entry with the text it shows", () => {
    mockUseNotebookEntries.mockReturnValue({
      data: [
        {
          id: 1,
          type: "insight",
          status: "active",
          content: "The user has logged 0.7g of protein today",
          followUpDate: null,
        },
      ],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    renderComponent(<NotebookScreen />);

    expect(
      screen.getByRole("button", {
        name: "insight: You have logged 0.7g of protein today",
      }),
    ).toBeDefined();
  });

  // A failed load used to render "No entries yet" with no retry
  // (audit 2026-10-29 M-crel-2).
  it("shows an error with a retry when the entries fail to load", () => {
    mockUseNotebookEntries.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    });

    renderComponent(<NotebookScreen />);

    expect(screen.queryByText("No entries yet")).toBeNull();
    fireEvent.click(screen.getByText("Try Again"));
    expect(mockRefetch).toHaveBeenCalled();
  });

  // Offline cold start: the query is paused (not loading, not errored, no data)
  // and used to read as "No entries yet" (audit 2026-10-29 M-crel-5).
  it("shows an offline state when the entries query is paused", () => {
    mockUseNotebookEntries.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      fetchStatus: "paused",
      refetch: mockRefetch,
    });

    renderComponent(<NotebookScreen />);

    expect(screen.queryByText("No entries yet")).toBeNull();
    expect(screen.getByText("You're offline")).toBeDefined();
  });

  // The coach's own notes (chat summaries, how it coaches) sat among the
  // user's goals and preferences, several near-duplicates deep (simulator,
  // 2026-11-08). Owner ruling: keep them, folded into their own section.
  describe("coach's notes", () => {
    const entry = (id: number, type: string, content: string) => ({
      id,
      type,
      status: "active",
      content,
      followUpDate: null,
    });

    function renderWith(data: ReturnType<typeof entry>[]) {
      mockUseNotebookEntries.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        refetch: mockRefetch,
      });
      renderComponent(<NotebookScreen />);
    }

    it("folds summaries and strategy notes into their own section", () => {
      renderWith([
        entry(1, "goal", "Build a filling breakfast"),
        entry(2, "conversation_summary", "Talked through oat swaps"),
        entry(3, "coaching_strategy", "Likes detailed answers"),
      ]);

      expect(screen.getByText("Build a filling breakfast")).toBeDefined();
      expect(screen.queryByText("Talked through oat swaps")).toBeNull();
      expect(screen.queryByText("Likes detailed answers")).toBeNull();

      fireEvent.click(
        screen.getByRole("button", { name: "Coach's notes, 2 entries" }),
      );
      expect(screen.getByText("Talked through oat swaps")).toBeDefined();
      expect(screen.getByText("Likes detailed answers")).toBeDefined();
    });

    it("with only coach's notes, does not claim the notebook is empty", () => {
      renderWith([
        entry(2, "conversation_summary", "Talked through oat swaps"),
      ]);

      expect(screen.queryByText("No entries yet")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Coach's notes, 1 entry" }),
      ).toBeDefined();
    });

    it("the Strategy filter lists strategy notes directly", () => {
      renderWith([entry(3, "coaching_strategy", "Likes detailed answers")]);
      fireEvent.click(
        screen.getByRole("button", { name: "Filter by coaching_strategy" }),
      );

      expect(screen.getByText("Likes detailed answers")).toBeDefined();
      expect(
        screen.queryByRole("button", { name: /Coach's notes/ }),
      ).toBeNull();
    });
  });

  // A ScrollView shrinks by default (flexShrink 1). Above a list taller than
  // the screen, the filter row was squeezed from 48 to 43 pt and clipped the
  // chips' bottom edge — "Insight" read "Insiaht" (simulator, 2026-11-08).
  it("the filter row keeps its height above a long list", () => {
    mockUseNotebookEntries.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });

    renderComponent(<NotebookScreen />);

    let row = screen.getByRole("button", { name: "Filter by all" })
      .parentElement as HTMLElement | null;
    while (row && row.style.flexGrow !== "0") row = row.parentElement;
    expect(row).not.toBeNull();
    expect(row!.style.flexShrink).toBe("0");
  });
});
