import React, {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
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
import { useToast } from "@/context/ToastContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { ApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  useCreateCookbook,
  useCookbookDetail,
  useUpdateCookbook,
  useUploadCookbookCover,
  useGenerateCookbookCover,
} from "@/hooks/useCookbooks";
import { Spacing, FontFamily } from "@/constants/theme";
import type { CookbookCreateScreenNavigationProp } from "@/types/navigation";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import {
  useFromHomeBackRedirect,
  redirectToHomeTab,
} from "@/hooks/useFromHomeBackRedirect";

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const SCREEN_PADDING = Spacing.lg;

export default function CookbookCreateScreen() {
  const navigation = useNavigation<CookbookCreateScreenNavigationProp>();
  const route = useRoute<RouteProp<MealPlanStackParamList, "CookbookCreate">>();
  const cookbookId = route.params?.cookbookId;
  const fromHome = route.params?.fromHome;
  const isEditMode = !!cookbookId;
  useFromHomeBackRedirect(navigation, fromHome);

  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const canGenerateCover = usePremiumFeature("cookbookCoverGeneration");

  const createMutation = useCreateCookbook();
  const updateMutation = useUpdateCookbook();
  const uploadCoverMutation = useUploadCookbookCover();
  const generateCoverMutation = useGenerateCookbookCover();
  const {
    data: existingCookbook,
    isError: loadError,
    isLoading: loadingExisting,
    refetch: refetchExisting,
  } = useCookbookDetail(cookbookId ?? 0);

  const mutation = isEditMode ? updateMutation : createMutation;

  // In edit mode, the form is pre-populated from the fetched cookbook. If that
  // fetch failed (or hasn't resolved), the form is empty — submitting would
  // overwrite the cookbook with blank values, so block submit until it loads.
  const editLoadBlocked = isEditMode && (loadError || !existingCookbook);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [anyFieldFocused, setAnyFieldFocused] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Create mode has no cookbook id yet, so a chosen cover can't be attached
  // until after the create call. Both cover paths are therefore deferred:
  // a picked photo is held here, and "generate" is armed as an intent.
  const [pendingCoverUri, setPendingCoverUri] = useState<string | null>(null);
  const [generateOnCreate, setGenerateOnCreate] = useState(false);
  // Which cover step is running, if any. A discriminated kind rather than the
  // label alone: the buttons key their spinners off `kind`, so re-wording the
  // copy can't silently detach them.
  const [coverBusy, setCoverBusy] = useState<{
    kind: "upload" | "generate";
    label: string;
  } | null>(null);

  // Pre-populate form when editing
  useEffect(() => {
    if (isEditMode && existingCookbook && !initialized) {
      setName(existingCookbook.name);
      setDescription(existingCookbook.description || "");
      setInitialized(true);
    }
  }, [isEditMode, existingCookbook, initialized]);

  const trimmedName = name.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    !mutation.isPending &&
    !editLoadBlocked &&
    // An in-flight cover step owns the screen — submitting under it would
    // race a second mutation against the same cookbook.
    coverBusy === null;

  const storedCoverUrl = existingCookbook?.coverImageUrl ?? null;
  const hasCover = !!(pendingCoverUri ?? storedCoverUrl);

  /**
   * Leave the screen. A plain `goBack()` is not enough: when Home routes here
   * via a nested `navigate`, this screen is the ONLY route in the Plan stack,
   * so there is nothing to pop to and `goBack()` is a silent no-op.
   *
   * The branch asks the navigator (`canGoBack()`), NOT `route.params.fromHome`.
   * `redirectToHomeTab` clears `fromHome`, so a param-keyed check would be
   * correct on the first visit and fall back into the dead end on the second
   * (reach this screen again via the Plan tab and `fromHome` is already gone).
   * Routing through `goBack()` whenever a route exists beneath also lets
   * `useFromHomeBackRedirect` handle the Home case itself rather than
   * bypassing the hook.
   */
  const dismiss = useCallback(() => {
    // Reaching Home leaves this screen mounted underneath, so a create-mode
    // form would still be filled the next time it's opened. Reset it.
    if (fromHome && !isEditMode) {
      setName("");
      setDescription("");
      setError(null);
      setPendingCoverUri(null);
      setGenerateOnCreate(false);
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    redirectToHomeTab(navigation);
  }, [fromHome, isEditMode, navigation]);

  // An explicit close control, always present. Without it this screen can be
  // a dead end (see `dismiss` above), and `headerBackVisible: false` keeps the
  // native chevron from doubling up when there IS a route beneath.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => (
        <Pressable
          onPress={() => {
            haptics.selection();
            dismiss();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close without saving"
          style={{ marginLeft: Spacing.xs }}
        >
          <Feather name="x" size={24} color={theme.text} />
        </Pressable>
      ),
    });
  }, [navigation, dismiss, haptics, theme.text]);

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

      if (!isEditMode) {
        // Deferred: shown on the plate now, uploaded once the cookbook exists.
        setPendingCoverUri(uri);
        setGenerateOnCreate(false);
        return;
      }

      setPendingCoverUri(uri);
      setCoverBusy({ kind: "upload", label: "Uploading…" });
      try {
        await uploadCoverMutation.mutateAsync({ cookbookId, uri });
        haptics.notification(NotificationFeedbackType.Success);
        AccessibilityInfo.announceForAccessibility("Cover photo updated");
      } catch (err) {
        logger.error("Cookbook cover upload failed:", err);
        haptics.notification(NotificationFeedbackType.Error);
        setPendingCoverUri(null);
        toast.error("Couldn't upload that photo. Please try again.");
      } finally {
        setCoverBusy(null);
      }
    } catch (err) {
      logger.error("Cookbook cover picker failed:", err);
      toast.error("Couldn't open your photo library.");
    }
  }, [haptics, isEditMode, cookbookId, uploadCoverMutation, toast]);

  const handleGenerateCover = useCallback(async () => {
    if (!canGenerateCover) {
      haptics.selection();
      setShowUpgradeModal(true);
      return;
    }
    haptics.selection();

    if (!isEditMode) {
      // Armed as an intent — the generator needs a cookbook id, which only
      // exists after create. Choosing this clears a previously picked photo:
      // a cookbook has one cover, so the two actions are mutually exclusive.
      setGenerateOnCreate((prev) => !prev);
      setPendingCoverUri(null);
      return;
    }

    setCoverBusy({ kind: "generate", label: "Generating…" });
    try {
      await generateCoverMutation.mutateAsync(cookbookId);
      setPendingCoverUri(null);
      haptics.notification(NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Cover generated");
    } catch (err) {
      logger.error("Cookbook cover generation failed:", err);
      haptics.notification(NotificationFeedbackType.Error);
      toast.error("Couldn't generate a cover right now. Please try again.");
    } finally {
      setCoverBusy(null);
    }
  }, [
    canGenerateCover,
    haptics,
    isEditMode,
    cookbookId,
    generateCoverMutation,
    toast,
  ]);

  /**
   * Map a mutation failure to user-safe copy. Never surfaces `err.message` —
   * `apiRequest` throws `ApiError("<status>: <body>")`, so the message is the
   * raw server response.
   */
  const describeError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        if (err.code === ErrorCode.VALIDATION_ERROR) {
          return "Please check the name and try again.";
        }
        if (err.code === ErrorCode.RATE_LIMITED) {
          return "Too many requests. Please wait a moment and try again.";
        }
      }
      return `Couldn't ${isEditMode ? "update" : "create"} this cookbook. Please try again.`;
    },
    [isEditMode],
  );

  const handleSubmit = useCallback(async () => {
    if (!trimmedName) return;
    setError(null);

    if (isEditMode && cookbookId) {
      try {
        await updateMutation.mutateAsync({
          id: cookbookId,
          name: trimmedName,
          description: description.trim() || null,
        });
        haptics.notification(NotificationFeedbackType.Success);
        AccessibilityInfo.announceForAccessibility("Cookbook updated");
        dismiss();
      } catch (err) {
        haptics.notification(NotificationFeedbackType.Error);
        const msg = describeError(err);
        setError(msg);
        // InlineError announces the message itself — announcing here too
        // would say it twice on iOS.
      }
      return;
    }

    let created;
    try {
      created = await createMutation.mutateAsync({
        name: trimmedName,
        description: description.trim() || undefined,
      });
    } catch (err) {
      haptics.notification(NotificationFeedbackType.Error);
      setError(describeError(err));
      return;
    }

    // The cookbook now exists. A cover failure from here on must not read as
    // "creation failed" — the book is saved either way, so the cover step
    // reports separately and the flow still completes.
    let coverFailed = false;
    if (pendingCoverUri) {
      setCoverBusy({ kind: "upload", label: "Adding your cover…" });
      try {
        await uploadCoverMutation.mutateAsync({
          cookbookId: created.id,
          uri: pendingCoverUri,
        });
      } catch (err) {
        logger.error("Cookbook cover upload failed after create:", err);
        coverFailed = true;
      } finally {
        setCoverBusy(null);
      }
    } else if (generateOnCreate) {
      setCoverBusy({ kind: "generate", label: "Generating your cover…" });
      try {
        await generateCoverMutation.mutateAsync(created.id);
      } catch (err) {
        logger.error("Cookbook cover generation failed after create:", err);
        coverFailed = true;
      } finally {
        setCoverBusy(null);
      }
    }

    haptics.notification(
      coverFailed
        ? NotificationFeedbackType.Warning
        : NotificationFeedbackType.Success,
    );
    // One announcement, not two — co-arriving announceForAccessibility calls
    // collide on iOS and only the last is spoken.
    AccessibilityInfo.announceForAccessibility(
      coverFailed
        ? "Cookbook created. The cover couldn't be added — you can add one by editing the cookbook."
        : "Cookbook created",
    );
    if (coverFailed) {
      toast.error("Cookbook created, but the cover couldn't be added.");
    }
    dismiss();
  }, [
    trimmedName,
    description,
    isEditMode,
    cookbookId,
    haptics,
    toast,
    createMutation,
    updateMutation,
    uploadCoverMutation,
    generateCoverMutation,
    pendingCoverUri,
    generateOnCreate,
    describeError,
    dismiss,
  ]);

  // The plate shrinks while a field is focused so it stays visible above the
  // keyboard — you watch the title land on the cover as you type.
  const coverWidth = resolveCoverWidth(
    screenWidth,
    anyFieldFocused,
    SCREEN_PADDING,
  );

  const isCoverBusy = coverBusy !== null;
  const submitLabel = isEditMode ? "Save Changes" : "Create Cookbook";

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingHorizontal: SCREEN_PADDING,
          paddingBottom: tabBarHeight + Spacing.xl,
          gap: Spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <CookbookCoverPlate
          name={name}
          coverImageUrl={storedCoverUrl}
          previewUri={pendingCoverUri}
          width={coverWidth}
          busy={isCoverBusy}
          busyLabel={coverBusy?.label}
        />

        <View style={styles.coverActions}>
          <CoverActionButton
            icon="image"
            label={hasCover ? "Replace photo" : "Add photo"}
            onPress={() => void handlePickPhoto()}
            accessibilityLabel={coverPhotoActionLabel(hasCover)}
            accessibilityHint="Choose a cover image from your photo library"
            selected={!isEditMode && !!pendingCoverUri}
            loading={coverBusy?.kind === "upload"}
            disabled={isCoverBusy}
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
            selected={!isEditMode && generateOnCreate}
            locked={!canGenerateCover}
            loading={coverBusy?.kind === "generate"}
            disabled={isCoverBusy}
          />
        </View>

        {!isEditMode && generateOnCreate ? (
          <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
            Your cover is created from the name and description when you save.
          </ThemedText>
        ) : null}

        <View>
          <TextInput
            label="Name"
            value={name}
            onChangeText={(text) => setName(text.slice(0, NAME_MAX))}
            onFocus={() => setAnyFieldFocused(true)}
            onBlur={() => setAnyFieldFocused(false)}
            maxLength={NAME_MAX}
            error={!!error && !trimmedName}
            returnKeyType="next"
            // Deliberately NOT autofocused: the cover is the first thing this
            // screen has to say, and opening with the keyboard up buries it.
          />
          <ThemedText
            style={[styles.charCount, { color: theme.textSecondary }]}
          >
            {name.length}/{NAME_MAX}
          </ThemedText>

          <TextInput
            label="Description (optional)"
            value={description}
            onChangeText={(text) =>
              setDescription(text.slice(0, DESCRIPTION_MAX))
            }
            onFocus={() => setAnyFieldFocused(true)}
            onBlur={() => setAnyFieldFocused(false)}
            maxLength={DESCRIPTION_MAX}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={styles.multilineInput}
            containerStyle={{ marginTop: Spacing.md }}
          />
          <ThemedText
            style={[styles.charCount, { color: theme.textSecondary }]}
          >
            {description.length}/{DESCRIPTION_MAX}
          </ThemedText>
        </View>

        <InlineError message={error} />

        {isEditMode && loadError && !loadingExisting ? (
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
          loading={mutation.isPending || isCoverBusy}
          loadingText={isEditMode ? "Saving…" : "Creating…"}
          accessibilityLabel={isEditMode ? "Save changes" : "Create cookbook"}
        >
          {submitLabel}
        </Button>
      </ScrollView>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </KeyboardAvoidingView>
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
  hint: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    textAlign: "center",
    marginTop: -Spacing.sm,
  },
  multilineInput: {
    minHeight: 92,
  },
  charCount: {
    fontSize: 12,
    textAlign: "right",
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
