import { describe, it, expect, vi, beforeEach } from "vitest";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { pickCoachPhoto } from "../coach-photo-picker";

vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: vi.fn(),
  getCameraPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  getMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
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
