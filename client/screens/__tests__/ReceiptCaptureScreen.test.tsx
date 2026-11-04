// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ReceiptCaptureScreen from "../ReceiptCaptureScreen";

vi.mock("@/hooks/useFeatureTip", () => ({
  useMarkFeatureUsed: (feature: string) => mockMarkFeatureUsed(feature),
}));
const mockMarkFeatureUsed = vi.hoisted(() => vi.fn());

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

const { premium, mockRefreshSubscription, mockUpgradeModal } = vi.hoisted(
  () => ({
    premium: {
      value: {
        isPremium: true,
        isPremiumResolved: true,
        isPremiumStatusError: false,
      },
    },
    mockRefreshSubscription: vi.fn(),
    mockUpgradeModal: vi.fn((_props: unknown) => null),
  }),
);

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    ...premium.value,
    refreshSubscription: mockRefreshSubscription,
  }),
}));

vi.mock("@/hooks/useReceiptScan", () => ({
  useReceiptScanCount: () => ({ data: undefined }),
}));

// @/components/UpgradeModal transitively imports @/lib/iap, which does a
// runtime require("./mock-iap") Vite's ESM graph can't resolve under jsdom —
// same as ScanScreen.test.tsx. Stubbed so tests can see whether it rendered.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: (props: unknown) => mockUpgradeModal(props),
}));

beforeEach(() => {
  premium.value = {
    isPremium: true,
    isPremiumResolved: true,
    isPremiumStatusError: false,
  };
});

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

describe("ReceiptCaptureScreen — teaching tips", () => {
  it("marks receipt scanning as used when the screen opens", () => {
    renderComponent(<ReceiptCaptureScreen />);
    expect(mockMarkFeatureUsed).toHaveBeenCalledWith("receiptScan");
  });
});

// A paying user whose status fetch fails must not see the upgrade wall
// (audit 2026-10-29 M-crel-6). Unknown status is neutral: no wall, no camera.
describe("ReceiptCaptureScreen — premium status gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the upgrade wall to a user resolved as free", () => {
    premium.value = {
      isPremium: false,
      isPremiumResolved: true,
      isPremiumStatusError: false,
    };
    renderComponent(<ReceiptCaptureScreen />);
    expect(mockUpgradeModal).toHaveBeenCalled();
  });

  it("shows a retry state, not the upgrade wall, when the status fetch failed", () => {
    premium.value = {
      isPremium: false,
      isPremiumResolved: false,
      isPremiumStatusError: true,
    };
    renderComponent(<ReceiptCaptureScreen />);

    expect(mockUpgradeModal).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Take photo of receipt")).toBeNull();
    expect(screen.getByText("Couldn't check your plan")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(mockRefreshSubscription).toHaveBeenCalledTimes(1);
  });

  it("shows neither the wall nor the camera while the status is loading", () => {
    premium.value = {
      isPremium: false,
      isPremiumResolved: false,
      isPremiumStatusError: false,
    };
    renderComponent(<ReceiptCaptureScreen />);

    expect(mockUpgradeModal).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Take photo of receipt")).toBeNull();
    expect(screen.queryByText("Couldn't check your plan")).toBeNull();
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
