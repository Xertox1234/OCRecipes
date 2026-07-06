// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import { ImportRecipeSheetContent } from "../ImportRecipeSheet";

const mockRequestCameraPermissionsAsync = vi.fn();
const mockRequestMediaLibraryPermissionsAsync = vi.fn();
const mockGetCameraPermissionsAsync = vi.fn();
const mockGetMediaLibraryPermissionsAsync = vi.fn();
const mockLaunchCameraAsync = vi.fn();
const mockLaunchImageLibraryAsync = vi.fn();

vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: (...args: unknown[]) =>
    mockRequestCameraPermissionsAsync(...args),
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestMediaLibraryPermissionsAsync(...args),
  getCameraPermissionsAsync: (...args: unknown[]) =>
    mockGetCameraPermissionsAsync(...args),
  getMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockGetMediaLibraryPermissionsAsync(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCameraAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibraryAsync(...args),
}));

// Unused by these tests, but ImportRecipeSheet.tsx imports these two native
// modules for the clipboard-import row — leaving them unmocked pulls in
// expo-modules-core's EventEmitter, which throws under jsdom.
vi.mock("expo-clipboard", () => ({
  hasImageAsync: vi.fn().mockResolvedValue(false),
  getImageAsync: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: vi.fn(),
  EncodingType: { Base64: "base64" },
}));

const mockHapticsNotification = vi.fn();
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: mockHapticsNotification,
  }),
}));

let mockCanImportPhoto = true;
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => mockCanImportPhoto,
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? "UPGRADE_MODAL_SHOWN" : null,
}));

describe("ImportRecipeSheet permission-denied handling", () => {
  const defaultProps = {
    mealType: "lunch" as const,
    plannedDate: "2025-06-01",
    onDismiss: vi.fn(),
    onNavigateUrlImport: vi.fn(),
    onPhotoImport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanImportPhoto = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("imports the photo when camera permission is granted", async () => {
    mockRequestCameraPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockLaunchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://photo.jpg" }],
    });

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Camera"));

    await waitFor(() => {
      expect(defaultProps.onPhotoImport).toHaveBeenCalledWith(
        "file://photo.jpg",
        "lunch",
        "2025-06-01",
      );
    });
    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1);
    expect(RN.Alert.alert).not.toHaveBeenCalled();
  });

  it("shows a friendly alert and does not launch the camera when permission is denied", async () => {
    mockRequestCameraPermissionsAsync.mockResolvedValue({ status: "denied" });

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Camera"));

    await waitFor(() => {
      expect(RN.Alert.alert).toHaveBeenCalledWith(
        "Camera Access",
        expect.stringContaining("Settings"),
        expect.any(Array),
      );
    });
    expect(mockLaunchCameraAsync).not.toHaveBeenCalled();
    expect(defaultProps.onPhotoImport).not.toHaveBeenCalled();
    expect(defaultProps.onDismiss).not.toHaveBeenCalled();
    expect(mockHapticsNotification).toHaveBeenCalledWith("warning");
  });

  it("the alert's Open Settings action opens the OS settings", async () => {
    mockRequestCameraPermissionsAsync.mockResolvedValue({ status: "denied" });
    const openSettingsSpy = vi
      .spyOn(RN.Linking, "openSettings")
      .mockResolvedValue(undefined);

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Camera"));

    await waitFor(() => expect(RN.Alert.alert).toHaveBeenCalled());

    const buttons = (RN.Alert.alert as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as { text: string; onPress?: () => void }[];
    const settingsButton = buttons.find((b) => b.text === "Open Settings");
    expect(settingsButton).toBeDefined();
    settingsButton?.onPress?.();

    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });

  it("shows the friendly alert (not an unhandled rejection) when the Android launcher rejects on denial", async () => {
    mockRequestCameraPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockLaunchCameraAsync.mockRejectedValue(
      new Error("Camera permission denied"),
    );
    // Recheck confirms the permission is (now) actually denied.
    mockGetCameraPermissionsAsync.mockResolvedValue({ status: "denied" });

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Camera"));

    await waitFor(() => {
      expect(RN.Alert.alert).toHaveBeenCalledWith(
        "Camera Access",
        expect.stringContaining("Settings"),
        expect.any(Array),
      );
    });
    expect(defaultProps.onPhotoImport).not.toHaveBeenCalled();
  });

  it("does not show the misleading Settings alert when the launcher rejects for an unrelated reason", async () => {
    mockRequestCameraPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockLaunchCameraAsync.mockRejectedValue(new Error("Camera busy"));
    // Recheck shows permission is still granted — the rejection wasn't a
    // permission problem, so no alert should be shown (would mislabel it).
    mockGetCameraPermissionsAsync.mockResolvedValue({ status: "granted" });

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Camera"));

    await waitFor(() => {
      expect(mockGetCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    });
    expect(RN.Alert.alert).not.toHaveBeenCalled();
    expect(defaultProps.onPhotoImport).not.toHaveBeenCalled();
  });

  it("does not throw an unhandled rejection when the recheck itself also rejects", async () => {
    mockRequestCameraPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockLaunchCameraAsync.mockRejectedValue(new Error("Camera busy"));
    mockGetCameraPermissionsAsync.mockRejectedValue(
      new Error("native module unavailable"),
    );

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Camera"));

    await waitFor(() => {
      expect(mockGetCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    });
    expect(RN.Alert.alert).not.toHaveBeenCalled();
    expect(defaultProps.onPhotoImport).not.toHaveBeenCalled();
  });

  it("imports the photo when gallery permission is granted", async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({
      status: "granted",
    });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://gallery.jpg" }],
    });

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Gallery"));

    await waitFor(() => {
      expect(defaultProps.onPhotoImport).toHaveBeenCalledWith(
        "file://gallery.jpg",
        "lunch",
        "2025-06-01",
      );
    });
    expect(RN.Alert.alert).not.toHaveBeenCalled();
  });

  it("shows a friendly alert and does not launch the picker when gallery permission is denied", async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({
      status: "denied",
    });

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Gallery"));

    await waitFor(() => {
      expect(RN.Alert.alert).toHaveBeenCalledWith(
        "Photo Library Access",
        expect.stringContaining("Settings"),
        expect.any(Array),
      );
    });
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
    expect(defaultProps.onPhotoImport).not.toHaveBeenCalled();
  });

  it("shows the friendly alert when the gallery launcher rejects on denial", async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({
      status: "granted",
    });
    mockLaunchImageLibraryAsync.mockRejectedValue(
      new Error("Media library permission denied"),
    );
    mockGetMediaLibraryPermissionsAsync.mockResolvedValue({
      status: "denied",
    });

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Gallery"));

    await waitFor(() => {
      expect(RN.Alert.alert).toHaveBeenCalledWith(
        "Photo Library Access",
        expect.stringContaining("Settings"),
        expect.any(Array),
      );
    });
    expect(defaultProps.onPhotoImport).not.toHaveBeenCalled();
  });

  it("does not show the misleading Settings alert when the gallery launcher rejects for an unrelated reason", async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({
      status: "granted",
    });
    mockLaunchImageLibraryAsync.mockRejectedValue(new Error("Disk full"));
    mockGetMediaLibraryPermissionsAsync.mockResolvedValue({
      status: "granted",
    });

    renderComponent(<ImportRecipeSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("From Gallery"));

    await waitFor(() => {
      expect(mockGetMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
    });
    expect(RN.Alert.alert).not.toHaveBeenCalled();
    expect(defaultProps.onPhotoImport).not.toHaveBeenCalled();
  });
});
