import {
  INTRO_SCREEN_COUNT,
  ONBOARDING_SCREENS,
  QUESTION_STEP_COUNT,
  getQuestionStep,
  getStepLabel,
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
});
