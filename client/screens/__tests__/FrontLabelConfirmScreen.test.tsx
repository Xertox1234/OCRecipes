// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import FrontLabelConfirmScreen from "../FrontLabelConfirmScreen";

const { mockGoBack, mockPop, mockNavigate, mockReplace, mockRoute } =
  vi.hoisted(() => ({
    mockGoBack: vi.fn(),
    mockPop: vi.fn(),
    mockNavigate: vi.fn(),
    mockReplace: vi.fn(),
    mockRoute: { params: {} as Record<string, unknown> },
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
  uploadFrontLabelPhoto: vi.fn(),
  confirmFrontLabel: vi.fn(),
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
