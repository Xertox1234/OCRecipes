// @vitest-environment jsdom
import { screen, fireEvent } from "@testing-library/react";
import { Alert } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import NotebookScreen from "../NotebookScreen";

const { mockUseNotebookEntries, mockRefetch, mockToast, m, mockNavigate } =
  vi.hoisted(() => ({
    mockUseNotebookEntries: vi.fn(),
    mockRefetch: vi.fn(),
    mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    m: { confirm: vi.fn(), reject: vi.fn(), clear: vi.fn() },
    mockNavigate: vi.fn(),
  }));

vi.mock("@/hooks/useNotebook", () => ({
  useNotebookEntries: () => mockUseNotebookEntries(),
  useConfirmNotebookEntries: () => ({ mutate: m.confirm }),
  useRejectNotebookEntries: () => ({ mutate: m.reject }),
  useClearNotebook: () => ({ mutate: m.clear }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => mockToast,
}));

const entry = (
  id: number,
  type: string,
  content: string,
  confirmedAt: string | null = "2026-11-01",
) => ({ id, type, status: "active", content, confirmedAt, label: null });

function renderWith(data: unknown[] | undefined, extra: object = {}) {
  mockUseNotebookEntries.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
    ...extra,
  });
  renderComponent(<NotebookScreen />);
}

beforeEach(() => vi.clearAllMocks());

describe("What Coach knows", () => {
  it("explains itself and groups memories by meaning", () => {
    renderWith([
      entry(1, "goal", "The user aims for 120 g protein a day"),
      entry(2, "preference", "User avoids dairy"),
      entry(3, "commitment", "User plans to try pumpkin seeds"),
      entry(4, "insight", "Snacks late"),
      entry(5, "coaching_strategy", "Be blunt"),
    ]);
    expect(screen.getByText("What Coach knows")).toBeTruthy();
    expect(
      screen.getByText(
        "Coach uses these to tailor advice. Remove anything that's wrong.",
      ),
    ).toBeTruthy();
    for (const h of [
      "Goals",
      "Preferences",
      "Trying",
      "How Coach talks to you",
    ]) {
      expect(screen.getByText(h)).toBeTruthy();
    }
    expect(screen.getByText("You avoid dairy")).toBeTruthy();
    expect(screen.queryByText("Snacks late")).toBeNull();
    expect(screen.queryByText("Be blunt")).toBeNull();
    expect(
      screen.getByText("Keeps suggestions short and practical."),
    ).toBeTruthy();
  });

  it("asks about an unconfirmed memory: Yes confirms, Remove rejects", () => {
    renderWith([entry(7, "preference", "User likes quick breakfasts", null)]);
    expect(screen.getByText("Is this right?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, that's right" }));
    expect(m.confirm).toHaveBeenCalledWith([7], expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(m.reject).toHaveBeenCalledWith([7], expect.anything());
  });

  it("Edit opens the entry", () => {
    renderWith([entry(7, "preference", "User likes quick breakfasts", null)]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(mockNavigate).toHaveBeenCalledWith("NotebookEntry", { entryId: 7 });
  });

  it("a confirmed memory opens its entry on tap", () => {
    renderWith([entry(2, "preference", "User avoids dairy")]);
    expect(screen.queryByText("Is this right?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "You avoid dairy" }));
    expect(mockNavigate).toHaveBeenCalledWith("NotebookEntry", { entryId: 2 });
  });

  it("Clear everything asks first, then clears", () => {
    const alert = vi.spyOn(Alert, "alert");
    renderWith([entry(2, "preference", "User avoids dairy")]);
    fireEvent.click(
      screen.getByRole("button", { name: "Clear everything Coach knows" }),
    );
    expect(m.clear).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.text === "Clear everything")?.onPress?.();
    expect(m.clear).toHaveBeenCalledTimes(1);
  });

  it("Add stays", () => {
    renderWith([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Add something for Coach to know" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("NotebookEntry", {});
  });

  it("has a plain empty state", () => {
    renderWith([]);
    expect(
      screen.getByText(
        "Coach hasn't saved anything yet. Things you tell it about your goals and preferences show up here.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Clear everything Coach knows" }),
    ).toBeNull();
  });

  it("shows an error with a retry when the entries fail to load", () => {
    renderWith(undefined, { isError: true });
    fireEvent.click(screen.getByText("Try Again"));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("shows an offline state when the entries query is paused", () => {
    renderWith(undefined, { fetchStatus: "paused" });
    expect(screen.getByText("You're offline")).toBeDefined();
  });
});
