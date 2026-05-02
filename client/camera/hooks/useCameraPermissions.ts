import { useCallback, useRef, useState } from "react";
import { useCameraPermission } from "react-native-vision-camera";
import type { CameraPermissionResult } from "../types";

export interface UseCameraPermissionsReturn {
  permission: CameraPermissionResult | null;
  isLoading: boolean;
  requestPermission: () => Promise<CameraPermissionResult>;
}

/**
 * Camera permissions hook wrapping V5's useCameraPermission.
 * Synthesizes a richer status shape (including canAskAgain) from V5's
 * simpler boolean API.
 */
export function useCameraPermissions(): UseCameraPermissionsReturn {
  const { hasPermission, requestPermission: v5Request } = useCameraPermission();

  // Tracks whether we've already made a permission request this session.
  // Used to distinguish "never asked" (undetermined) from "asked and denied".
  const hasRequestedRef = useRef(false);

  // Permission derivation: synchronous from V5 hook — no isLoading needed,
  // but we expose it as false for API compatibility with screen consumers.
  const permission = useCallback((): CameraPermissionResult => {
    if (hasPermission) {
      return { status: "granted", canAskAgain: false };
    }
    if (hasRequestedRef.current) {
      return { status: "denied", canAskAgain: false };
    }
    return { status: "undetermined", canAskAgain: true };
  }, [hasPermission]);

  const requestPermission =
    useCallback(async (): Promise<CameraPermissionResult> => {
      hasRequestedRef.current = true;
      const granted = await v5Request();
      if (granted) {
        return { status: "granted", canAskAgain: false };
      }
      return { status: "denied", canAskAgain: false };
    }, [v5Request]);

  return {
    permission: permission(),
    isLoading: false,
    requestPermission,
  };
}
