import { Alert, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

/**
 * Set while the Coach's camera is open on Android, holding when it opened.
 * Android can destroy the app while the camera is in front; the photo then
 * arrives only through `getPendingResultAsync` after the restart, and the
 * mark says the pending result is the Coach's (other screens use the camera
 * too). Coach chat audit 2026-11-24, L28.
 */
export const COACH_CAMERA_OPEN_KEY = "@ocrecipes/coach_camera_open";

/** An older mark is a camera the user walked away from, not a lost photo. */
const CAMERA_MARK_MAX_AGE_MS = 30 * 60 * 1000;

const marksCamera = (source: CoachPhotoSource) =>
  source === "camera" && Platform.OS === "android";

async function markCameraOpen(): Promise<void> {
  try {
    await AsyncStorage.setItem(COACH_CAMERA_OPEN_KEY, String(Date.now()));
  } catch {
    // Losing the mark only loses the recovery, never the photo in hand.
  }
}

function clearCameraMark(): void {
  AsyncStorage.removeItem(COACH_CAMERA_OPEN_KEY).catch(() => {});
}

/**
 * The photo of a Coach camera that Android closed the app on, or null.
 * Claims the mark first, so only one caller ever gets the photo. Never
 * sends anything: the caller asks the user (a send is a paid turn).
 */
export async function recoverCoachCameraPhoto(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  try {
    const mark = await AsyncStorage.getItem(COACH_CAMERA_OPEN_KEY);
    if (mark === null) return null;
    clearCameraMark();
    const openedAt = Number(mark);
    if (
      !Number.isFinite(openedAt) ||
      Date.now() - openedAt > CAMERA_MARK_MAX_AGE_MS
    ) {
      return null;
    }
    const pending = await ImagePicker.getPendingResultAsync();
    if (!pending || !("canceled" in pending) || pending.canceled) return null;
    return pending.assets[0]?.uri ?? null;
  } catch {
    return null;
  }
}

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
    if (marksCamera(source)) await markCameraOpen();
    try {
      result = await s.launch();
    } finally {
      if (marksCamera(source)) clearCameraMark();
    }
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
