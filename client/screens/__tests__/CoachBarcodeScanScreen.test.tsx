// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { MockInstance } from "vitest";
import { settleCoachBarcode } from "@/lib/coach-barcode-scan";
import CoachBarcodeScanScreen from "../CoachBarcodeScanScreen";
import {
  ARM_MS,
  LOST_MS,
  REVEAL_MS,
  SWEEP_MS,
} from "../coach-barcode-pacing-utils";
import { LOCK_THRESHOLD_FRAMES } from "@/camera/components/ScanReticle-utils";

const {
  mockGoBack,
  mockNotification,
  mockImpact,
  mockTakePicture,
  mockPreReadLabel,
  mockDelete,
  cameraProps,
  permissionState,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockNotification: vi.fn(),
  mockImpact: vi.fn(),
  mockTakePicture: vi.fn(),
  mockPreReadLabel: vi.fn(),
  mockDelete: vi.fn(() => Promise.resolve()),
  cameraProps: {
    current: null as {
      barcodeTypes: string[];
      isActive?: boolean;
      onBarcodeScanned?: (result: { data: string; type: string }) => void;
    } | null,
  },
  permissionState: {
    current: { status: "granted", canAskAgain: false },
    request: vi.fn(),
  },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useIsFocused: () => true,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/camera", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    CameraView: forwardRef(function CameraView(
      props: NonNullable<typeof cameraProps.current>,
      ref,
    ) {
      cameraProps.current = props;
      useImperativeHandle(ref, () => ({ takePicture: mockTakePicture }));
      return null;
    }),
    useCameraPermissions: () => ({
      permission: permissionState.current,
      requestPermission: permissionState.request,
    }),
  };
});

vi.mock("@/camera/utils/recognizeTextFromPhoto", () => ({
  recognizeTextFromPhoto: vi.fn(),
}));

vi.mock("@/lib/coach-label-pre-read", () => ({
  preReadLabel: mockPreReadLabel,
}));

vi.mock("expo-file-system/legacy", () => ({ deleteAsync: mockDelete }));

vi.mock("@/lib/coach-barcode-scan", async (orig) => {
  const actual = await orig<typeof import("@/lib/coach-barcode-scan")>();
  return { ...actual, settleCoachBarcode: vi.fn() };
});

const read = (data: string) =>
  act(() => cameraProps.current?.onBarcodeScanned?.({ data, type: "ean13" }));

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Open the scanner and let the viewfinder settle. */
function openArmed() {
  const utils = renderComponent(<CoachBarcodeScanScreen />);
  advance(ARM_MS);
  return utils;
}

const LABEL = {
  calories: 120,
  protein: 3,
  carbs: 16,
  fat: 5,
  servingSize: "1 cup (240 ml)",
};

/** Scan `code` and play the barcode step through to the label step. */
function toLabelStep(code: string) {
  openArmed();
  hold(code);
  advance(SWEEP_MS);
  advance(REVEAL_MS);
}

/** Tap the shutter and let the photo and the read settle. */
const shoot = () =>
  act(async () => {
    fireEvent.click(
      screen.getByLabelText("Take a photo of the nutrition label"),
    );
  });

/** Hold one code in view long enough to lock. */
function hold(code: string) {
  for (let i = 0; i < LOCK_THRESHOLD_FRAMES; i++) read(code);
}

let announce: MockInstance<typeof AccessibilityInfo.announceForAccessibility>;

describe("CoachBarcodeScanScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    cameraProps.current = null;
    permissionState.current = { status: "granted", canAskAgain: false };
  });

  afterEach(() => {
    vi.useRealTimers();
    announce.mockRestore();
  });

  it("looks for product barcodes only and says what to do", () => {
    renderComponent(<CoachBarcodeScanScreen />);
    expect(cameraProps.current?.barcodeTypes).toEqual([
      "ean13",
      "ean8",
      "upc_a",
      "upc_e",
    ]);
    expect(cameraProps.current?.isActive).toBe(true);
    expect(screen.getByText("Point the camera at a barcode")).toBeDefined();
  });

  it("does not read anything while the viewfinder settles", () => {
    renderComponent(<CoachBarcodeScanScreen />);
    hold("4006381333931");
    advance(SWEEP_MS);
    advance(REVEAL_MS);
    expect(settleCoachBarcode).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("asks the user to hold steady until the code locks", () => {
    openArmed();
    read("4006381333931");
    expect(screen.getByText("Hold steady…")).toBeDefined();
    expect(settleCoachBarcode).not.toHaveBeenCalled();
  });

  it("sweeps at the lock, shows the digits, then asks for the label", () => {
    openArmed();
    hold("4006381333931");
    expect(mockImpact).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledExactlyOnceWith("Barcode found");
    expect(screen.getByText("Reading the barcode…")).toBeDefined();
    expect(screen.getByTestId("barcode-viewfinder-sweep")).toBeDefined();
    expect(mockNotification).not.toHaveBeenCalled();

    advance(SWEEP_MS);
    expect(screen.getByText("Got it")).toBeDefined();
    expect(screen.getByText("4006381333931")).toBeDefined();
    // VoiceOver reads the digits one by one, not as one number.
    expect(
      screen.getByLabelText(
        "Step 1 of 2: barcode. Got it. 4 0 0 6 3 8 1 3 3 3 9 3 1",
      ),
    ).toBeDefined();
    expect(mockNotification).toHaveBeenCalledOnce();

    advance(REVEAL_MS);
    expect(screen.getByText("Now the nutrition label")).toBeDefined();
    expect(screen.getByText("Step 2 of 2: label")).toBeDefined();
    expect(
      screen.getByLabelText("Take a photo of the nutrition label"),
    ).toBeDefined();
    // Nothing is handed over until the label step is done.
    expect(settleCoachBarcode).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("reads the label photo on the phone and hands over both", async () => {
    mockTakePicture.mockResolvedValue({ uri: "file:///label.jpg" });
    mockPreReadLabel.mockResolvedValue(LABEL);
    toLabelStep("4006381333931");

    await shoot();
    expect(mockPreReadLabel).toHaveBeenCalledWith(
      "file:///label.jpg",
      expect.any(Function),
    );
    // The photo never leaves the phone, and is not kept.
    expect(mockDelete).toHaveBeenCalledWith("file:///label.jpg", {
      idempotent: true,
    });
    expect(screen.getByText("Reading the label…")).toBeDefined();
    expect(screen.getByTestId("barcode-viewfinder-sweep")).toBeDefined();
    expect(announce).toHaveBeenCalledWith("Reading the label");
    // The controls stay (so VoiceOver focus does) but do nothing mid-read.
    fireEvent.click(screen.getByLabelText("Skip the label"));
    expect(settleCoachBarcode).not.toHaveBeenCalled();

    advance(SWEEP_MS);
    expect(screen.getByText("Got the label")).toBeDefined();
    expect(
      screen.getByText(
        "Per serving: 120 cal · 3 g protein · 16 g carbs · 5 g fat",
      ),
    ).toBeDefined();
    // VoiceOver hears the numbers, in words.
    expect(announce).toHaveBeenCalledWith(
      "Label read. Per serving: 120 calories, 3 grams protein, 16 grams carbs, 5 grams fat.",
    );
    expect(settleCoachBarcode).not.toHaveBeenCalled();

    advance(REVEAL_MS);
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith({
      code: "4006381333931",
      label: LABEL,
    });
    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(cameraProps.current?.isActive).toBe(false);
  });

  it("offers a retake or a skip when the label can't be read", async () => {
    mockTakePicture.mockResolvedValue({ uri: "file:///label.jpg" });
    mockPreReadLabel.mockResolvedValue(null);
    toLabelStep("4006381333931");
    await shoot();
    advance(SWEEP_MS);
    expect(screen.getByText("I couldn't read that label")).toBeDefined();

    mockPreReadLabel.mockResolvedValue(LABEL);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Retake the label photo"));
    });
    advance(SWEEP_MS);
    advance(REVEAL_MS);
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith({
      code: "4006381333931",
      label: LABEL,
    });
  });

  it("treats a failed photo as an unreadable label", async () => {
    mockTakePicture.mockRejectedValue(new Error("camera busy"));
    toLabelStep("4006381333931");
    await shoot();
    advance(SWEEP_MS);
    expect(screen.getByText("I couldn't read that label")).toBeDefined();
    expect(mockPreReadLabel).not.toHaveBeenCalled();
  });

  it("sends the code alone when the label is skipped", () => {
    toLabelStep("4006381333931");
    fireEvent.click(screen.getByLabelText("Skip the label"));
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith({
      code: "4006381333931",
    });
    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(mockTakePicture).not.toHaveBeenCalled();
  });

  it("takes one photo however fast the shutter is tapped", async () => {
    mockTakePicture.mockResolvedValue({ uri: "file:///label.jpg" });
    mockPreReadLabel.mockResolvedValue(LABEL);
    toLabelStep("4006381333931");
    const shutter = screen.getByLabelText(
      "Take a photo of the nutrition label",
    );
    await act(async () => {
      fireEvent.click(shutter);
      fireEvent.click(shutter);
    });
    expect(mockTakePicture).toHaveBeenCalledOnce();
  });

  it("keeps the pauses but drops the sweeps with Reduce Motion", async () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    openArmed();
    hold("4006381333931");
    expect(screen.queryByTestId("barcode-viewfinder-sweep")).toBeNull();
    expect(screen.getByTestId("barcode-viewfinder-tint")).toBeDefined();
    advance(SWEEP_MS - 1);
    expect(mockNotification).not.toHaveBeenCalled();
    advance(1);
    expect(mockNotification).toHaveBeenCalledOnce();
    advance(REVEAL_MS);
    mockTakePicture.mockResolvedValue({ uri: "file:///label.jpg" });
    mockPreReadLabel.mockResolvedValue(LABEL);
    await shoot();
    expect(screen.queryByTestId("barcode-viewfinder-sweep")).toBeNull();
    advance(SWEEP_MS);
    advance(REVEAL_MS);
    expect(mockGoBack).toHaveBeenCalledOnce();
  });

  it("counts one read only, however many frames show the barcode", () => {
    toLabelStep("4006381333931");
    hold("012345678905");
    fireEvent.click(screen.getByLabelText("Skip the label"));
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith({
      code: "4006381333931",
    });
  });

  it("starts the hold over when the barcode leaves the frame", () => {
    openArmed();
    for (let i = 0; i < LOCK_THRESHOLD_FRAMES - 1; i++) read("4006381333931");
    advance(LOST_MS);
    expect(screen.getByText("Point the camera at a barcode")).toBeDefined();
    read("4006381333931");
    expect(settleCoachBarcode).not.toHaveBeenCalled();
  });

  it("keeps looking past a code that is not a product barcode", () => {
    openArmed();
    hold("https://example.com/p/1");
    expect(screen.queryByText("Reading the barcode…")).toBeNull();
    hold("4006381333931");
    expect(screen.getByText("Reading the barcode…")).toBeDefined();
  });

  it("closes without a code from the close button", () => {
    renderComponent(<CoachBarcodeScanScreen />);
    fireEvent.click(screen.getByLabelText("Close scanner"));
    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(settleCoachBarcode).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("tells the chat it closed, however it went away", () => {
    const { unmount } = renderComponent(<CoachBarcodeScanScreen />);
    unmount();
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("asks for the camera the first time", () => {
    permissionState.current = { status: "undetermined", canAskAgain: true };
    renderComponent(<CoachBarcodeScanScreen />);
    expect(permissionState.request).toHaveBeenCalledOnce();
    expect(cameraProps.current).toBeNull();
  });

  it("offers Settings and a way back when the camera was refused", () => {
    permissionState.current = { status: "denied", canAskAgain: false };
    renderComponent(<CoachBarcodeScanScreen />);
    expect(permissionState.request).not.toHaveBeenCalled();
    expect(cameraProps.current).toBeNull();
    expect(screen.getByLabelText("Open settings")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Go back"));
    expect(mockGoBack).toHaveBeenCalledOnce();
  });
});
