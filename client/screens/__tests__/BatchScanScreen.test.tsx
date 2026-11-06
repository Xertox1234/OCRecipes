// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, Platform } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import BatchScanScreen from "../BatchScanScreen";

const VALID_BARCODE = "1234567890123";

const {
  mockImpact,
  mockNotification,
  mockNavigate,
  mockReplace,
  mockAddItemAndLookup,
  mockIncrementQuantity,
  onBarcodeScannedRef,
  batchScanState,
} = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockNavigate: vi.fn(),
  mockReplace: vi.fn(),
  mockAddItemAndLookup: vi.fn(),
  mockIncrementQuantity: vi.fn(),
  onBarcodeScannedRef: {
    current: null as
      | ((result: { data: string }, isRepeat?: boolean) => void)
      | null,
  },
  batchScanState: { itemCount: 1 },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    addListener: () => () => {},
  }),
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
  CameraView: () => null,
  useCameraPermissions: () => ({
    permission: { status: "granted", canAskAgain: false },
    requestPermission: vi.fn(),
  }),
  useCamera: (opts: {
    onBarcodeScanned: (result: { data: string }, isRepeat?: boolean) => void;
  }) => {
    onBarcodeScannedRef.current = opts.onBarcodeScanned;
    return {
      cameraRef: { current: null },
      handleBarcodeScanned: vi.fn(),
      resetScanning: vi.fn(),
    };
  },
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: vi.fn(),
    ConfirmationModal: () => null,
  }),
}));

vi.mock("@/context/BatchScanContext", () => ({
  useBatchScan: () => ({
    itemCount: batchScanState.itemCount,
    startSession: vi.fn(),
    addItemAndLookup: mockAddItemAndLookup,
    incrementQuantity: mockIncrementQuantity,
    clearSession: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumCamera: () => ({ availableBarcodeTypes: ["ean13"] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  batchScanState.itemCount = 1;
});

describe("BatchScanScreen — haptic rhythm", () => {
  it("fires a light tick (not a full Success) for a new item scan", () => {
    renderComponent(<BatchScanScreen />);

    act(() => {
      onBarcodeScannedRef.current?.({ data: VALID_BARCODE }, false);
    });

    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("fires a light tick (not a full Success) for a repeat scan", () => {
    renderComponent(<BatchScanScreen />);

    act(() => {
      onBarcodeScannedRef.current?.({ data: VALID_BARCODE }, true);
    });

    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("fires a single Success notification when Done is pressed", () => {
    batchScanState.itemCount = 1;
    renderComponent(<BatchScanScreen />);

    fireEvent.click(screen.getByLabelText("Done, review 1 scanned item"));

    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(mockNotification).toHaveBeenCalledOnce();
    expect(mockReplace).toHaveBeenCalledWith("BatchSummary");
  });
});

// Accessibility audit 2026-11-06 M5: the item-count badge has a polite live
// region (Android-only) whose label changes with the count, so the imperative
// count announce must be iOS-only or TalkBack speaks the count twice.
describe("BatchScanScreen — scan count announcement", () => {
  const originalOS = Platform.OS;
  let announce: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announce.mockRestore();
    Platform.OS = originalOS;
  });

  it("announces the first scanned item on iOS", () => {
    Platform.OS = "ios";
    renderComponent(<BatchScanScreen />);
    act(() => {
      onBarcodeScannedRef.current?.({ data: VALID_BARCODE }, false);
    });
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining("First item scanned"),
    );
  });

  it("leaves the count to the badge's live region on Android", () => {
    Platform.OS = "android";
    renderComponent(<BatchScanScreen />);
    act(() => {
      onBarcodeScannedRef.current?.({ data: VALID_BARCODE }, false);
    });
    expect(announce).not.toHaveBeenCalledWith(expect.stringContaining("item"));
  });

  it("still announces a repeat scan on Android — the count does not change", () => {
    Platform.OS = "android";
    renderComponent(<BatchScanScreen />);
    act(() => {
      onBarcodeScannedRef.current?.({ data: VALID_BARCODE }, true);
    });
    expect(announce).toHaveBeenCalledWith(
      "Item already scanned. Quantity increased.",
    );
  });
});
