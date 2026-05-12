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
  /**
   * Boolean intent flag — `true` after the user explicitly accepts the health
   * data consent screen, `false` if they skipped. The server stamps the
   * authoritative `healthDataConsentAt` timestamp (`new Date()`) when this is
   * `true`; clients cannot supply, backdate, or clear that column.
   */
  healthDataConsent: boolean;
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
  healthDataConsent: false,
};

const TOTAL_STEPS = 8;

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OnboardingData>(defaultData);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { updateUser, checkAuth } = useAuthContext();

  const updateData = useCallback((updates: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => (prev < TOTAL_STEPS - 1 ? prev + 1 : prev));
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  // Recovery model for skipOnboarding / completeOnboarding:
  // The server's POST /api/user/dietary-profile uses upsertProfileWithOnboarding
  // to write the profile and set onboardingCompleted=true atomically, and the
  // upsert is idempotent. If updateUser fails after a successful POST we try
  // checkAuth() as a best-effort resync — that path re-fetches the user from
  // the server so the navigation gate unblocks without forcing the user to
  // retry the whole flow. If checkAuth also fails, we rethrow so the caller
  // can surface a retry prompt; the retry is safe (same atomic upsert).
  const resyncAfterPartialSuccess = useCallback(async () => {
    try {
      await checkAuth();
    } catch (resyncErr) {
      console.warn("onboarding resync via checkAuth failed:", resyncErr);
    }
  }, [checkAuth]);

  const skipOnboarding = useCallback(async () => {
    setIsSubmitting(true);
    let profileSaved = false;
    try {
      await apiRequest("POST", "/api/user/dietary-profile", defaultData);
      profileSaved = true;
      await updateUser({ onboardingCompleted: true });
    } catch (err) {
      console.error(
        profileSaved
          ? "skipOnboarding: server saved but client sync failed (resyncing):"
          : "skipOnboarding: profile save failed:",
        err,
      );
      if (profileSaved) {
        await resyncAfterPartialSuccess();
      }
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [updateUser, resyncAfterPartialSuccess]);

  const completeOnboarding = useCallback(async () => {
    setIsSubmitting(true);
    let profileSaved = false;
    try {
      await apiRequest("POST", "/api/user/dietary-profile", data);
      profileSaved = true;
      await updateUser({ onboardingCompleted: true });
    } catch (err) {
      console.error(
        profileSaved
          ? "completeOnboarding: server saved but client sync failed (resyncing):"
          : "completeOnboarding: profile save failed:",
        err,
      );
      if (profileSaved) {
        await resyncAfterPartialSuccess();
      }
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [data, updateUser, resyncAfterPartialSuccess]);

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
