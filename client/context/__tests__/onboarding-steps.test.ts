import {
  INTRO_SCREEN_COUNT,
  ONBOARDING_SCREENS,
  QUESTION_STEP_COUNT,
  getQuestionStep,
  getQuestionStepCount,
  getStepLabel,
  nextStepIndex,
  prevStepIndex,
} from "../onboarding-steps";

describe("onboarding-steps", () => {
  it("has 6 questionnaire steps after Welcome + consent", () => {
    expect(QUESTION_STEP_COUNT).toBe(6);
  });

  it("returns 0 for Welcome and HealthDataConsent (pre-questionnaire)", () => {
    expect(getQuestionStep(0)).toBe(0);
    expect(getQuestionStep(1)).toBe(0);
    expect(getStepLabel(0)).toBeNull();
    expect(getStepLabel(1)).toBeNull();
  });

  it("numbers questionnaire screens 1..6 through TastePicks", () => {
    expect(getQuestionStep(2)).toBe(1);
    expect(getQuestionStep(7)).toBe(6);
    expect(getStepLabel(2)).toBe("Step 1 of 6");
    expect(getStepLabel(6)).toBe("Step 5 of 6");
    expect(getStepLabel(7)).toBe("Step 6 of 6");
  });

  // The counter must follow the real screen list: adding a screen to the
  // navigator without updating the counts used to skew the badge and bar.
  it("derives the step counts from the onboarding screen list", () => {
    expect(ONBOARDING_SCREENS.slice(0, INTRO_SCREEN_COUNT)).toEqual([
      "Welcome",
      "HealthDataConsent",
    ]);
    expect(INTRO_SCREEN_COUNT + QUESTION_STEP_COUNT).toBe(
      ONBOARDING_SCREENS.length,
    );
  });

  // Privacy audit H2: without the health-data consent the health questions
  // (Allergies, HealthConditions, Goals) are never shown.
  describe("without the health-data consent", () => {
    const idx = (name: (typeof ONBOARDING_SCREENS)[number]) =>
      ONBOARDING_SCREENS.indexOf(name);

    it("goes from the consent screen straight to DietType", () => {
      expect(nextStepIndex(idx("HealthDataConsent"), false)).toBe(
        idx("DietType"),
      );
    });

    it("skips Goals between DietType and Preferences, both ways", () => {
      expect(nextStepIndex(idx("DietType"), false)).toBe(idx("Preferences"));
      expect(prevStepIndex(idx("Preferences"), false)).toBe(idx("DietType"));
    });

    it("goes back from DietType to the consent screen", () => {
      expect(prevStepIndex(idx("DietType"), false)).toBe(
        idx("HealthDataConsent"),
      );
    });

    it("stops at the last screen and at the first", () => {
      expect(nextStepIndex(idx("TastePicks"), false)).toBe(idx("TastePicks"));
      expect(prevStepIndex(0, false)).toBe(0);
    });

    it("counts only the three screens that are shown", () => {
      expect(getQuestionStepCount(false)).toBe(3);
      expect(getStepLabel(idx("DietType"), false)).toBe("Step 1 of 3");
      expect(getStepLabel(idx("Preferences"), false)).toBe("Step 2 of 3");
      expect(getStepLabel(idx("TastePicks"), false)).toBe("Step 3 of 3");
      expect(getQuestionStep(idx("HealthDataConsent"), false)).toBe(0);
    });
  });

  describe("with the health-data consent", () => {
    it("walks every screen in order", () => {
      expect(getQuestionStepCount(true)).toBe(6);
      for (let i = 0; i < ONBOARDING_SCREENS.length - 1; i++) {
        expect(nextStepIndex(i, true)).toBe(i + 1);
        expect(prevStepIndex(i + 1, true)).toBe(i);
      }
    });
  });
});
