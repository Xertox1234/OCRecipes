// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import MemoryRefsTag from "../MemoryRefsTag";

const { mockNavigate, notebook } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  notebook: { data: [] as unknown[] },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
vi.mock("@/hooks/useNotebook", () => ({
  useNotebookEntries: () => ({ data: notebook.data }),
}));

const entry = (id: number, content: string, label: string | null = null) => ({
  id,
  type: "preference",
  content,
  label,
  status: "active",
});

beforeEach(() => {
  vi.clearAllMocks();
  notebook.data = [
    entry(5, "The user avoids dairy"),
    entry(6, "x", "quick breakfasts"),
  ];
});

it("names the memories a reply used", () => {
  renderComponent(<MemoryRefsTag ids={[5, 6]} />);
  expect(screen.getByText("From your notebook:")).toBeTruthy();
  expect(screen.getByRole("button", { name: "You avoid dairy" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "quick breakfasts" })).toBeTruthy();
});

it("opens the memory on tap", () => {
  renderComponent(<MemoryRefsTag ids={[6]} />);
  fireEvent.click(screen.getByRole("button", { name: "quick breakfasts" }));
  expect(mockNavigate).toHaveBeenCalledWith("NotebookEntry", { entryId: 6 });
});

it("skips memories it can't find, and renders nothing when none are left", () => {
  const { container } = renderComponent(<MemoryRefsTag ids={[99]} />);
  expect(container.textContent).toBe("");
});
