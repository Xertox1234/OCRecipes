// @vitest-environment jsdom
// Separate from ToastContext.test.tsx on purpose: that file needs the REAL
// Toast (live region, announcements); this one mocks Toast to read its props.
import React from "react";
import { act } from "@testing-library/react";
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
  api = useToast();
  return null;
}

describe("toast top inset by host", () => {
  beforeEach(() => {
    toastProps.length = 0;
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

  it("modal host: Toast gets topInset 0 — an RN Modal sheet is laid out below the status bar", () => {
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
});
