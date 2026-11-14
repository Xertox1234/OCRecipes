import React from "react";

import { useOnboarding } from "@/context/OnboardingContext";
import AiSharingScreen from "@/screens/AiSharingScreen";

/**
 * The AI-sharing question as an onboarding step (privacy audit H3, owner
 * ruling 2026-11-10): a new account is asked here, before any question whose
 * answer the AI features use.
 */
export default function AiSharingStepScreen() {
  const { nextStep } = useOnboarding();
  return <AiSharingScreen onAnswered={nextStep} />;
}
