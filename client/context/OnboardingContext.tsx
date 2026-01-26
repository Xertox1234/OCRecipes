import React, { createContext, useContext, useState, ReactNode } from "react";
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

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OnboardingData>(defaultData);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { checkAuth } = useAuthContext();
  const totalSteps = 5;

  const updateData = (updates: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  };

  const nextStep = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const skipOnboarding = async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/user/dietary-profile", defaultData);
      await checkAuth();
    } finally {
      setIsSubmitting(false);
    }
  };

  const completeOnboarding = async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/user/dietary-profile", data);
      await checkAuth();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OnboardingContext.Provider
      value={{
        data,
        currentStep,
        totalSteps,
        updateData,
        nextStep,
        prevStep,
        skipOnboarding,
        completeOnboarding,
        isSubmitting,
      }}
    >
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
