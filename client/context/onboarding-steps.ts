/**
 * Single source of truth for the onboarding screens and the step counter
 * shown to the user.
 *
 * OnboardingNavigator renders these screens in this order and
 * OnboardingContext walks through all of them. Welcome, AiSharing (privacy
 * audit H3: who the AI features send data to, asked before any of it is
 * sent) and HealthDataConsent are the intro; the rest are the questionnaire
 * the Welcome copy calls
 * "6 quick steps". The badge, the progress bar and the Welcome copy all
 * derive from these values, so adding a screen here updates all of them.
 */
export const ONBOARDING_SCREENS = [
  "Welcome",
  "AiSharing",
  "HealthDataConsent",
  "Allergies",
  "HealthConditions",
  "DietType",
  "Goals",
  "Preferences",
  "TastePicks",
] as const;

export type OnboardingScreenName = (typeof ONBOARDING_SCREENS)[number];

export const INTRO_SCREEN_COUNT = 3;
export const QUESTION_STEP_COUNT =
  ONBOARDING_SCREENS.length - INTRO_SCREEN_COUNT;

/**
 * The health questions. They are shown only after the user agrees to the
 * health-data consent ("no consent, no health data"); the server refuses the
 * fields they collect without it (`shared/lib/health-consent.ts`).
 */
export const HEALTH_SCREENS: readonly OnboardingScreenName[] = [
  "Allergies",
  "HealthConditions",
  "DietType",
  "Goals",
];

function isShown(index: number, consented: boolean): boolean {
  return consented || !HEALTH_SCREENS.includes(ONBOARDING_SCREENS[index]);
}

/** The next screen that is shown, or `current` on the last one. */
export function nextStepIndex(current: number, consented: boolean): number {
  for (let i = current + 1; i < ONBOARDING_SCREENS.length; i++) {
    if (isShown(i, consented)) return i;
  }
  return current;
}

/** The previous screen that is shown, or `current` on the first one. */
export function prevStepIndex(current: number, consented: boolean): number {
  for (let i = current - 1; i >= 0; i--) {
    if (isShown(i, consented)) return i;
  }
  return current;
}

/** How many questionnaire screens this user walks through. */
export function getQuestionStepCount(consented: boolean): number {
  return consented
    ? QUESTION_STEP_COUNT
    : QUESTION_STEP_COUNT - HEALTH_SCREENS.length;
}

/** 0 on the intro screens, otherwise 1..getQuestionStepCount(consented). */
export function getQuestionStep(currentStep: number, consented = true): number {
  if (currentStep < INTRO_SCREEN_COUNT) return 0;
  let step = 0;
  const last = Math.min(currentStep, ONBOARDING_SCREENS.length - 1);
  for (let i = INTRO_SCREEN_COUNT; i <= last; i++) {
    if (isShown(i, consented)) step++;
  }
  return step;
}

/** "Step N of M" for questionnaire screens, null on the intro screens. */
export function getStepLabel(
  currentStep: number,
  consented = true,
): string | null {
  const step = getQuestionStep(currentStep, consented);
  return step === 0
    ? null
    : `Step ${step} of ${getQuestionStepCount(consented)}`;
}
