import { useState, useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { useHaptics } from "@/hooks/useHaptics";
import { apiRequest } from "@/lib/query-client";

interface Allergy {
  name: string;
  severity: "mild" | "moderate" | "severe";
}

interface DietaryProfile {
  allergies?: Allergy[];
  healthConditions?: string[];
  dietType?: string | null;
  foodDislikes?: string[];
  primaryGoal?: string | null;
  activityLevel?: string | null;
  cuisinePreferences?: string[];
  cookingSkillLevel?: string | null;
  cookingTimeAvailable?: string | null;
}

export function useDietaryProfileForm() {
  const navigation = useNavigation();
  const haptics = useHaptics();
  const queryClient = useQueryClient();

  const [isSaving, setIsSaving] = useState(false);
  const [selectedAllergen, setSelectedAllergen] = useState<string | null>(null);

  // Form state
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [healthConditions, setHealthConditions] = useState<string[]>([]);
  const [dietType, setDietType] = useState<string | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState<string | null>(null);
  const [activityLevel, setActivityLevel] = useState<string | null>(null);
  const [foodDislikes, setFoodDislikes] = useState<string[]>([]);
  const [cuisinePreferences, setCuisinePreferences] = useState<string[]>([]);
  const [cookingSkillLevel, setCookingSkillLevel] = useState<string | null>(
    null,
  );
  const [cookingTimeAvailable, setCookingTimeAvailable] = useState<
    string | null
  >(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery<DietaryProfile>({
    queryKey: ["/api/user/dietary-profile"],
  });

  // Initialize form state from fetched profile
  useEffect(() => {
    if (profile) {
      setAllergies(profile.allergies || []);
      setHealthConditions(profile.healthConditions || []);
      setDietType(profile.dietType || null);
      setPrimaryGoal(profile.primaryGoal || null);
      setActivityLevel(profile.activityLevel || null);
      setFoodDislikes(profile.foodDislikes || []);
      setCuisinePreferences(profile.cuisinePreferences || []);
      setCookingSkillLevel(profile.cookingSkillLevel || null);
      setCookingTimeAvailable(profile.cookingTimeAvailable || null);
    }
  }, [profile]);

  const toggleAllergen = (allergenId: string) => {
    const existing = allergies.find((a) => a.name === allergenId);
    if (existing) {
      setAllergies(allergies.filter((a) => a.name !== allergenId));
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    } else {
      setSelectedAllergen(allergenId);
    }
  };

  const setSeverity = (severity: "mild" | "moderate" | "severe") => {
    if (selectedAllergen) {
      const filtered = allergies.filter((a) => a.name !== selectedAllergen);
      setAllergies([...filtered, { name: selectedAllergen, severity }]);
      setSelectedAllergen(null);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const toggleHealthCondition = (conditionId: string) => {
    if (healthConditions.includes(conditionId)) {
      setHealthConditions(healthConditions.filter((c) => c !== conditionId));
    } else {
      setHealthConditions([...healthConditions, conditionId]);
    }
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleDislike = (dislikeId: string) => {
    if (foodDislikes.includes(dislikeId)) {
      setFoodDislikes(foodDislikes.filter((d) => d !== dislikeId));
    } else {
      setFoodDislikes([...foodDislikes, dislikeId]);
    }
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleCuisine = (cuisineId: string) => {
    if (cuisinePreferences.includes(cuisineId)) {
      setCuisinePreferences(cuisinePreferences.filter((c) => c !== cuisineId));
    } else {
      setCuisinePreferences([...cuisinePreferences, cuisineId]);
    }
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await apiRequest("PUT", "/api/user/dietary-profile", {
        allergies,
        healthConditions,
        dietType,
        foodDislikes,
        primaryGoal,
        activityLevel,
        cuisinePreferences,
        cookingSkillLevel,
        cookingTimeAvailable,
      });

      // Invalidate the dietary profile query to refresh data
      queryClient.invalidateQueries({
        queryKey: ["/api/user/dietary-profile"],
      });

      haptics.notification(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (error) {
      console.error("Failed to save dietary profile:", error);
      setSaveError("Failed to save profile. Please try again.");
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  return {
    isLoading,
    isSaving,
    saveError,
    selectedAllergen,
    allergies,
    healthConditions,
    dietType,
    setDietType,
    primaryGoal,
    setPrimaryGoal,
    activityLevel,
    setActivityLevel,
    foodDislikes,
    cuisinePreferences,
    cookingSkillLevel,
    setCookingSkillLevel,
    cookingTimeAvailable,
    setCookingTimeAvailable,
    toggleAllergen,
    setSeverity,
    toggleHealthCondition,
    toggleDislike,
    toggleCuisine,
    handleSave,
    haptics,
  };
}
