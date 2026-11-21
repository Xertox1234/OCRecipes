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

const at = (name: (typeof ONBOARDING_SCREENS)[number]) =>
  ONBOARDING_SCREENS.indexOf(name);

describe("onboarding-steps", () => {
  it("has 6 questionnaire steps after the intro screens", () => {
    expect(QUESTION_STEP_COUNT).toBe(6);
  });

  it("returns 0 for the four intro screens (pre-questionnaire)", () => {
    for (const name of [
      "Welcome",
      "FamilyIntro",
      "AiSharing",
      "HealthDataConsent",
    ] as const) {
      expect(getQuestionStep(at(name))).toBe(0);
      expect(getStepLabel(at(name))).toBeNull();
    }
  });

  // Owner ruling 2026-11-21: one card about family planning (a premium
  // feature), right after Welcome. It asks nothing, so it is an intro screen
  // and is shown with or without the health-data consent.
  it("shows the family card right after Welcome, then the AI question", () => {
    expect(nextStepIndex(at("Welcome"), false)).toBe(at("FamilyIntro"));
    expect(nextStepIndex(at("FamilyIntro"), false)).toBe(at("AiSharing"));
    expect(nextStepIndex(at("FamilyIntro"), true)).toBe(at("AiSharing"));
    expect(prevStepIndex(at("AiSharing"), false)).toBe(at("FamilyIntro"));
  });

  // Privacy audit H3 (owner ruling 2026-11-10): a new account is asked about
  // AI sharing inside onboarding, before any question whose answer AI uses.
  it("asks the AI-sharing question before the consent and every question", () => {
    expect(nextStepIndex(at("AiSharing"), false)).toBe(at("HealthDataConsent"));
    expect(at("AiSharing")).toBeLessThan(at("Allergies"));
    expect(at("AiSharing")).toBeLessThan(at("Preferences"));
  });

  it("numbers questionnaire screens 1..6 through TastePicks", () => {
    expect(getQuestionStep(at("Allergies"))).toBe(1);
    expect(getQuestionStep(at("TastePicks"))).toBe(6);
    expect(getStepLabel(at("Allergies"))).toBe("Step 1 of 6");
    expect(getStepLabel(at("Preferences"))).toBe("Step 5 of 6");
    expect(getStepLabel(at("TastePicks"))).toBe("Step 6 of 6");
  });

  // The counter must follow the real screen list: adding a screen to the
  // navigator without updating the counts used to skew the badge and bar.
  it("derives the step counts from the onboarding screen list", () => {
    expect(ONBOARDING_SCREENS.slice(0, INTRO_SCREEN_COUNT)).toEqual([
      "Welcome",
      "FamilyIntro",
      "AiSharing",
      "HealthDataConsent",
    ]);
    expect(INTRO_SCREEN_COUNT + QUESTION_STEP_COUNT).toBe(
      ONBOARDING_SCREENS.length,
    );
  });

  // Privacy audit H2: without the health-data consent the health questions
  // (Allergies, HealthConditions, DietType, Goals) are never shown. DietType
  // joined them by owner ruling 2026-11-10.
  describe("without the health-data consent", () => {
    const idx = (name: (typeof ONBOARDING_SCREENS)[number]) =>
      ONBOARDING_SCREENS.indexOf(name);

    it("goes from the consent screen straight to Preferences", () => {
      expect(nextStepIndex(idx("HealthDataConsent"), false)).toBe(
        idx("Preferences"),
      );
    });

    it("goes back from Preferences to the consent screen", () => {
      expect(prevStepIndex(idx("Preferences"), false)).toBe(
        idx("HealthDataConsent"),
      );
    });

    it("never lands on a health question", () => {
      const shown: string[] = [];
      let i = idx("HealthDataConsent");
      for (;;) {
        const next = nextStepIndex(i, false);
        if (next === i) break;
        shown.push(ONBOARDING_SCREENS[next]);
        i = next;
      }
      expect(shown).toEqual(["Preferences", "TastePicks"]);
    });

    it("stops at the last screen and at the first", () => {
      expect(nextStepIndex(idx("TastePicks"), false)).toBe(idx("TastePicks"));
      expect(prevStepIndex(0, false)).toBe(0);
    });

    it("counts only the two screens that are shown", () => {
      expect(getQuestionStepCount(false)).toBe(2);
      expect(getStepLabel(idx("Preferences"), false)).toBe("Step 1 of 2");
      expect(getStepLabel(idx("TastePicks"), false)).toBe("Step 2 of 2");
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
