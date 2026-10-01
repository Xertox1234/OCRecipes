// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import FrontLabelConfirmScreen from "../FrontLabelConfirmScreen";

const {
  mockGoBack,
  mockPop,
  mockNavigate,
  mockReplace,
  mockRoute,
  mockDeleteAsync,
  mockUploadFrontLabelPhoto,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockPop: vi.fn(),
  mockNavigate: vi.fn(),
  mockReplace: vi.fn(),
  mockRoute: { params: {} as Record<string, unknown> },
  mockDeleteAsync: vi.fn().mockResolvedValue(undefined),
  mockUploadFrontLabelPhoto: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    pop: mockPop,
    navigate: mockNavigate,
    replace: mockReplace,
  }),
  useRoute: () => mockRoute,
}));

vi.mock("@/lib/photo-upload", () => ({
  uploadFrontLabelPhoto: mockUploadFrontLabelPhoto,
  confirmFrontLabel: vi.fn(),
}));

// FrontLabelConfirmScreen deletes its captured temp photo on unmount — the
// real module hits a native module at import time under jsdom.
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: mockDeleteAsync,
}));

describe("FrontLabelConfirmScreen — Retake", () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    mockPop.mockClear();
    mockNavigate.mockClear();
    mockReplace.mockClear();
    // A non-null sessionId skips the mount-time background AI upload effect
    // (route.params.sessionId !== null short-circuits it), which is
    // irrelevant to the Retake behavior under test here.
    mockRoute.params = {
      imageUri: "file:///front.jpg",
      barcode: "0778918011332",
      sessionId: "session-1",
      data: {
        brand: "Acme",
        productName: "Test Product",
        netWeight: "12 oz",
        claims: [],
        confidence: 0.9,
      },
    };
  });

  // Retake used to `replace()` this screen with a second Scan(front-label)
  // instance, leaving the original Scan(front-label) — already directly
  // beneath this screen on the stack — in place underneath it. That extra
  // level made the eventual success `pop(2)` land one screen short (on a
  // live camera, or, with a naive navigate()-based fix, on this now-stale
  // screen instead). goBack() pops straight back to the existing
  // Scan(front-label) instance, keeping the stack shape pop(2) expects.
  it("goes back (not replace/navigate) to the existing Scan(front-label) instance", () => {
    renderComponent(<FrontLabelConfirmScreen />);

    const retake = screen.getByText("Retake");
    fireEvent.click(retake);

    // Control: the tap reached the Retake handler.
    expect(
      mockGoBack.mock.calls.length +
        mockPop.mock.calls.length +
        mockNavigate.mock.calls.length +
        mockReplace.mock.calls.length,
    ).toBe(1);

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockPop).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("FrontLabelConfirmScreen — captured temp photo cleanup", () => {
  const IMAGE_URI = "file:///front.jpg";

  beforeEach(() => {
    mockGoBack.mockClear();
    mockPop.mockClear();
    mockNavigate.mockClear();
    mockReplace.mockClear();
    mockDeleteAsync.mockClear();
    mockDeleteAsync.mockResolvedValue(undefined);
    mockUploadFrontLabelPhoto.mockClear();
    // Non-null sessionId skips the mount-time background AI upload effect —
    // irrelevant to the cleanup behavior under test here (mirrors the
    // Retake describe block's setup above).
    mockRoute.params = {
      imageUri: IMAGE_URI,
      barcode: "0778918011332",
      sessionId: "session-1",
      data: {
        brand: "Acme",
        productName: "Test Product",
        netWeight: "12 oz",
        claims: [],
        confidence: 0.9,
      },
    };
  });

  // Neither exit (confirm-success pop(2), nor Retake's goBack) ever cleaned
  // up the original captured photo — client/lib/photo-upload.ts's
  // uploadFrontLabelPhoto only cleans up its OWN internally-compressed copy
  // (see docs/solutions/design-patterns/compress-upload-cleanup-for-image-uploads-2026-05-13.md),
  // not the original file this screen was handed. Fails on main (deleteAsync
  // is never imported/called by this screen).
  it("deletes the captured photo file once the screen unmounts", () => {
    const { unmount } = renderComponent(<FrontLabelConfirmScreen />);

    expect(mockDeleteAsync).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith(IMAGE_URI, {
      idempotent: true,
    });
  });

  // Negative control: while the user can still view/retake the photo, the
  // file must survive — cleanup is unmount-only, matching
  // LabelAnalysisScreen.tsx's same deliberately-unmount-only cleanup. Both
  // real exits (confirm-success pop(2), Retake's goBack()) are true
  // unmounts, so this single unmount-only effect covers both — no
  // per-exit-path test is needed beyond the "Retake" describe block above,
  // which already confirms goBack() is what fires.
  it("does not delete the file while the screen is still mounted", () => {
    renderComponent(<FrontLabelConfirmScreen />);

    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });
});
