/**
 * Single source of truth for the onboarding step counter shown to the user.
 *
 * The flow has 8 screens (`TOTAL_STEPS` in OnboardingContext): Welcome and
 * HealthDataConsent are the intro, the remaining 6 are the questionnaire the
 * Welcome copy calls "6 quick steps". The badge, the progress bar and the
 * Welcome copy all derive from these values.
 */
export const INTRO_SCREEN_COUNT = 2;
export const QUESTION_STEP_COUNT = 6;

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
