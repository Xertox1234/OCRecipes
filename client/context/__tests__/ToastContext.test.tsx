// @vitest-environment jsdom
import React from "react";
import { act, screen } from "@testing-library/react";
import * as RN from "react-native";
import { FullWindowOverlay } from "react-native-screens";
import { NotificationFeedbackType } from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { ToastProvider, useToast, ModalToastHost } from "../ToastContext";

const ghRootProps = vi.hoisted(() => [] as Record<string, unknown>[]);
const mockNotification = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: mockNotification,
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("react-native-gesture-handler", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const R = await import("react");
  return {
    ...actual,
    GestureHandlerRootView: ({
      children,
      ...rest
    }: {
      children?: React.ReactNode;
    }) => {
      ghRootProps.push(rest);
      return R.createElement("div", null, children);
    },
  };
});

type Api = ReturnType<typeof useToast>;
let api: Api;
function Capture() {
  api = useToast();
  return null;
}

function mount() {
  return renderComponent(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
}

describe("ToastProvider host", () => {
  const originalOS = RN.Platform.OS;

  beforeEach(() => {
    ghRootProps.length = 0;
  });
  afterEach(() => {
    RN.Platform.OS = originalOS;
  });

  it("control: a bare FullWindowOverlay mock is aria-modal", () => {
    renderComponent(
      <FullWindowOverlay>
        <div />
      </FullWindowOverlay>,
    );
    expect(
      screen.getByTestId("full-window-overlay").getAttribute("aria-modal"),
    ).toBe("true");
  });

  it("iOS: renders the toast inside a non-modal, touch-transparent overlay", () => {
    RN.Platform.OS = "ios";
    mount();
    const onPress = vi.fn();
    act(() => {
      api.info("Coach replied — tap to open", {
        action: { label: "Open", onPress },
      });
    });
    const overlay = screen.getByTestId("full-window-overlay");
    expect(overlay.getAttribute("aria-modal")).toBeNull();
    expect(overlay.textContent).toContain("Coach replied — tap to open");
    expect(overlay.textContent).toContain("Open");
    expect(ghRootProps.some((p) => p.pointerEvents === "box-none")).toBe(true);
  });

  it("Android: renders the toast with no overlay", () => {
    RN.Platform.OS = "android";
    mount();
    act(() => {
      api.info("Coach replied");
    });
    expect(screen.getByText("Coach replied")).toBeDefined();
    expect(screen.queryByTestId("full-window-overlay")).toBeNull();
  });

  it("mounts the overlay only while a toast shows, one per toast", () => {
    RN.Platform.OS = "ios";
    mount();
    expect(screen.queryByTestId("full-window-overlay")).toBeNull();
    act(() => {
      api.info("A");
    });
    const a = screen.getByTestId("full-window-overlay");
    act(() => {
      api.info("B");
    });
    const b = screen.getByTestId("full-window-overlay");
    expect(b).not.toBe(a);
    act(() => {
      api.dismiss();
    });
    expect(screen.queryByTestId("full-window-overlay")).toBeNull();
  });
});

describe("ToastProvider haptics", () => {
  beforeEach(() => {
    mockNotification.mockClear();
  });

  it("success fires a Success notification haptic", () => {
    mount();
    act(() => {
      api.success("Saved");
    });
    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(mockNotification).toHaveBeenCalledWith(
      NotificationFeedbackType.Success,
    );
  });

  it("error fires an Error notification haptic", () => {
    mount();
    act(() => {
      api.error("Couldn't save");
    });
    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(mockNotification).toHaveBeenCalledWith(
      NotificationFeedbackType.Error,
    );
  });

  it("info stays silent", () => {
    mount();
    act(() => {
      api.info("Coach replied");
    });
    expect(screen.getByText("Coach replied")).toBeDefined();
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("haptic: false shows the toast without a haptic", () => {
    mount();
    act(() => {
      api.success("Back online", { haptic: false });
      api.error("Session expired", { haptic: false });
    });
    expect(screen.getByText("Session expired")).toBeDefined();
    expect(mockNotification).not.toHaveBeenCalled();
  });
});

describe("ModalToastHost (toast over an RN Modal sheet)", () => {
  const originalOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });
  afterEach(() => {
    RN.Platform.OS = originalOS;
    announceSpy.mockRestore();
  });

  function mountWithModal(showModal: boolean) {
    return renderComponent(
      <ToastProvider>
        <Capture />
        {showModal ? <ModalToastHost /> : null}
      </ToastProvider>,
    );
  }

  it("renders the toast in the modal and suppresses the root overlay: one visible toast, one announcement", () => {
    RN.Platform.OS = "ios";
    mountWithModal(true);
    act(() => {
      api.info("Recipe ready");
    });
    expect(screen.getAllByText("Recipe ready")).toHaveLength(1);
    expect(screen.queryByTestId("full-window-overlay")).toBeNull();
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while there is no toast", () => {
    RN.Platform.OS = "ios";
    mountWithModal(true);
    expect(screen.queryByText("Recipe ready")).toBeNull();
  });

  it("falls back to the root overlay once the modal host unmounts", () => {
    RN.Platform.OS = "ios";
    const view = mountWithModal(true);
    act(() => {
      api.info("Recipe ready");
    });
    expect(screen.queryByTestId("full-window-overlay")).toBeNull();
    view.rerender(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    act(() => {
      api.info("Second");
    });
    expect(screen.getByTestId("full-window-overlay").textContent).toContain(
      "Second",
    );
    expect(screen.getAllByText("Second")).toHaveLength(1);
  });

  it("two mounted modal hosts still show a single toast", () => {
    RN.Platform.OS = "ios";
    renderComponent(
      <ToastProvider>
        <Capture />
        <ModalToastHost />
        <ModalToastHost />
      </ToastProvider>,
    );
    act(() => {
      api.info("Only once");
    });
    expect(screen.getAllByText("Only once")).toHaveLength(1);
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it("a modal host mounting mid-toast moves the toast without duplicating it", () => {
    RN.Platform.OS = "ios";
    const view = mountWithModal(false);
    act(() => {
      api.info("Mid-flight");
    });
    expect(screen.getByTestId("full-window-overlay")).toBeDefined();
    view.rerender(
      <ToastProvider>
        <Capture />
        <ModalToastHost />
      </ToastProvider>,
    );
    expect(screen.queryByTestId("full-window-overlay")).toBeNull();
    expect(screen.getAllByText("Mid-flight")).toHaveLength(1);
    // The move is a remount (different subtrees); the announcement belongs to
    // the toast, not the mount, so VoiceOver hears it once.
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it("a modal host unmounting mid-toast does not announce the toast again", () => {
    RN.Platform.OS = "ios";
    const view = mountWithModal(true);
    act(() => {
      api.info("Mid-flight");
    });
    expect(announceSpy).toHaveBeenCalledTimes(1);
    view.rerender(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    expect(screen.getByTestId("full-window-overlay").textContent).toContain(
      "Mid-flight",
    );
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ModalToastHost dismiss timer across a host change", () => {
  const originalOS = RN.Platform.OS;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    RN.Platform.OS = originalOS;
    vi.useRealTimers();
  });

  it("measures the 3 s window from the toast's creation, not from the remount", () => {
    RN.Platform.OS = "ios";
    const view = renderComponent(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    act(() => {
      api.info("Mid-flight");
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // A sheet opens 2 s in: the toast moves into its host.
    view.rerender(
      <ToastProvider>
        <Capture />
        <ModalToastHost />
      </ToastProvider>,
    );
    expect(screen.getAllByText("Mid-flight")).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.queryByText("Mid-flight")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Mid-flight")).toBeNull();
  });
});
