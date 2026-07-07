// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import { useFromHomeBackRedirect } from "../useFromHomeBackRedirect";

const { usePreventRemoveMock } = vi.hoisted(() => ({
  usePreventRemoveMock: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  usePreventRemove: usePreventRemoveMock,
}));

function makeNavigation() {
  const parentNavigate = vi.fn();
  const navigation = {
    dispatch: vi.fn(),
    setParams: vi.fn(),
    getParent: vi.fn(() => ({ navigate: parentNavigate })),
  };
  return { navigation, parentNavigate };
}

function getCallback() {
  return usePreventRemoveMock.mock.calls.at(-1)?.[1] as (e: {
    data: { action: { type: string } };
  }) => void;
}

describe("useFromHomeBackRedirect", () => {
  beforeEach(() => {
    usePreventRemoveMock.mockClear();
  });

  it("arms usePreventRemove only when fromHome is truthy", () => {
    const { navigation } = makeNavigation();

    renderHook(() => useFromHomeBackRedirect(navigation, undefined));
    expect(usePreventRemoveMock).toHaveBeenCalledWith(
      false,
      expect.any(Function),
    );

    renderHook(() => useFromHomeBackRedirect(navigation, true));
    expect(usePreventRemoveMock).toHaveBeenCalledWith(
      true,
      expect.any(Function),
    );
  });

  // The native-stack header back button / iOS swipe-back gesture dispatch
  // "POP", not "GO_BACK" — only an explicit navigation.goBack() call
  // produces the latter. Both must redirect.
  it.each(["GO_BACK", "POP"])(
    "redirects to HomeTab and clears the flag on a %s action",
    (actionType) => {
      const { navigation, parentNavigate } = makeNavigation();

      renderHook(() => useFromHomeBackRedirect(navigation, true));
      getCallback()({ data: { action: { type: actionType } } });

      expect(navigation.setParams).toHaveBeenCalledWith({
        fromHome: undefined,
      });
      expect(parentNavigate).toHaveBeenCalledWith("HomeTab");
      expect(navigation.dispatch).not.toHaveBeenCalled();
    },
  );

  it("re-dispatches non-back actions (e.g. the screen's own REPLACE) instead of redirecting", () => {
    const { navigation, parentNavigate } = makeNavigation();

    renderHook(() => useFromHomeBackRedirect(navigation, true));
    const action = { type: "REPLACE" };
    getCallback()({ data: { action } });

    expect(navigation.dispatch).toHaveBeenCalledWith(action);
    expect(navigation.setParams).not.toHaveBeenCalled();
    expect(parentNavigate).not.toHaveBeenCalled();
  });
});
