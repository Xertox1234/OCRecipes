// @vitest-environment jsdom
import React from "react";
import { act, screen } from "@testing-library/react";
import * as RN from "react-native";
import { FullWindowOverlay } from "react-native-screens";
import { NotificationFeedbackType } from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { ToastProvider, useToast } from "../ToastContext";

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
