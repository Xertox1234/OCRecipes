// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { FadeInUp } from "react-native-reanimated";
import { chatBlockEntrance } from "@/constants/animations";
import { renderComponent } from "../../../../../test/utils/render-component";
import QuickReplies from "../QuickReplies";
import type { QuickReplies as QuickRepliesType } from "@shared/schemas/coach-blocks";

const { mockSelection } = vi.hoisted(() => ({ mockSelection: vi.fn() }));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: mockSelection,
  }),
}));

const block: QuickRepliesType = {
  type: "quick_replies",
  options: [
    { label: "Yes please", message: "Yes, show me more" },
    { label: "Not now", message: "Maybe later" },
  ],
};

describe("QuickReplies", () => {
  it("renders a chip per option", () => {
    renderComponent(<QuickReplies block={block} />);
    expect(screen.getByText("Yes please")).toBeTruthy();
    expect(screen.getByText("Not now")).toBeTruthy();
  });

  it("calls onSelect with the option message and blockKey", () => {
    const onSelect = vi.fn();
    renderComponent(
      <QuickReplies block={block} onSelect={onSelect} blockKey="qk-7" />,
    );
    fireEvent.click(screen.getByLabelText("Yes please"));
    expect(onSelect).toHaveBeenCalledWith("Yes, show me more", "qk-7");
  });

  // The quick reply's send is a programmatic (string) send, which stays
  // silent, so this tick is the moment's one buzz.
  it("ticks once per tap", () => {
    mockSelection.mockClear();
    const onSelect = vi.fn();
    renderComponent(
      <QuickReplies block={block} onSelect={onSelect} blockKey="qk-7" />,
    );

    fireEvent.click(screen.getByLabelText("Not now"));

    expect(mockSelection).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("renders nothing once used (used branch)", () => {
    const { container } = renderComponent(<QuickReplies block={block} used />);
    expect(container.querySelector('[aria-label="Yes please"]')).toBeNull();
  });
});

describe("QuickReplies — entrance", () => {
  afterEach(() => vi.restoreAllMocks());

  function spyDelay() {
    return vi.spyOn(
      FadeInUp as unknown as { delay: (ms: number) => unknown },
      "delay",
    );
  }

  // The chips arrive one after another, the first on the row's own beat.
  it("staggers the chips from the row's entry delay", () => {
    const delay = spyDelay();
    renderComponent(
      <QuickReplies block={block} animateEntry entryDelayMs={90} />,
    );
    expect(delay.mock.calls.map((c) => c[0])).toEqual([
      90,
      90 + chatBlockEntrance.staggerMs,
    ]);
  });

  it("does not animate by default", () => {
    const delay = spyDelay();
    renderComponent(<QuickReplies block={block} />);
    expect(delay).not.toHaveBeenCalled();
    expect(screen.getByText("Not now")).toBeTruthy();
  });
});
