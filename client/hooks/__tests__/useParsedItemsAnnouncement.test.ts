// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { Platform } from "react-native";

import {
  foundItemsMessage,
  useParsedItemsAnnouncement,
} from "../useParsedItemsAnnouncement";

const { mockAnnounce } = vi.hoisted(() => ({ mockAnnounce: vi.fn() }));

vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AccessibilityInfo: { announceForAccessibility: mockAnnounce },
}));

function setup(initial: { generation: number; count: number }) {
  return renderHook(
    ({ generation, count }) => useParsedItemsAnnouncement(generation, count),
    { initialProps: initial },
  );
}

describe("foundItemsMessage", () => {
  it("pluralizes the item count", () => {
    expect(foundItemsMessage(1)).toBe("Found 1 item. Log All to save.");
    expect(foundItemsMessage(3)).toBe("Found 3 items. Log All to save.");
  });
});

describe("useParsedItemsAnnouncement", () => {
  const originalOS = Platform.OS;

  beforeEach(() => mockAnnounce.mockReset());
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it("stays silent before any parse and on a parse that found nothing", () => {
    const { rerender } = setup({ generation: 0, count: 0 });
    rerender({ generation: 1, count: 0 });
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("announces every new parse on iOS, once per generation", () => {
    Platform.OS = "ios";
    const { rerender } = setup({ generation: 0, count: 0 });
    rerender({ generation: 1, count: 2 });
    rerender({ generation: 1, count: 2 });
    rerender({ generation: 2, count: 3 });
    expect(mockAnnounce.mock.calls).toEqual([
      [foundItemsMessage(2)],
      [foundItemsMessage(3)],
    ]);
  });

  it("on Android announces only a same-count replace (the live region covers the rest)", () => {
    Platform.OS = "android";
    const { rerender } = setup({ generation: 0, count: 0 });
    rerender({ generation: 1, count: 2 });
    expect(mockAnnounce).not.toHaveBeenCalled();
    rerender({ generation: 2, count: 2 });
    expect(mockAnnounce).toHaveBeenCalledWith(foundItemsMessage(2));
  });

  it("tracks the rendered count across a removal that does not bump the generation", () => {
    Platform.OS = "android";
    const { rerender } = setup({ generation: 0, count: 0 });
    rerender({ generation: 1, count: 3 });
    rerender({ generation: 1, count: 2 }); // removeItem
    rerender({ generation: 2, count: 2 }); // same-count replace after it
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith(foundItemsMessage(2));
  });
});
