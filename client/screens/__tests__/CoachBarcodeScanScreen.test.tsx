// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { useReducedMotion } from "react-native-reanimated";
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
  cameraProps,
  permissionState,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockNotification: vi.fn(),
  mockImpact: vi.fn(),
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

vi.mock("@/camera", () => ({
  CameraView: (props: NonNullable<typeof cameraProps.current>) => {
    cameraProps.current = props;
    return null;
  },
  useCameraPermissions: () => ({
    permission: permissionState.current,
    requestPermission: permissionState.request,
  }),
}));

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

/** Hold one code in view long enough to lock. */
function hold(code: string) {
  for (let i = 0; i < LOCK_THRESHOLD_FRAMES; i++) read(code);
}

describe("CoachBarcodeScanScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    cameraProps.current = null;
    permissionState.current = { status: "granted", canAskAgain: false };
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("hands the code over at the lock, then sweeps, shows it and closes", () => {
    openArmed();
    hold("4006381333931");
    // The lookup starts now, while the scan still plays.
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith("4006381333931");
    expect(mockImpact).toHaveBeenCalledOnce();
    expect(screen.getByText("Reading the barcode…")).toBeDefined();
    expect(screen.getByTestId("barcode-viewfinder-sweep")).toBeDefined();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNotification).not.toHaveBeenCalled();

    advance(SWEEP_MS);
    expect(screen.getByText("Got it")).toBeDefined();
    expect(screen.getByText("4006381333931")).toBeDefined();
    expect(mockNotification).toHaveBeenCalledOnce();
    expect(mockGoBack).not.toHaveBeenCalled();

    advance(REVEAL_MS);
    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(cameraProps.current?.isActive).toBe(false);
  });

  it("keeps the pause but drops the sweep with Reduce Motion", () => {
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
    expect(mockGoBack).toHaveBeenCalledOnce();
  });

  it("counts one read only, however many frames show the barcode", () => {
    openArmed();
    hold("4006381333931");
    hold("012345678905");
    advance(SWEEP_MS);
    advance(REVEAL_MS);
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith("4006381333931");
    expect(mockGoBack).toHaveBeenCalledOnce();
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
    expect(settleCoachBarcode).not.toHaveBeenCalled();
    hold("4006381333931");
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith("4006381333931");
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
