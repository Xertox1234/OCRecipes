// @vitest-environment jsdom
// Separate from ToastContext.test.tsx on purpose: that file needs the REAL
// Toast (live region, announcements); this one mocks Toast to read its props.
import React, { useEffect } from "react";
import { act } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { ToastProvider, useToast, ModalToastHost } from "../ToastContext";

const toastProps = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@/components/Toast", () => ({
  Toast: (props: Record<string, unknown>) => {
    toastProps.push(props);
    return null;
  },
}));

type Api = ReturnType<typeof useToast>;
let api: Api;
function Capture() {
  const current = useToast();
  // Assigned in an effect (not during render) to satisfy react-hooks/globals.
  useEffect(() => {
    api = current;
  });
  return null;
}

describe("toast top inset by host", () => {
  const originalOS = RN.Platform.OS;

  beforeEach(() => {
    toastProps.length = 0;
  });
  afterEach(() => {
    RN.Platform.OS = originalOS;
  });

  it("root host: Toast keeps its own safe-area top (no topInset override)", () => {
    renderComponent(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    act(() => api.info("Recipe ready"));
    expect(toastProps.length).toBeGreaterThan(0);
    expect(toastProps[toastProps.length - 1]).not.toHaveProperty("topInset");
  });

  it("modal host on iOS: Toast gets topInset 0 — a pageSheet is laid out below the status bar", () => {
    RN.Platform.OS = "ios";
    renderComponent(
      <ToastProvider>
        <Capture />
        <ModalToastHost />
      </ToastProvider>,
    );
    act(() => api.info("Recipe ready"));
    expect(toastProps.length).toBeGreaterThan(0);
    expect(toastProps[toastProps.length - 1]).toMatchObject({ topInset: 0 });
  });

  it("modal host on Android: Toast keeps its safe-area top — the Modal window is edge-to-edge, under the status bar", () => {
    RN.Platform.OS = "android";
    renderComponent(
      <ToastProvider>
        <Capture />
        <ModalToastHost />
      </ToastProvider>,
    );
    act(() => api.info("Recipe ready"));
    expect(toastProps.length).toBeGreaterThan(0);
    expect(toastProps[toastProps.length - 1].topInset).toBeUndefined();
  });
});
