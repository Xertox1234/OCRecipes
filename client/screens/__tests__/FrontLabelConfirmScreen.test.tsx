// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import * as RN from "react-native";
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
  mockConfirmFrontLabel,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockPop: vi.fn(),
  mockNavigate: vi.fn(),
  mockReplace: vi.fn(),
  mockRoute: { params: {} as Record<string, unknown> },
  mockDeleteAsync: vi.fn().mockResolvedValue(undefined),
  mockUploadFrontLabelPhoto: vi.fn(),
  mockConfirmFrontLabel: vi.fn(),
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
  confirmFrontLabel: mockConfirmFrontLabel,
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

describe("FrontLabelConfirmScreen — accessibility announcements", () => {
  const originalOS = RN.Platform.OS;
  const TOAST = "Updated with AI analysis";
  const LOW = "Low confidence — review carefully before saving";
  const MEDIUM = "Some details may be inaccurate — review before saving";
  const UPLOAD_ERROR = "Could not analyze front label. Please try again.";
  const SAVE_ERROR = "Failed to save product details";

  const localData = (confidence: number) => ({
    brand: "Acme",
    productName: "Test Product",
    netWeight: "12 oz",
    claims: [] as string[],
    confidence,
  });

  let announce: ReturnType<typeof vi.spyOn>;

  const setRoute = (sessionId: string | null, confidence = 0.9) => {
    mockRoute.params = {
      imageUri: "file:///front.jpg",
      barcode: "0778918011332",
      sessionId,
      data: localData(confidence),
    };
  };

  beforeEach(() => {
    mockUploadFrontLabelPhoto.mockReset();
    mockConfirmFrontLabel.mockReset();
    mockDeleteAsync.mockResolvedValue(undefined);
    announce = vi
      .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
  });

  // Restore in afterEach, not the test body: vitest runs with retry: 2.
  afterEach(() => {
    RN.Platform.OS = originalOS;
    announce.mockRestore();
  });

  const expectNoLiveRegionOrRole = (text: HTMLElement) => {
    for (const node of [text, text.parentElement!]) {
      expect(node.getAttribute("aria-live")).toBeNull();
      expect(node.getAttribute("role")).toBeNull();
    }
  };

  describe("local -> AI upgrade", () => {
    it.each([
      {
        name: "toast and low banner",
        aiBrand: "Acme Foods",
        aiConfidence: 0.3,
        localConfidence: 0.9,
        visible: [TOAST, LOW],
        spoken: `${TOAST}. ${LOW}`,
      },
      {
        name: "no toast and medium banner (AI confirms a medium local preview)",
        aiBrand: "Acme",
        aiConfidence: 0.6,
        localConfidence: 0.6,
        visible: [MEDIUM],
        spoken: MEDIUM,
      },
      {
        name: "toast and high tier",
        aiBrand: "Acme Foods",
        aiConfidence: 0.9,
        localConfidence: 0.9,
        visible: [TOAST],
        spoken: TOAST,
      },
    ])(
      "announces once: $name",
      async ({ aiBrand, aiConfidence, localConfidence, visible, spoken }) => {
        setRoute(null, localConfidence);
        mockUploadFrontLabelPhoto.mockResolvedValue({
          sessionId: "session-ai",
          data: { ...localData(aiConfidence), brand: aiBrand },
        });

        const { rerender } = renderComponent(<FrontLabelConfirmScreen />);

        // Denominator: what will be spoken is on screen.
        for (const text of visible) await screen.findByText(text);

        await waitFor(() => expect(announce).toHaveBeenCalledWith(spoken));
        expect(announce).toHaveBeenCalledTimes(1);

        // No repeat on an unrelated re-render.
        rerender(<FrontLabelConfirmScreen />);
        expect(announce).toHaveBeenCalledTimes(1);
      },
    );

    it("stays silent for a high-tier upgrade with no toast", async () => {
      setRoute(null, 0.9);
      mockUploadFrontLabelPhoto.mockResolvedValue({
        sessionId: "session-ai",
        data: localData(0.6),
      });

      renderComponent(<FrontLabelConfirmScreen />);
      // The upgrade happened: the "Verifying with AI" hint is gone.
      await screen.findByLabelText("Confirm and save product details");
      expect(screen.queryByText(/Verifying with AI/)).toBeNull();
      expect(announce).not.toHaveBeenCalled();
    });

    it("announces the same string once on Android (ungated)", async () => {
      RN.Platform.OS = "android";
      setRoute(null, 0.9);
      mockUploadFrontLabelPhoto.mockResolvedValue({
        sessionId: "session-ai",
        data: { ...localData(0.3), brand: "Acme Foods" },
      });

      renderComponent(<FrontLabelConfirmScreen />);
      await screen.findByText(LOW);

      await waitFor(() =>
        expect(announce).toHaveBeenCalledWith(`${TOAST}. ${LOW}`),
      );
      expect(announce).toHaveBeenCalledTimes(1);
    });

    it("leaves no live region or role on the toast or the banner", async () => {
      setRoute(null, 0.9);
      mockUploadFrontLabelPhoto.mockResolvedValue({
        sessionId: "session-ai",
        data: { ...localData(0.3), brand: "Acme Foods" },
      });

      renderComponent(<FrontLabelConfirmScreen />);
      const toast = await screen.findByText(TOAST);
      const banner = await screen.findByText(LOW);

      expectNoLiveRegionOrRole(toast);
      expectNoLiveRegionOrRole(banner);
    });
  });

  it("renders the banner but stays silent when mounted with a session (edge-only)", async () => {
    setRoute("session-1", 0.3);

    renderComponent(<FrontLabelConfirmScreen />);

    await screen.findByText(LOW);
    expect(announce).not.toHaveBeenCalled();
  });

  describe("error banners", () => {
    it("announces an upload error once on iOS", async () => {
      setRoute(null);
      mockUploadFrontLabelPhoto.mockRejectedValue(new Error("boom"));

      renderComponent(<FrontLabelConfirmScreen />);
      const text = await screen.findByText(UPLOAD_ERROR);

      await waitFor(() => expect(announce).toHaveBeenCalledWith(UPLOAD_ERROR));
      expect(announce).toHaveBeenCalledTimes(1);
      expect(text.parentElement!.getAttribute("aria-live")).toBe("assertive");
    });

    it("relies on the assertive live region, not an announce, on Android (upload error)", async () => {
      RN.Platform.OS = "android";
      setRoute(null);
      mockUploadFrontLabelPhoto.mockRejectedValue(new Error("boom"));

      renderComponent(<FrontLabelConfirmScreen />);
      const text = await screen.findByText(UPLOAD_ERROR);

      expect(text.parentElement!.getAttribute("aria-live")).toBe("assertive");
      expect(announce).not.toHaveBeenCalled();
    });

    it("announces each save failure once on iOS", async () => {
      setRoute("session-1");
      mockConfirmFrontLabel.mockRejectedValue(new Error("boom"));

      renderComponent(<FrontLabelConfirmScreen />);

      fireEvent.click(screen.getByText("Looks Good"));
      const text = await screen.findByText(SAVE_ERROR);
      await waitFor(() => expect(announce).toHaveBeenCalledTimes(1));
      expect(announce).toHaveBeenCalledWith(SAVE_ERROR);
      expect(text.parentElement!.getAttribute("aria-live")).toBe("assertive");

      fireEvent.click(screen.getByText("Looks Good"));
      await waitFor(() => expect(announce).toHaveBeenCalledTimes(2));
    });

    it("relies on the assertive live region, not an announce, on Android (save error)", async () => {
      RN.Platform.OS = "android";
      setRoute("session-1");
      mockConfirmFrontLabel.mockRejectedValue(new Error("boom"));

      renderComponent(<FrontLabelConfirmScreen />);

      fireEvent.click(screen.getByText("Looks Good"));
      const text = await screen.findByText(SAVE_ERROR);

      expect(text.parentElement!.getAttribute("aria-live")).toBe("assertive");
      expect(announce).not.toHaveBeenCalled();
    });
  });
});
