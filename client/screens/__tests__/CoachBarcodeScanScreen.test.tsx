// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { settleCoachBarcode } from "@/lib/coach-barcode-scan";
import CoachBarcodeScanScreen from "../CoachBarcodeScanScreen";

const { mockGoBack, mockNotification, cameraProps, permissionState } =
  vi.hoisted(() => ({
    mockGoBack: vi.fn(),
    mockNotification: vi.fn(),
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
    impact: vi.fn(),
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

describe("CoachBarcodeScanScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cameraProps.current = null;
    permissionState.current = { status: "granted", canAskAgain: false };
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

  it("hands the code to the chat and closes on the first read", () => {
    renderComponent(<CoachBarcodeScanScreen />);
    read("4006381333931");
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith("4006381333931");
    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(mockNotification).toHaveBeenCalledOnce();
  });

  it("counts one read only, however many frames show the barcode", () => {
    renderComponent(<CoachBarcodeScanScreen />);
    read("4006381333931");
    read("4006381333931");
    read("012345678905");
    expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith("4006381333931");
    expect(mockGoBack).toHaveBeenCalledOnce();
  });

  it("stops the camera once it has a read", () => {
    renderComponent(<CoachBarcodeScanScreen />);
    read("4006381333931");
    expect(cameraProps.current?.isActive).toBe(false);
  });

  it("keeps looking past a code that is not a product barcode", () => {
    renderComponent(<CoachBarcodeScanScreen />);
    read("https://example.com/p/1");
    expect(settleCoachBarcode).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    read("4006381333931");
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
