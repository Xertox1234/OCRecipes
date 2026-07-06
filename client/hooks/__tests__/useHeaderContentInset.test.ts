// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import { useHeaderContentInset } from "../useHeaderContentInset";

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 88,
}));

describe("useHeaderContentInset", () => {
  it("returns the raw header height when called with no extra", () => {
    const { result } = renderHook(() => useHeaderContentInset());

    expect(result.current).toBe(88);
  });

  it("adds the extra spacing on top of the header height", () => {
    const { result } = renderHook(() => useHeaderContentInset(20));

    expect(result.current).toBe(108);
  });
});
