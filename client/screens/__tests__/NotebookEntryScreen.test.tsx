// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import NotebookEntryScreen from "../NotebookEntryScreen";

// ── Hoisted mock factories ────────────────────────────────────────────────────
const {
  mockUseNotebookEntries,
  mockCreateMutateAsync,
  mockUpdateMutateAsync,
  mockGoBack,
  mockCanGoBack,
  mockNavigate,
  mockRefetch,
  mockRouteParams,
  mockToast,
  mockScheduleReminder,
  mockCancelReminder,
} = vi.hoisted(() => ({
  mockUseNotebookEntries: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockNavigate: vi.fn(),
  mockRefetch: vi.fn(),
  mockRouteParams: { params: undefined as { entryId?: number } | undefined },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  mockScheduleReminder: vi.fn(),
  mockCancelReminder: vi.fn(),
}));

vi.mock("@/hooks/useChat", () => ({
  useNotebookEntries: () => mockUseNotebookEntries(),
  useCreateNotebookEntry: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useUpdateNotebookEntry: () => ({
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    navigate: mockNavigate,
  }),
  useRoute: () => mockRouteParams,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/hooks/useNotebookNotifications", () => ({
  useNotebookNotifications: () => ({
    scheduleCommitmentReminder: mockScheduleReminder,
    cancelCommitmentReminder: mockCancelReminder,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<{
    id: number;
    type: string;
    content: string;
    status: string;
    followUpDate: string | null;
    sourceConversationId: number | null;
    dedupeKey: string | null;
    createdAt: string;
    updatedAt: string;
  }> = {},
) {
  return {
    id: 42,
    type: "insight",
    content: "A great insight",
    status: "active",
    followUpDate: null,
    sourceConversationId: null,
    dedupeKey: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function setupEntries(
  entries: ReturnType<typeof makeEntry>[],
  opts: { isLoading?: boolean; isError?: boolean } = {},
) {
  mockUseNotebookEntries.mockReturnValue({
    data: entries,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    refetch: mockRefetch,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.params = undefined;
  mockCanGoBack.mockReturnValue(true);
  mockScheduleReminder.mockResolvedValue(undefined);
  mockCancelReminder.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NotebookEntryScreen — create mode (entryId omitted)", () => {
  it("renders the Save button when entryId is omitted", () => {
    mockRouteParams.params = undefined;
    setupEntries([]);

    renderComponent(<NotebookEntryScreen />);
    expect(screen.getByText("Save")).toBeDefined();
  });
});

describe("NotebookEntryScreen — entryId = 0 (malformed deep link)", () => {
  it("shows not-found when entryId is 0 and loading has settled", () => {
    // A deep link like ocrecipes://notebook-entry/bad coerces entryId to 0 via
    // parseIntOrZero; no entry will match id===0, so the not-found view fires.
    mockRouteParams.params = { entryId: 0 };
    setupEntries([], { isLoading: false });

    renderComponent(<NotebookEntryScreen />);
    expect(
      screen.getByText(
        "This entry couldn't be found. It may have been deleted.",
      ),
    ).toBeDefined();
    // No Retry button — it's a not-found, not an error
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("does NOT show not-found while still loading", () => {
    // isLoading=true → the guard `!isLoading && !entry` is false → don't show
    // the not-found screen yet; the entry may still be in flight.
    mockRouteParams.params = { entryId: 0 };
    setupEntries([], { isLoading: true });

    renderComponent(<NotebookEntryScreen />);
    expect(
      screen.queryByText(
        "This entry couldn't be found. It may have been deleted.",
      ),
    ).toBeNull();
  });
});

describe("NotebookEntryScreen — isError (network failure)", () => {
  it("shows error message and Retry button when query errors", () => {
    mockRouteParams.params = { entryId: 99 };
    setupEntries([], { isLoading: false, isError: true });

    renderComponent(<NotebookEntryScreen />);
    expect(
      screen.getByText(
        "Couldn't load this entry. Check your connection and try again.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Retry")).toBeDefined();
  });

  it("calls refetch when Retry is pressed", () => {
    mockRouteParams.params = { entryId: 99 };
    setupEntries([], { isLoading: false, isError: true });

    renderComponent(<NotebookEntryScreen />);
    fireEvent.click(screen.getByText("Retry"));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });
});

describe("NotebookEntryScreen — cold-load valid entry", () => {
  it("populates content from the loaded entry", () => {
    mockRouteParams.params = { entryId: 42 };
    setupEntries([
      makeEntry({ id: 42, content: "My notebook thought", type: "insight" }),
    ]);

    renderComponent(<NotebookEntryScreen />);
    // The content TextInput should show the entry's content value
    const input = screen.getByDisplayValue("My notebook thought");
    expect(input).toBeDefined();
  });

  it("shows the Save button (edit mode)", () => {
    mockRouteParams.params = { entryId: 42 };
    setupEntries([makeEntry({ id: 42 })]);

    renderComponent(<NotebookEntryScreen />);
    expect(screen.getByText("Save")).toBeDefined();
  });
});

describe("NotebookEntryScreen — safe back navigation", () => {
  // A cold-start deep link (e.g. a push-notification tap) can land this
  // screen as the stack's sole entry — goBack() would be a silent no-op.
  it("goes back normally when a back stack exists", () => {
    mockCanGoBack.mockReturnValue(true);
    mockRouteParams.params = { entryId: 42 };
    setupEntries([makeEntry({ id: 42 })]);

    renderComponent(<NotebookEntryScreen />);
    fireEvent.click(screen.getByLabelText("Go back"));

    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("falls back to the Coach tab when there is no back stack", () => {
    mockCanGoBack.mockReturnValue(false);
    mockRouteParams.params = { entryId: 42 };
    setupEntries([makeEntry({ id: 42 })]);

    renderComponent(<NotebookEntryScreen />);
    fireEvent.click(screen.getByLabelText("Go back"));

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("Main", { screen: "CoachTab" });
  });

  it("falls back to the Coach tab from the not-found screen when there is no back stack", () => {
    mockCanGoBack.mockReturnValue(false);
    mockRouteParams.params = { entryId: 0 };
    setupEntries([], { isLoading: false });

    renderComponent(<NotebookEntryScreen />);
    fireEvent.click(screen.getByLabelText("Go back"));

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("Main", { screen: "CoachTab" });
  });

  it("falls back after a successful save when there is no back stack", async () => {
    mockCanGoBack.mockReturnValue(false);
    mockRouteParams.params = undefined;
    setupEntries([]);
    mockCreateMutateAsync.mockResolvedValue(
      makeEntry({ type: "insight", followUpDate: null }),
    );

    renderComponent(<NotebookEntryScreen />);
    fireEvent.change(screen.getByDisplayValue(""), {
      target: { value: "A new thought" },
    });
    fireEvent.click(screen.getByText("Save"));

    await Promise.resolve();
    expect(mockNavigate).toHaveBeenCalledWith("Main", { screen: "CoachTab" });
  });
});
