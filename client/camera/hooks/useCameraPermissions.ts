import { useCallback, useMemo } from "react";
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
 * boolean API.
 *
 * `canRequestPermission` reflects the persisted OS permission state
 * (it is true only while the OS reports 'not-determined'), so a
 * prior-session denial correctly derives as "denied" on first render —
 * no in-memory request tracking needed. V5 re-fetches the status on
 * AppState 'active', so returning from Settings updates this hook
 * automatically.
 */
export function useCameraPermissions(): UseCameraPermissionsReturn {
  const {
    hasPermission,
    canRequestPermission,
    requestPermission: v5Request,
  } = useCameraPermission();

  // useMemo (not a function invoked at return) so the permission object
  // keeps a stable identity across renders unless the OS state changes —
  // consumers depend on it in useEffect deps.
  const permission = useMemo((): CameraPermissionResult => {
    if (hasPermission) {
      return { status: "granted", canAskAgain: false };
    }
    if (canRequestPermission) {
      return { status: "undetermined", canAskAgain: true };
    }
    // Covers both OS 'denied' and 'restricted' (e.g. parental controls):
    // in either case a request is a no-op and the Settings deep-link is
    // the right consumer affordance.
    return { status: "denied", canAskAgain: false };
  }, [hasPermission, canRequestPermission]);

  // Note: the denied resolve value is iOS-accurate. On an Android soft
  // denial (no "don't ask again") the OS state returns to 'not-determined',
  // so the hook's next-render `permission` reads undetermined/canAskAgain —
  // consumers should keep reading `permission`, not this resolved value.
  const requestPermission =
    useCallback(async (): Promise<CameraPermissionResult> => {
      const granted = await v5Request();
      if (granted) {
        return { status: "granted", canAskAgain: false };
      }
      return { status: "denied", canAskAgain: false };
    }, [v5Request]);

  return {
    permission,
    isLoading: false,
    requestPermission,
  };
}
