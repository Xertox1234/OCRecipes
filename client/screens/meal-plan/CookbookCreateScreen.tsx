import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  type TextInput as RNTextInput,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { NotificationFeedbackType } from "expo-haptics";

import { TextInput } from "@/components/TextInput";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { FieldCounter } from "@/components/FieldCounter";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { UpgradeModal } from "@/components/UpgradeModal";
import { CookbookCoverPlate } from "@/components/cookbook/CookbookCoverPlate";
import { CoverActionButton } from "@/components/cookbook/CoverActionButton";
import {
  coverGenerateActionLabel,
  coverPhotoActionLabel,
  resolveCoverWidth,
} from "@/components/cookbook/cookbook-cover-utils";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { focusFirstInvalid } from "@/lib/field-validation";
import { useToast } from "@/context/ToastContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { ApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  useCookbookDetail,
  useUpdateCookbook,
  useUploadCookbookCover,
  useGenerateCookbookCover,
} from "@/hooks/useCookbooks";
import { Spacing } from "@/constants/theme";
import type { CookbookCreateScreenNavigationProp } from "@/types/navigation";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import { useFromHomeBackRedirect } from "@/hooks/useFromHomeBackRedirect";
import { useHeaderCloseButton } from "@/hooks/useHeaderCloseButton";
import CookbookCreateWizard from "./CookbookCreateWizard";

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const SCREEN_PADDING = Spacing.lg;
/** Long enough for the cover's success pop to land before the screen closes. */
const SUCCESS_SETTLE_MS = 450;

/**
 * The CookbookCreate route: a new cookbook is made step by step in the
 * wizard; an existing one is edited in the single-page form.
 */
export default function CookbookCreateScreen() {
  const route = useRoute<RouteProp<MealPlanStackParamList, "CookbookCreate">>();
  return route.params?.cookbookId ? (
    <CookbookEditForm />
  ) : (
    <CookbookCreateWizard />
  );
}

function CookbookEditForm() {
  const navigation = useNavigation<CookbookCreateScreenNavigationProp>();
  const route = useRoute<RouteProp<MealPlanStackParamList, "CookbookCreate">>();
  // Only rendered with an id — see the switch above.
  const cookbookId = route.params?.cookbookId ?? 0;
  const fromHome = route.params?.fromHome;
  useFromHomeBackRedirect(navigation, fromHome);

  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const toast = useToast();
  const canGenerateCover = usePremiumFeature("cookbookCoverGeneration");

  const updateMutation = useUpdateCookbook();
  const uploadCoverMutation = useUploadCookbookCover();
  const generateCoverMutation = useGenerateCookbookCover();
  const {
    data: existingCookbook,
    isError: loadError,
    isLoading: loadingExisting,
    refetch: refetchExisting,
  } = useCookbookDetail(cookbookId);

  // The form is pre-populated from the fetched cookbook. If that fetch failed
  // (or hasn't resolved), the form is empty — submitting would overwrite the
  // cookbook with blank values, so block submit until it loads.
  const editLoadBlocked = loadError || !existingCookbook;

  // Save stays pressable with an empty name; pressing it names the field
  // (form-fields spec §5.1).
  const nameField = useFieldValidation((value) =>
    value.trim() === "" ? "Enter a name for your cookbook." : null,
  );
  // Destructured, never read as `nameField.ref` in render: React Compiler
  // treats an object read through `.ref` as a ref and skips the component.
  const { ref: nameRef } = nameField;
  const name = nameField.value;
  const setName = nameField.setValue;
  const descriptionRef = useRef<RNTextInput>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  // Focus is tracked by field IDENTITY, not a shared boolean. Moving from
  // Name to Description fires Name's onBlur and Description's onFocus as two
  // native events that aren't guaranteed to land in the same React commit —
  // with one boolean, the intermediate render reads "nothing focused" and the
  // plate starts a 300ms grow back to full size that is immediately reversed,
  // producing a visible wobble during the exact interaction this screen is
  // built around. A Set is order-independent, so the transient state is
  // "both focused" rather than "neither".
  const [focusedFields, setFocusedFields] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const anyFieldFocused = focusedFields.size > 0;

  const handleFieldFocus = useCallback((field: string) => {
    setFocusedFields((prev) => new Set(prev).add(field));
  }, []);
  const handleFieldBlur = useCallback((field: string) => {
    setFocusedFields((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }, []);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // A picked photo shows on the plate while it uploads.
  const [pendingCoverUri, setPendingCoverUri] = useState<string | null>(null);
  // Which cover step is running, if any. A discriminated kind rather than the
  // label alone: the buttons key their spinners off `kind`, so re-wording the
  // copy can't silently detach them.
  const [coverBusy, setCoverBusy] = useState<{
    kind: "upload" | "generate";
    label: string;
  } | null>(null);
  // Bumped once the save lands: the cover plays its success pop, and the form
  // stays locked through the short settle before the screen closes.
  const [celebrateKey, setCelebrateKey] = useState(0);
  const saved = celebrateKey > 0;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Pre-populate the form once the cookbook loads.
  useEffect(() => {
    if (existingCookbook && !initialized) {
      setName(existingCookbook.name);
      setDescription(existingCookbook.description || "");
      setInitialized(true);
    }
  }, [existingCookbook, initialized, setName]);

  const trimmedName = name.trim();
  // The name is not in here: an empty name is a press that says what's
  // missing, not a disabled button.
  const canSubmit =
    !updateMutation.isPending &&
    !editLoadBlocked &&
    // An in-flight cover step owns the screen — submitting under it would
    // race a second mutation against the same cookbook.
    coverBusy === null &&
    !saved;
  // Fields stop taking edits while a save is running or has landed — an edit
  // typed then would be silently dropped.
  const formLocked = updateMutation.isPending || coverBusy !== null || saved;

  const storedCoverUrl = existingCookbook?.coverImageUrl ?? null;
  const hasCover = !!(pendingCoverUri ?? storedCoverUrl);

  // Close control + `dismiss` that removes this route — see the hook for why
  // `canGoBack()` and a plain `goBack()` both get the one-route case wrong.
  const dismiss = useHeaderCloseButton(
    navigation,
    fromHome,
    "Close without saving",
  );

  /**
   * User-safe copy for a cover step. Never surfaces `err.message` — that is
   * the raw server body. `RATE_LIMITED` gets its own line because "try again"
   * is actively wrong advice when the limiter is the thing rejecting you.
   */
  const describeCoverError = useCallback(
    (err: unknown, step: "upload" | "generate"): string => {
      if (err instanceof ApiError && err.code === ErrorCode.RATE_LIMITED) {
        return "Too many requests. Please wait a moment and try again.";
      }
      return step === "upload"
        ? "Couldn't upload that photo. Please try again."
        : "Couldn't generate a cover right now. Please try again.";
    },
    [],
  );

  const handlePickPhoto = useCallback(async () => {
    haptics.selection();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;

      const uri = result.assets[0].uri;

      setPendingCoverUri(uri);
      setCoverBusy({ kind: "upload", label: "Uploading…" });
      try {
        await uploadCoverMutation.mutateAsync({ cookbookId, uri });
        haptics.notification(NotificationFeedbackType.Success);
        AccessibilityInfo.announceForAccessibility("Cover photo updated");
      } catch (err) {
        logger.error("Cookbook cover upload failed:", err);
        setPendingCoverUri(null);
        toast.error(describeCoverError(err, "upload"));
      } finally {
        setCoverBusy(null);
      }
    } catch (err) {
      logger.error("Cookbook cover picker failed:", err);
      toast.error("Couldn't open your photo library.");
    }
  }, [haptics, cookbookId, uploadCoverMutation, toast, describeCoverError]);

  const handleGenerateCover = useCallback(async () => {
    if (!canGenerateCover) {
      haptics.selection();
      setShowUpgradeModal(true);
      return;
    }
    haptics.selection();

    setCoverBusy({ kind: "generate", label: "Generating…" });
    try {
      await generateCoverMutation.mutateAsync(cookbookId);
      setPendingCoverUri(null);
      haptics.notification(NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Cover generated");
    } catch (err) {
      logger.error("Cookbook cover generation failed:", err);
      // `canGenerateCover` above is a locally-cached entitlement flag. If it
      // has gone stale (a downgrade since the last fetch) the server is the
      // one that says no — surface the upgrade path the user can actually act
      // on rather than a generic "try again" for something that will never
      // succeed.
      if (err instanceof ApiError && err.code === ErrorCode.PREMIUM_REQUIRED) {
        haptics.notification(NotificationFeedbackType.Error);
        setShowUpgradeModal(true);
      } else {
        toast.error(describeCoverError(err, "generate"));
      }
    } finally {
      setCoverBusy(null);
    }
  }, [
    canGenerateCover,
    haptics,
    cookbookId,
    generateCoverMutation,
    toast,
    describeCoverError,
  ]);

  /**
   * Map a mutation failure to user-safe copy. Never surfaces `err.message` —
   * `apiRequest` throws `ApiError("<status>: <body>")`, so the message is the
   * raw server response.
   */
  const describeError = useCallback((err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.code === ErrorCode.VALIDATION_ERROR) {
        return "Please check the name and try again.";
      }
      if (err.code === ErrorCode.RATE_LIMITED) {
        return "Too many requests. Please wait a moment and try again.";
      }
    }
    return "Couldn't update this cookbook. Please try again.";
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!focusFirstInvalid([nameField])) {
      haptics.notification(NotificationFeedbackType.Error);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: cookbookId,
        name: trimmedName,
        description: description.trim() || null,
      });
      haptics.notification(NotificationFeedbackType.Success);
      // The toast is this branch's one announcer (iOS announce + Android
      // live region); its own haptic is off — the line above already fired.
      toast.success("Changes saved", { haptic: false });
      setCelebrateKey((k) => k + 1);
      if (reducedMotion) dismiss();
      else closeTimer.current = setTimeout(dismiss, SUCCESS_SETTLE_MS);
    } catch (err) {
      haptics.notification(NotificationFeedbackType.Error);
      setError(describeError(err));
      // InlineError announces the message itself — announcing here too
      // would say it twice on iOS.
    }
  }, [
    nameField,
    trimmedName,
    description,
    cookbookId,
    haptics,
    toast,
    updateMutation,
    describeError,
    dismiss,
    reducedMotion,
  ]);

  // The plate shrinks while a field is focused so it stays visible above the
  // keyboard — you watch the title land on the cover as you type.
  const coverWidth = resolveCoverWidth(
    screenWidth,
    anyFieldFocused,
    SCREEN_PADDING,
  );

  const isCoverBusy = coverBusy !== null;

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Scrolls the focused field clear of the keyboard: with a plain
          ScrollView the description field sat under it while you typed. */}
      <KeyboardAwareScrollViewCompat
        style={styles.container}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingHorizontal: SCREEN_PADDING,
          paddingBottom: tabBarHeight + Spacing.xl,
          gap: Spacing.lg,
        }}
        keyboardDismissMode="on-drag"
        bottomOffset={Spacing.lg}
      >
        <CookbookCoverPlate
          name={name}
          description={description}
          coverImageUrl={storedCoverUrl}
          previewUri={pendingCoverUri}
          width={coverWidth}
          busy={isCoverBusy}
          busyLabel={coverBusy?.label}
          onPress={() => void handlePickPhoto()}
          // Same guards as the "Add photo" button it stands in for.
          disabled={formLocked || editLoadBlocked}
          celebrateKey={celebrateKey}
        />

        <View style={styles.coverActions}>
          <CoverActionButton
            icon="image"
            label={hasCover ? "Replace photo" : "Add photo"}
            onPress={() => void handlePickPhoto()}
            accessibilityLabel={coverPhotoActionLabel(hasCover)}
            accessibilityHint="Choose a cover image from your photo library"
            loading={coverBusy?.kind === "upload"}
            // `editLoadBlocked` gates these for the same reason it gates
            // submit: with the fetch failed, `storedCoverUrl` is null, so
            // `hasCover` is false and this button would read "Add photo" for
            // a cookbook that HAS one. The server does its own lookup, finds
            // the real cover, and deletes it — silent data loss behind a
            // label that promises the opposite.
            disabled={formLocked || editLoadBlocked}
          />
          <CoverActionButton
            icon="feather"
            label="Generate cover"
            onPress={() => void handleGenerateCover()}
            accessibilityLabel={coverGenerateActionLabel(
              hasCover,
              canGenerateCover,
            )}
            accessibilityHint={
              canGenerateCover
                ? "Create cover art from this cookbook's name and description"
                : "Upgrade to generate cover art"
            }
            locked={!canGenerateCover}
            loading={coverBusy?.kind === "generate"}
            // Same guard as the photo button above — generating also replaces
            // (and deletes) the existing cover we currently can't see.
            disabled={formLocked || editLoadBlocked}
          />
        </View>

        <View>
          <TextInput
            label="Name"
            ref={nameRef}
            value={name}
            onChangeText={(text) =>
              nameField.onChangeText(text.slice(0, NAME_MAX))
            }
            onFocus={() => {
              handleFieldFocus("name");
              nameField.onFocus();
            }}
            onBlur={() => {
              handleFieldBlur("name");
              nameField.onBlur();
            }}
            maxLength={NAME_MAX}
            editable={!formLocked}
            error={!!nameField.error}
            returnKeyType="next"
            // Keep the keyboard up while focus moves on (spec §5.6).
            submitBehavior="submit"
            onSubmitEditing={() => descriptionRef.current?.focus()}
            // Deliberately NOT autofocused: the cover is the first thing this
            // screen has to say, and opening with the keyboard up buries it.
          />
          <FieldCounter
            length={name.length}
            max={NAME_MAX}
            visible={focusedFields.has("name")}
            style={styles.charCount}
          />
          <InlineError
            message={nameField.error}
            shakeKey={nameField.shakeKey}
          />

          <TextInput
            ref={descriptionRef}
            label="Description (optional)"
            value={description}
            onChangeText={(text) =>
              setDescription(text.slice(0, DESCRIPTION_MAX))
            }
            onFocus={() => handleFieldFocus("description")}
            onBlur={() => handleFieldBlur("description")}
            maxLength={DESCRIPTION_MAX}
            editable={!formLocked}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={styles.multilineInput}
            containerStyle={{ marginTop: Spacing.md }}
          />
          <FieldCounter
            length={description.length}
            max={DESCRIPTION_MAX}
            visible={focusedFields.has("description")}
            style={styles.charCount}
          />
        </View>

        <InlineError message={error} />

        {loadError && !loadingExisting ? (
          <View style={styles.loadErrorRow}>
            <InlineError message="Couldn't load this cookbook to edit. Saving is disabled until it loads." />
            <Button
              variant="outline"
              onPress={() => {
                void refetchExisting();
              }}
              accessibilityLabel="Retry loading cookbook"
              style={styles.retryButton}
            >
              Try Again
            </Button>
          </View>
        ) : null}

        <Button
          onPress={() => void handleSubmit()}
          disabled={!canSubmit}
          loading={updateMutation.isPending || isCoverBusy}
          loadingText="Saving…"
          accessibilityLabel="Save changes"
        >
          Save Changes
        </Button>
      </KeyboardAwareScrollViewCompat>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  coverActions: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  multilineInput: {
    minHeight: 92,
  },
  charCount: {
    marginTop: Spacing.xs,
  },
  loadErrorRow: {
    gap: Spacing.sm,
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.lg,
  },
});
