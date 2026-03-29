import React from "react";
import { StyleSheet, View, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, CameraColors } from "@/constants/theme";
import {
  getConfirmationMessage,
  getContentTypeLabel,
} from "@/screens/scan-screen-utils";
import type { ClassifyState } from "@/hooks/useScanClassification";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";
import type { ContentType } from "@shared/constants/classification";

interface ClassificationOverlayProps {
  classifyState: ClassifyState;
  classifyResult: PhotoAnalysisResponse | null;
  onConfirm: () => void;
  onDismiss: () => void;
  onRetake: () => void;
}

export const ClassificationOverlay = React.memo(function ClassificationOverlay({
  classifyState,
  classifyResult,
  onConfirm,
  onDismiss,
  onRetake,
}: ClassificationOverlayProps) {
  const { theme } = useTheme();

  if (classifyState === "idle") return null;

  return (
    <View style={styles.classificationOverlay} accessibilityViewIsModal={true}>
      {classifyState === "classifying" && (
        <View style={styles.classificationContent}>
          <ActivityIndicator
            size="large"
            color={CameraColors.text} // camera token
            accessibilityLabel="Analyzing your photo"
          />
          <ThemedText
            type="body"
            style={styles.classificationText}
            accessibilityLiveRegion="polite"
          >
            Analyzing your photo...
          </ThemedText>
        </View>
      )}

      {classifyState === "classified" && classifyResult?.contentType && (
        <View style={styles.classificationContent}>
          <Feather name="check-circle" size={48} color={theme.success} />
          <ThemedText
            type="h3"
            style={styles.classificationText}
            accessibilityLiveRegion="polite"
          >
            {getContentTypeLabel(classifyResult.contentType as ContentType)}
          </ThemedText>
        </View>
      )}

      {classifyState === "confirming" && classifyResult?.contentType && (
        <View style={styles.classificationContent}>
          <ThemedText type="body" style={styles.classificationText}>
            {getConfirmationMessage(classifyResult.contentType as ContentType)}
          </ThemedText>
          <View style={styles.confirmButtons}>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={`Yes, this is a ${getContentTypeLabel(classifyResult.contentType as ContentType).toLowerCase()}`}
              style={[styles.confirmButton, { backgroundColor: theme.success }]}
            >
              <ThemedText type="body" style={styles.confirmButtonText}>
                Yes
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Show other classification options"
              style={[
                styles.confirmButton,
                {
                  backgroundColor: "transparent",
                  borderWidth: 1,
                  borderColor: CameraColors.border, // camera token
                },
              ]}
            >
              <ThemedText type="body" style={styles.confirmButtonText}>
                Other options
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}

      {classifyState === "error" && (
        <View style={styles.classificationContent}>
          <Feather name="alert-circle" size={48} color={theme.error} />
          <ThemedText
            type="body"
            style={styles.classificationText}
            accessibilityRole="alert"
          >
            {"We couldn't identify food in this photo."}
          </ThemedText>
          <View style={styles.confirmButtons}>
            <Pressable
              onPress={onRetake}
              accessibilityRole="button"
              accessibilityLabel="Retake photo"
              style={[styles.confirmButton, { backgroundColor: theme.link }]}
            >
              <ThemedText type="body" style={styles.confirmButtonText}>
                Retake
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Choose food manually from search"
              style={[
                styles.confirmButton,
                {
                  backgroundColor: "transparent",
                  borderWidth: 1,
                  borderColor: CameraColors.border, // camera token
                },
              ]}
            >
              <ThemedText type="body" style={styles.confirmButtonText}>
                Choose manually
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  classificationOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CameraColors.overlayDark, // camera token
    justifyContent: "center",
    alignItems: "center",
  },
  classificationContent: {
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
    gap: Spacing.lg,
  },
  classificationText: {
    color: CameraColors.text, // camera token
    textAlign: "center",
    textShadowColor: CameraColors.textShadowLight, // camera token
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  confirmButton: {
    height: 48,
    minWidth: 120,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmButtonText: {
    color: CameraColors.text, // camera token
    fontWeight: "600",
  },
});
