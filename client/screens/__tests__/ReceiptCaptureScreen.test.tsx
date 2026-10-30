// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ReceiptCaptureScreen from "../ReceiptCaptureScreen";

const {
  mockReplace,
  mockGoBack,
  mockDeleteAsync,
  mockLaunchImageLibrary,
  mockTakePicture,
  mockRecognize,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockGoBack: vi.fn(),
  mockDeleteAsync: vi.fn().mockResolvedValue(undefined),
  mockLaunchImageLibrary: vi.fn(),
  mockTakePicture: vi.fn(),
  mockRecognize: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    replace: mockReplace,
    goBack: mockGoBack,
  }),
  useIsFocused: () => true,
}));

vi.mock("@/camera", async () => {
  const React = await import("react");
  return {
    CameraView: React.forwardRef(function CameraView(_props, ref) {
      React.useImperativeHandle(ref, () => ({ takePicture: mockTakePicture }));
      return null;
    }),
    useCameraPermissions: () => ({
      permission: { status: "granted", canAskAgain: false },
      isLoading: false,
      requestPermission: vi.fn(),
    }),
    recognizeTextFromPhoto: (...args: unknown[]) => mockRecognize(...args),
  };
});

vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibrary(...args),
}));

vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: mockDeleteAsync,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: true }),
}));

vi.mock("@/hooks/useReceiptScan", () => ({
  useReceiptScanCount: () => ({ data: undefined }),
}));

// @/components/UpgradeModal transitively imports @/lib/iap, which does a
// runtime require("./mock-iap") Vite's ESM graph can't resolve under jsdom —
// same as ScanScreen.test.tsx. Not rendered in these tests (isPremium: true).
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

const GALLERY_URI_1 = "file:///gallery-1.jpg";
const GALLERY_URI_2 = "file:///gallery-2.jpg";

async function pickTwoFromGallery() {
  const rendered = renderComponent(<ReceiptCaptureScreen />);

  mockLaunchImageLibrary.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: GALLERY_URI_1 }, { uri: GALLERY_URI_2 }],
  });

  await act(async () => {
    fireEvent.click(screen.getByLabelText("Pick from gallery"));
  });

  await screen.findByLabelText("Remove photo 1");

  return rendered;
}

describe("ReceiptCaptureScreen — captured photo file cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
    mockRecognize.mockResolvedValue({ text: "", blocks: [] });
  });

  // Audit finding L2: "removed receipt photos" are never deleted. Fails on
  // main (deleteAsync is never imported/called by this screen).
  it("deletes a photo's file immediately when the user removes it", async () => {
    await pickTwoFromGallery();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove photo 1"));
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith(GALLERY_URI_1, {
      idempotent: true,
    });
    expect(mockDeleteAsync).not.toHaveBeenCalledWith(
      GALLERY_URI_2,
      expect.anything(),
    );
  });

  // Risk guard: photos handed to ReceiptReview via Done must survive —
  // navigation.replace() unmounts this screen, so the cleanup effect must
  // check the handoff flag before deleting anything.
  //
  // navigation.replace() is mocked (it doesn't actually unmount the tree), so
  // the original version of this test never drove the unmount-cleanup effect
  // at all — it passed whether or not handedOffRef existed. Unmount for real
  // after Done to actually exercise the guard (mutation-checked: deleting the
  // `handedOffRef.current = true` line in handleDone turns this red).
  it("does not delete photos handed off to ReceiptReview via Done", async () => {
    const { unmount } = await pickTwoFromGallery();

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/^Done with/));
    });

    expect(mockReplace).toHaveBeenCalledWith(
      "ReceiptReview",
      expect.objectContaining({
        photoUris: [GALLERY_URI_1, GALLERY_URI_2],
      }),
    );

    await act(async () => {
      unmount();
    });

    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });

  // Abandoned-flow half of L2: closing the screen (unmount) without tapping
  // Done must not leak the captured files.
  it("deletes every remaining captured photo when the screen unmounts without completing", async () => {
    const { unmount } = renderComponent(<ReceiptCaptureScreen />);

    mockLaunchImageLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: GALLERY_URI_1 }, { uri: GALLERY_URI_2 }],
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Pick from gallery"));
    });
    await screen.findByLabelText("Remove photo 1");

    await act(async () => {
      unmount();
    });

    await waitFor(() => {
      expect(mockDeleteAsync).toHaveBeenCalledWith(GALLERY_URI_1, {
        idempotent: true,
      });
      expect(mockDeleteAsync).toHaveBeenCalledWith(GALLERY_URI_2, {
        idempotent: true,
      });
    });
  });
});

describe("ReceiptCaptureScreen — capture and gallery failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
  });

  // The photo is only added to the list after on-device OCR finishes, so
  // leaving the screen mid-OCR used to leak its file
  // (audit 2026-10-29 L-cam-4).
  it("deletes a photo whose OCR is still running when the screen unmounts", async () => {
    mockTakePicture.mockResolvedValue({ uri: "file:///capture-1.jpg" });
    mockRecognize.mockReturnValue(new Promise(() => {})); // never settles
    const { unmount } = renderComponent(<ReceiptCaptureScreen />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo of receipt"));
    });
    await waitFor(() => expect(mockRecognize).toHaveBeenCalled());

    await act(async () => {
      unmount();
    });

    await waitFor(() =>
      expect(mockDeleteAsync).toHaveBeenCalledWith("file:///capture-1.jpg", {
        idempotent: true,
      }),
    );
  });

  // A picker error (e.g. photo-library permission denied) was an unhandled
  // rejection with no feedback (audit 2026-10-29 L-cam-5).
  it("tells the user when the gallery picker fails", async () => {
    const RN = await import("react-native");
    const alertSpy = vi.spyOn(RN.Alert, "alert");
    mockLaunchImageLibrary.mockRejectedValueOnce(new Error("denied"));
    renderComponent(<ReceiptCaptureScreen />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Pick from gallery"));
    });

    expect(alertSpy).toHaveBeenCalled();
  });
});
