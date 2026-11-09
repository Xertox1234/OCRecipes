// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import SavedToNotebookPopup from "../SavedToNotebookPopup";

const saves = [
  { id: 4, type: "preference", content: "You avoid dairy", label: null },
  { id: 5, type: "goal", content: "You aim for 120 g protein", label: null },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const props = { saves, onConfirm: vi.fn(), onUndo: vi.fn() };
  const utils = renderComponent(<SavedToNotebookPopup {...props} />);
  return { ...utils, props };
}

it("shows what was saved, with Undo", () => {
  setup();
  expect(screen.getByText("Saved to your notebook")).toBeTruthy();
  expect(screen.getByText("You avoid dairy")).toBeTruthy();
  expect(screen.getByText("You aim for 120 g protein")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
});

it("confirms on its own after 6 seconds", () => {
  const { props } = setup();
  act(() => {
    vi.advanceTimersByTime(5999);
  });
  expect(props.onConfirm).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
});

it("Undo rejects instead, and the timer never confirms", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(props.onUndo).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it("announces the save politely to screen readers", () => {
  const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  setup();
  expect(announce).toHaveBeenCalledWith(
    "Saved to your notebook: You avoid dairy. You aim for 120 g protein.",
  );
});

it("renders nothing without saves", () => {
  const { container } = renderComponent(
    <SavedToNotebookPopup saves={[]} onConfirm={vi.fn()} onUndo={vi.fn()} />,
  );
  expect(container.textContent).toBe("");
});
