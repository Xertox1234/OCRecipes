import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { apiRequest } from "@/lib/query-client";
import { useAuthContext } from "@/context/AuthContext";

export interface Allergy {
  name: string;
  severity: "mild" | "moderate" | "severe";
}

export interface OnboardingData {
  allergies: Allergy[];
  healthConditions: string[];
  dietType: string | null;
  foodDislikes: string[];
  primaryGoal: string | null;
  activityLevel: string | null;
  householdSize: number;
  cuisinePreferences: string[];
  cookingSkillLevel: string | null;
  cookingTimeAvailable: string | null;
}

interface OnboardingContextType {
  data: OnboardingData;
  currentStep: number;
  totalSteps: number;
  updateData: (updates: Partial<OnboardingData>) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipOnboarding: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  isSubmitting: boolean;
}

const defaultData: OnboardingData = {
  allergies: [],
  healthConditions: [],
  dietType: null,
  foodDislikes: [],
  primaryGoal: null,
  activityLevel: null,
  householdSize: 1,
  cuisinePreferences: [],
  cookingSkillLevel: null,
  cookingTimeAvailable: null,
};

const TOTAL_STEPS = 7;

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OnboardingData>(defaultData);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { updateUser } = useAuthContext();

  const updateData = useCallback((updates: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => (prev < TOTAL_STEPS - 1 ? prev + 1 : prev));
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  const skipOnboarding = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/user/dietary-profile", defaultData);
      await updateUser({ onboardingCompleted: true });
    } catch (error) {
      // Callers (e.g. WelcomeScreen) invoke this without awaiting, so we must
      // not re-throw — that would surface as an unhandled promise rejection.
      console.error("Failed to skip onboarding:", error);
    } finally {
      setIsSubmitting(false);
    }
  }, [updateUser]);

  const completeOnboarding = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/user/dietary-profile", data);
      await updateUser({ onboardingCompleted: true });
    } catch (error) {
      // Catch + log to keep parity with skipOnboarding; callers may fire-and-
      // forget so re-throwing would risk unhandled rejections.
      console.error("Failed to complete onboarding:", error);
    } finally {
      setIsSubmitting(false);
    }
  }, [data, updateUser]);

  const value = useMemo<OnboardingContextType>(
    () => ({
      data,
      currentStep,
      totalSteps: TOTAL_STEPS,
      updateData,
      nextStep,
      prevStep,
      skipOnboarding,
      completeOnboarding,
      isSubmitting,
    }),
    [
      data,
      currentStep,
      updateData,
      nextStep,
      prevStep,
      skipOnboarding,
      completeOnboarding,
      isSubmitting,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return context;
}
