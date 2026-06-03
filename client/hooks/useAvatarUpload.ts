import { useState, useCallback } from "react";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { useHaptics } from "@/hooks/useHaptics";
import { logger } from "@/lib/logger";
import { useToast } from "@/context/ToastContext";
import { useAuthContext } from "@/context/AuthContext";
import { compressImage, cleanupImage } from "@/lib/image-compression";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";

export function useAvatarUpload() {
  const haptics = useHaptics();
  const toast = useToast();
  const { checkAuth } = useAuthContext();
  const [isUploading, setIsUploading] = useState(false);

  const upload = useCallback(async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    setIsUploading(true);
    try {
      const token = await tokenStorage.get();
      if (!token) {
        throw new Error("Not authenticated");
      }

      const compressed = await compressImage(result.assets[0].uri, {
        maxWidth: 400,
        maxHeight: 400,
        quality: 0.8,
        targetSizeKB: 500,
      });

      try {
        const uploadResult = await uploadAsync(
          `${getApiUrl()}/api/user/avatar`,
          compressed.uri,
          {
            httpMethod: "POST",
            uploadType: FileSystemUploadType.MULTIPART,
            fieldName: "avatar",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (uploadResult.status !== 200) {
          let errorMessage = "Failed to upload avatar";
          try {
            const errorData = JSON.parse(uploadResult.body || "{}");
            if (errorData.error) errorMessage = errorData.error;
          } catch {
            // Malformed response body — use default message
          }
          throw new Error(errorMessage);
        }

        await checkAuth();
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      } finally {
        await cleanupImage(compressed.uri);
      }
    } catch (error) {
      logger.error("Avatar upload error:", error);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error("Failed to upload avatar. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }, [haptics, toast, checkAuth]);

  return { isUploading, upload };
}
