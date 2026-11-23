import { Alert, Linking } from "react-native";
import * as ImagePicker from "expo-image-picker";

export type CoachPhotoSource = "camera" | "library";

const SOURCES = {
  camera: {
    subject: "Camera",
    failure: "Couldn't open the camera. Please try again.",
    request: () => ImagePicker.requestCameraPermissionsAsync(),
    recheck: () => ImagePicker.getCameraPermissionsAsync(),
    launch: () =>
      ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 }),
  },
  library: {
    subject: "Photo Library",
    failure: "Couldn't open your photos. Please try again.",
    // The system photo picker needs no grant (as the app's other library
    // pickers assume); asking first would lock out a user who once said no.
    request: null,
    recheck: () => ImagePicker.getMediaLibraryPermissionsAsync(),
    launch: () =>
      ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      }),
  },
} as const;

/** A denied permission is a system decision: offer the way to Settings. */
function showPermissionDenied(subject: string): void {
  Alert.alert(
    `${subject} Access`,
    `Please enable ${subject.toLowerCase()} access in Settings to send a photo to the Coach.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings() },
    ],
  );
}

/**
 * Take or choose one photo for the Coach chat. Resolves with the photo's
 * local uri, or null when the user cancelled or it could not be opened (the
 * user has then been told: a Settings alert for a denied permission,
 * `onFailure` with static copy for anything else).
 */
export async function pickCoachPhoto(
  source: CoachPhotoSource,
  onFailure: (message: string) => void,
): Promise<string | null> {
  const s = SOURCES[source];
  let result: ImagePicker.ImagePickerResult;
  try {
    if (s.request) {
      const { status } = await s.request();
      if (status !== "granted") {
        showPermissionDenied(s.subject);
        return null;
      }
    }
    result = await s.launch();
  } catch {
    // Android rejects the launch (iOS no-ops) when the manifest permission
    // is denied. Re-check rather than assume, so an unrelated failure (no
    // camera hardware) is not mislabeled as a Settings problem; the re-check
    // is guarded too.
    try {
      const { status } = await s.recheck();
      if (status !== "granted") showPermissionDenied(s.subject);
      else onFailure(s.failure);
    } catch {
      onFailure(s.failure);
    }
    return null;
  }
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}
