/**
 * Single source of truth for the onboarding screens and the step counter
 * shown to the user.
 *
 * OnboardingNavigator renders these screens in this order and
 * OnboardingContext walks through all of them. Welcome and HealthDataConsent
 * are the intro; the rest are the questionnaire the Welcome copy calls
 * "6 quick steps". The badge, the progress bar and the Welcome copy all
 * derive from these values, so adding a screen here updates all of them.
 */
export const ONBOARDING_SCREENS = [
  "Welcome",
  "HealthDataConsent",
  "Allergies",
  "HealthConditions",
  "DietType",
  "Goals",
  "Preferences",
  "TastePicks",
] as const;

export type OnboardingScreenName = (typeof ONBOARDING_SCREENS)[number];

export const INTRO_SCREEN_COUNT = 2;
export const QUESTION_STEP_COUNT =
  ONBOARDING_SCREENS.length - INTRO_SCREEN_COUNT;

/** 0 on the intro screens, otherwise 1..QUESTION_STEP_COUNT. */
export function getQuestionStep(currentStep: number): number {
  return Math.min(
    QUESTION_STEP_COUNT,
    Math.max(0, currentStep - INTRO_SCREEN_COUNT + 1),
  );
}

/** "Step N of 6" for questionnaire screens, null on the intro screens. */
export function getStepLabel(currentStep: number): string | null {
  const step = getQuestionStep(currentStep);
  return step === 0 ? null : `Step ${step} of ${QUESTION_STEP_COUNT}`;
}
