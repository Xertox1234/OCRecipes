import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as RN from "react-native";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  pickCoachPhoto,
  recoverCoachCameraPhoto,
  COACH_CAMERA_OPEN_KEY,
} from "../coach-photo-picker";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: vi.fn(),
  getCameraPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  getMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  getPendingResultAsync: vi.fn(),
}));

const granted = { status: "granted" } as Awaited<
  ReturnType<typeof ImagePicker.requestCameraPermissionsAsync>
>;
const denied = { ...granted, status: "denied" } as typeof granted;
const picked = {
  canceled: false,
  assets: [{ uri: "file:///meal.jpg" }],
} as ImagePicker.ImagePickerResult;

describe("pickCoachPhoto", () => {
  const onFailure = vi.fn();
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  it("returns the photo taken with the camera", async () => {
    vi.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(
      granted,
    );
    vi.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(picked);
    expect(await pickCoachPhoto("camera", onFailure)).toBe("file:///meal.jpg");
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it("returns the photo chosen from the library", async () => {
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(picked);
    expect(await pickCoachPhoto("library", onFailure)).toBe("file:///meal.jpg");
    // The system picker needs no grant; asking would lock out a past "no".
    expect(
      ImagePicker.requestMediaLibraryPermissionsAsync,
    ).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it("returns null when the user cancels", async () => {
    vi.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(
      granted,
    );
    vi.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
      canceled: true,
      assets: null,
    });
    expect(await pickCoachPhoto("camera", onFailure)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("offers Settings, and never opens the camera, when permission is denied", async () => {
    vi.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(
      denied,
    );
    expect(await pickCoachPhoto("camera", onFailure)).toBeNull();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Camera Access",
      expect.stringMatching(/Settings/),
      expect.any(Array),
    );
  });

  it("reports a launch failure that is not a permission problem", async () => {
    vi.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(
      granted,
    );
    vi.mocked(ImagePicker.launchCameraAsync).mockRejectedValue(
      new Error("no camera hardware"),
    );
    vi.mocked(ImagePicker.getCameraPermissionsAsync).mockResolvedValue(granted);
    expect(await pickCoachPhoto("camera", onFailure)).toBeNull();
    expect(onFailure).toHaveBeenCalledWith(
      "Couldn't open the camera. Please try again.",
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("offers Settings when the launch itself rejects for a denied permission (Android)", async () => {
    vi.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(
      granted,
    );
    vi.mocked(ImagePicker.launchCameraAsync).mockRejectedValue(new Error("x"));
    vi.mocked(ImagePicker.getCameraPermissionsAsync).mockResolvedValue(denied);
    expect(await pickCoachPhoto("camera", onFailure)).toBeNull();
    expect(alertSpy).toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe("the camera on Android (audit 2026-11-24, L28)", () => {
  const originalOS = RN.Platform.OS;
  const onFailure = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
    RN.Platform.OS = "android";
  });
  afterEach(() => {
    RN.Platform.OS = originalOS;
  });

  it("marks the camera open before launching it and clears the mark after", async () => {
    vi.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(
      granted,
    );
    vi.mocked(ImagePicker.launchCameraAsync).mockImplementation(async () => {
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        COACH_CAMERA_OPEN_KEY,
        expect.any(String),
      );
      expect(mockAsyncStorage.removeItem).not.toHaveBeenCalled();
      return picked;
    });
    expect(await pickCoachPhoto("camera", onFailure)).toBe("file:///meal.jpg");
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
      COACH_CAMERA_OPEN_KEY,
    );
  });

  it("never marks the library picker", async () => {
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(picked);
    await pickCoachPhoto("library", onFailure);
    expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("recovers the photo of a camera this picker opened, and claims the mark", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(String(Date.now() - 60_000));
    vi.mocked(ImagePicker.getPendingResultAsync).mockResolvedValue(picked);
    expect(await recoverCoachCameraPhoto()).toBe("file:///meal.jpg");
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
      COACH_CAMERA_OPEN_KEY,
    );
  });

  it("leaves another screen's camera result alone (no mark)", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    expect(await recoverCoachCameraPhoto()).toBeNull();
    expect(ImagePicker.getPendingResultAsync).not.toHaveBeenCalled();
  });

  it("ignores a stale mark", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(
      String(Date.now() - 2 * 60 * 60 * 1000),
    );
    vi.mocked(ImagePicker.getPendingResultAsync).mockResolvedValue(picked);
    expect(await recoverCoachCameraPhoto()).toBeNull();
    expect(mockAsyncStorage.removeItem).toHaveBeenCalled();
  });

  it.each([
    ["nothing pending", null],
    ["a cancelled camera", { canceled: true, assets: null }],
    ["a picker error", { code: "ERR", message: "boom" }],
  ])("returns null for %s", async (_label, pending) => {
    mockAsyncStorage.getItem.mockResolvedValue(String(Date.now()));
    vi.mocked(ImagePicker.getPendingResultAsync).mockResolvedValue(
      pending as Awaited<ReturnType<typeof ImagePicker.getPendingResultAsync>>,
    );
    expect(await recoverCoachCameraPhoto()).toBeNull();
  });

  it("returns null when storage fails", async () => {
    mockAsyncStorage.getItem.mockRejectedValue(new Error("disk"));
    expect(await recoverCoachCameraPhoto()).toBeNull();
  });

  it("does nothing off Android", async () => {
    RN.Platform.OS = "ios";
    expect(await recoverCoachCameraPhoto()).toBeNull();
    expect(mockAsyncStorage.getItem).not.toHaveBeenCalled();
  });
});
