import React, { useEffect, useReducer, useRef, useState } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as ImagePicker from "expo-image-picker";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { NotificationFeedbackType } from "expo-haptics";
import type { KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  STEP_LABELS,
  WizardStepBar,
} from "@/components/cookbook/WizardStepBar";
import { WizardBasicsStep } from "@/components/cookbook/WizardBasicsStep";
import { WizardCoverStep } from "@/components/cookbook/WizardCoverStep";
import { WizardRecipesStep } from "@/components/cookbook/WizardRecipesStep";
import { WizardReviewStep } from "@/components/cookbook/WizardReviewStep";
import { resolveCoverWidth } from "@/components/cookbook/cookbook-cover-utils";
import {
  initialWizardState,
  stepBlocker,
  WIZARD_STEPS,
  wizardReducer,
  type WizardStep,
} from "@/components/cookbook/cookbook-wizard-utils";
import {
  createCookbookFromWizard,
  describeWizardOutcome,
  type WizardOutcome,
} from "@/components/cookbook/create-cookbook-from-wizard";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { focusFirstInvalid } from "@/lib/field-validation";
import { useToast } from "@/context/ToastContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { ApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  useAddRecipeToCookbook,
  useAttachCoverCandidate,
  useCreateCookbook,
  useGenerateCoverCandidates,
  useUploadCookbookCover,
  type CoverCandidateSet,
} from "@/hooks/useCookbooks";
import { coverStudioErrorCopy } from "@/components/cookbook/cover-studio-utils";
import { Spacing } from "@/constants/theme";
import type { CookbookCreateScreenNavigationProp } from "@/types/navigation";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import { useFromHomeBackRedirect } from "@/hooks/useFromHomeBackRedirect";
import { useHeaderCloseButton } from "@/hooks/useHeaderCloseButton";

const SCREEN_PADDING = Spacing.lg;
/** Long enough for the cover's success pop to land before the screen closes. */
const SUCCESS_SETTLE_MS = 450;

/**
 * User-safe copy for a failed create. Never surfaces `err.message` — that is
 * the raw server body. `RATE_LIMITED` gets its own line because "try again"
 * is the wrong advice when the limiter is the thing saying no.
 */
function describeCreateError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === ErrorCode.VALIDATION_ERROR) {
      return "Please check the name and try again.";
    }
    if (err.code === ErrorCode.RATE_LIMITED) {
      return "Too many requests. Please wait a moment and try again.";
    }
  }
  return "Couldn't create this cookbook. Please try again.";
}

function recipesLabel(count: number): string {
  return count === 1 ? "1 recipe" : `${count} recipes`;
}

/**
 * The step-by-step New Cookbook flow: Basics → Cover → Recipes → Review.
 * Nothing is saved until Create on Review, which creates the book and then
 * attaches the cover and the picked recipes.
 */
export default function CookbookCreateWizard() {
  const navigation = useNavigation<CookbookCreateScreenNavigationProp>();
  const route = useRoute<RouteProp<MealPlanStackParamList, "CookbookCreate">>();
  const fromHome = route.params?.fromHome;
  useFromHomeBackRedirect(navigation, fromHome);

  const headerInset = useHeaderContentInset();
  const tabBarHeight = useBottomTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const toast = useToast();
  const canGenerateCover = usePremiumFeature("cookbookCoverGeneration");

  const createMutation = useCreateCookbook();
  const uploadCoverMutation = useUploadCookbookCover();
  const attachCandidateMutation = useAttachCoverCandidate();
  // Destructured: the mutation object is a new ref every render.
  const { mutateAsync: generateCandidates, isPending: generatingCandidates } =
    useGenerateCoverCandidates();
  const [studioError, setStudioError] = useState<string | null>(null);
  const [promptIgnored, setPromptIgnored] = useState(false);
  const addRecipeMutation = useAddRecipeToCookbook();

  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  // The name's error timing (form-fields spec §5.1). Basics keeps it in step
  // with `state.name` through `onNameChange`.
  const nameField = useFieldValidation((value) =>
    value.trim() === "" ? "Enter a name for your cookbook." : null,
  );
  // Destructured, never read as `nameField.ref` in render: React Compiler
  // treats an object read through `.ref` as a ref and skips the component.
  const { ref: nameRef } = nameField;

  // Reported by the Recipes step once its sources load; null until then, so
  // the step can't be skipped (or blocked) on a guess. A state setter, so it
  // is stable for the step's effect.
  const [hasAnyRecipes, setHasAnyRecipes] = useState<boolean | null>(null);
  const recipesAvailable = hasAnyRecipes === true;
  // Bumped to focus the name once Basics has mounted after a jump back to it.
  const [focusNameKey, setFocusNameKey] = useState(0);
  // Bumped by each rejected Continue on Recipes so its message shakes.
  const [recipesShakeKey, setRecipesShakeKey] = useState(0);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  // Set before the first await, so a second press in the same frame is
  // dropped before React re-renders the button as loading.
  const submittingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // The primary button's progress line: "Creating…" until the slow cover
  // step starts, then the runner's label for it.
  const [createLoadingText, setCreateLoadingText] = useState("Creating…");
  // Bumped once the create lands: the cover plays its success pop, and the
  // flow stays locked through the short settle before the screen closes.
  const [celebrateKey, setCelebrateKey] = useState(0);
  const saved = celebrateKey > 0;
  const locked = submitting || saved;
  // Close control + `dismiss` that removes this route — see the hook for why
  // `canGoBack()` and a plain `goBack()` both get the one-route case wrong.
  // Disabled while locked: leaving mid-save would strand the request.
  const dismiss = useHeaderCloseButton(
    navigation,
    fromHome,
    "Close without saving",
    locked,
  );
  // Leaves once the create has settled — unless the user already left this
  // screen another way (e.g. a tab switch), when closing would yank them.
  // Then the close waits for their return: the saved wizard is locked, so
  // it must not be left on screen with no way out.
  const pendingDismiss = useRef(false);
  const closeIfFocused = () => {
    if (navigation.isFocused()) dismiss();
    else pendingDismiss.current = true;
  };
  useEffect(
    () =>
      navigation.addListener("focus", () => {
        if (!pendingDismiss.current) return;
        pendingDismiss.current = false;
        dismiss();
      }),
    [navigation, dismiss],
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Each step opens at its top, not wherever the last one was scrolled to.
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [state.step]);

  // Say the new step out loud: the progressbar's value changes silently on
  // iOS. Keyed on the last announced step rather than a first-render flag,
  // so StrictMode's double effect run can't announce on mount.
  const announcedStep = useRef(state.step);
  useEffect(() => {
    if (announcedStep.current === state.step) return;
    announcedStep.current = state.step;
    AccessibilityInfo.announceForAccessibility(
      `Step ${WIZARD_STEPS.indexOf(state.step) + 1} of ${WIZARD_STEPS.length}, ${STEP_LABELS[state.step]}`,
    );
  }, [state.step]);

  useEffect(() => {
    if (focusNameKey > 0) nameRef.current?.focus();
  }, [focusNameKey, nameRef]);

  // Shown only after a rejected Continue, and only while it still applies —
  // picking a recipe clears it.
  const recipesError =
    state.step === "recipes" && recipesShakeKey > 0
      ? stepBlocker(state, "recipes", recipesAvailable)
      : null;

  /**
   * Show why `step` can't be left: it becomes the current step if it isn't
   * already, its message shows (with a shake), and the error haptic fires.
   */
  const rejectAt = (step: WizardStep) => {
    if (step !== state.step) {
      // The error below announces this moment; a step announcement in the
      // same commit would collide with it (iOS drops one), so mark the step
      // as already said.
      announcedStep.current = step;
      setCreateError(null);
      dispatch({ type: "goTo", step });
    }
    if (step === "basics") {
      // Marks the name submitted (its error shows and shakes) and focuses it
      // now if Basics is mounted, or once it mounts.
      focusFirstInvalid([nameField]);
      if (step !== state.step) setFocusNameKey((k) => k + 1);
    } else {
      setRecipesShakeKey((k) => k + 1);
    }
    haptics.notification(NotificationFeedbackType.Error);
  };

  const goTo = (target: WizardStep) => {
    if (locked) return;
    // A forward jump must pass every step it skips over, starting with this
    // one — the step bar and Edit links otherwise route around the rules.
    // Backward jumps are always allowed.
    const from = WIZARD_STEPS.indexOf(state.step);
    const to = WIZARD_STEPS.indexOf(target);
    for (let i = from; i < to; i++) {
      // Like Continue: while availability is unknown, Recipes can neither be
      // skipped nor blocked, so stay put silently.
      if (WIZARD_STEPS[i] === "recipes" && hasAnyRecipes === null) return;
      if (stepBlocker(state, WIZARD_STEPS[i], recipesAvailable)) {
        rejectAt(WIZARD_STEPS[i]);
        return;
      }
    }
    setCreateError(null);
    dispatch({ type: "goTo", step: target });
  };

  const handleBack = () => {
    if (locked) return;
    setCreateError(null);
    dispatch({ type: "back" });
  };

  const handleContinue = () => {
    // Until the sources say whether there is anything to pick, Recipes can
    // neither be skipped nor blocked.
    if (state.step === "recipes" && hasAnyRecipes === null) return;
    if (stepBlocker(state, state.step, recipesAvailable)) {
      rejectAt(state.step);
      return;
    }
    setRecipesShakeKey(0);
    dispatch({ type: "next" });
  };

  const handlePickPhoto = async () => {
    haptics.selection();
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
      });
    } catch (err) {
      logger.error("Cookbook cover picker failed:", err);
      toast.error("Couldn't open your photo library.");
      return;
    }
    if (result.canceled || !result.assets[0]) return;
    dispatch({
      type: "setCover",
      cover: { kind: "photo", uri: result.assets[0].uri },
    });
  };

  const handleGenerateCovers = async () => {
    if (generatingCandidates) return;
    setStudioError(null);
    const description = state.description.trim();
    const coverPrompt = state.studio.prompt.trim();
    let set: CoverCandidateSet;
    try {
      set = await generateCandidates({
        name: state.name.trim(),
        description: description === "" ? undefined : description,
        coverPrompt: coverPrompt === "" ? undefined : coverPrompt,
        style: state.studio.style,
      });
    } catch (err) {
      logger.error("Cover studio set failed:", err);
      haptics.notification(NotificationFeedbackType.Error);
      // InlineError announces the message itself.
      setStudioError(coverStudioErrorCopy(err));
      return;
    }
    dispatch({ type: "setCandidates", candidates: set.candidates });
    setPromptIgnored(set.promptIgnored);
    toast.success(`${set.candidates.length} covers ready`);
  };

  const handleRequestUpgrade = () => {
    haptics.selection();
    setShowUpgradeModal(true);
  };

  const handleCreate = async () => {
    if (submittingRef.current || saved) return;
    // Backstop: never create a nameless book, however Review was reached.
    if (stepBlocker(state, "basics", true)) {
      rejectAt("basics");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setCreateError(null);
    setCreateLoadingText("Creating…");

    let outcome: WizardOutcome;
    try {
      outcome = await createCookbookFromWizard(state, {
        create: createMutation.mutateAsync,
        uploadCover: uploadCoverMutation.mutateAsync,
        attachCandidate: attachCandidateMutation.mutateAsync,
        addRecipe: addRecipeMutation.mutateAsync,
        onCoverStart: setCreateLoadingText,
      });
    } catch (err) {
      // Nothing was created: keep everything the user chose, and let them
      // press Create again.
      logger.error("Wizard cookbook create failed:", err);
      submittingRef.current = false;
      setSubmitting(false);
      haptics.notification(NotificationFeedbackType.Error);
      // InlineError announces the message itself.
      setCreateError(describeCreateError(err));
      return;
    }

    // The book exists from here on; the guard stays set so it can't be
    // created twice. Exactly ONE announcer per outcome: the toast (iOS
    // announce + Android live region), with its own haptic off because the
    // line before it already fired one.
    setSubmitting(false);
    const partial = describeWizardOutcome(outcome);
    if (partial) {
      haptics.notification(NotificationFeedbackType.Warning);
      toast.error(partial, { haptic: false });
      closeIfFocused();
      return;
    }
    haptics.notification(NotificationFeedbackType.Success);
    toast.success("Cookbook created", { haptic: false });
    // The full success gets its moment: the cover pops, then the screen
    // closes once it has landed.
    setCelebrateKey((k) => k + 1);
    if (reducedMotion) closeIfFocused();
    else closeTimer.current = setTimeout(closeIfFocused, SUCCESS_SETTLE_MS);
  };

  let body: React.ReactNode;
  switch (state.step) {
    case "basics":
      body = (
        <WizardBasicsStep
          state={state}
          dispatch={dispatch}
          nameRef={nameRef}
          nameError={nameField.error}
          nameShakeKey={nameField.shakeKey}
          onNameFocus={nameField.onFocus}
          onNameBlur={nameField.onBlur}
          onNameChange={nameField.onChangeText}
        />
      );
      break;
    case "cover":
      body = (
        <WizardCoverStep
          state={state}
          dispatch={dispatch}
          canGenerate={canGenerateCover}
          onRequestUpgrade={handleRequestUpgrade}
          onPickPhoto={() => void handlePickPhoto()}
          coverWidth={resolveCoverWidth(screenWidth, false, SCREEN_PADDING)}
          studioControls={{
            generating: generatingCandidates,
            error: studioError,
            promptIgnored,
            onGenerate: () => void handleGenerateCovers(),
          }}
        />
      );
      break;
    case "recipes":
      body = (
        <WizardRecipesStep
          state={state}
          dispatch={dispatch}
          onAvailability={setHasAnyRecipes}
        />
      );
      break;
    case "review":
      body = (
        <WizardReviewStep
          state={state}
          onEdit={goTo}
          celebrateKey={celebrateKey}
        />
      );
      break;
  }

  let primaryLabel = "Continue";
  if (state.step === "recipes") {
    // Picks win: a source that failed after the user picked from the other
    // one must not offer to skip what they chose.
    if (state.recipes.length > 0 || hasAnyRecipes === true) {
      primaryLabel = `Continue · ${recipesLabel(state.recipes.length)}`;
    } else if (hasAnyRecipes === false) {
      primaryLabel = "Skip for now";
    }
  } else if (state.step === "review") {
    primaryLabel = "Create Cookbook";
  }
  const isReview = state.step === "review";

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={{ paddingTop: headerInset, paddingHorizontal: SCREEN_PADDING }}
      >
        <WizardStepBar
          step={state.step}
          furthest={state.furthest}
          onSelect={goTo}
        />
      </View>

      <KeyboardAwareScrollViewCompat
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="on-drag"
        bottomOffset={Spacing.lg}
      >
        <Animated.View
          key={state.step}
          entering={reducedMotion ? undefined : FadeIn.duration(220)}
          exiting={reducedMotion ? undefined : FadeOut.duration(120)}
        >
          {body}
        </Animated.View>
      </KeyboardAwareScrollViewCompat>

      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: tabBarHeight + Spacing.md,
            borderTopColor: theme.border,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <InlineError
          message={createError ?? recipesError}
          shakeKey={recipesShakeKey}
        />
        <View style={styles.buttonRow}>
          {state.step !== "basics" ? (
            <Button
              variant="outline"
              onPress={handleBack}
              disabled={locked}
              style={styles.backButton}
            >
              Back
            </Button>
          ) : null}
          <Button
            onPress={isReview ? () => void handleCreate() : handleContinue}
            loading={isReview && submitting}
            loadingText={createLoadingText}
            disabled={saved}
            style={styles.primaryButton}
          >
            {primaryLabel}
          </Button>
        </View>
      </View>

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
  scrollContent: {
    paddingTop: Spacing.lg,
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: Spacing.xl,
  },
  bottomBar: {
    paddingTop: Spacing.md,
    paddingHorizontal: SCREEN_PADDING,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  backButton: {
    paddingHorizontal: Spacing.xl,
  },
  primaryButton: {
    flex: 1,
  },
});
