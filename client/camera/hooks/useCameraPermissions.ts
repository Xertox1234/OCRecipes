import { useCallback, useEffect, useState } from "react";
import { Camera } from "react-native-vision-camera";
import type { CameraPermissionResult } from "../types";

export interface UseCameraPermissionsReturn {
  permission: CameraPermissionResult | null;
  isLoading: boolean;
  requestPermission: () => Promise<CameraPermissionResult>;
}

/**
 * Camera permissions hook using react-native-vision-camera.
 */
export function useCameraPermissions(): UseCameraPermissionsReturn {
  const [permission, setPermission] = useState<CameraPermissionResult | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);

  const mapPermission = useCallback(
    (
      status: "granted" | "denied" | "not-determined" | "restricted",
    ): CameraPermissionResult => {
      let mappedStatus: CameraPermissionResult["status"];
      switch (status) {
        case "granted":
          mappedStatus = "granted";
          break;
        case "denied":
          mappedStatus = "denied";
          break;
        case "restricted":
          mappedStatus = "restricted";
          break;
        default:
          mappedStatus = "undetermined";
      }

      return {
        status: mappedStatus,
        // Vision Camera doesn't expose canAskAgain directly,
        // but we can request again if not granted
        canAskAgain:
          mappedStatus === "undetermined" || mappedStatus === "denied",
      };
    },
    [],
  );

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const status = await Camera.getCameraPermissionStatus();
        setPermission(mapPermission(status));
      } catch {
        // Permission check failed - default to undetermined to allow retry
        setPermission({ status: "undetermined", canAskAgain: true });
      } finally {
        setIsLoading(false);
      }
    };

    checkPermission();
  }, [mapPermission]);

  const requestPermission =
    useCallback(async (): Promise<CameraPermissionResult> => {
      try {
        const status = await Camera.requestCameraPermission();
        const result = mapPermission(status);
        setPermission(result);
        return result;
      } catch {
        // Permission request failed - treat as denied
        return { status: "denied", canAskAgain: false };
      }
    }, [mapPermission]);

  return {
    permission,
    isLoading,
    requestPermission,
  };
}
