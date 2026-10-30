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
});
