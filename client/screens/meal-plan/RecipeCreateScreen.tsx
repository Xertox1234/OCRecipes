import React, { useCallback, useRef } from "react";
import { Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import WizardShell from "@/components/recipe-wizard/WizardShell";

type RecipeCreateScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeCreate"
>;

type RecipeCreateRouteProp = RouteProp<MealPlanStackParamList, "RecipeCreate">;

export default function RecipeCreateScreen() {
  const navigation = useNavigation<RecipeCreateScreenNavigationProp>();
  const route = useRoute<RecipeCreateRouteProp>();
  const { prefill, returnToMealPlan } = route.params ?? {};
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSaveComplete = useCallback(() => {
    isSavingRef.current = true;
    if (returnToMealPlan) {
      navigation.popToTop();
    } else {
      navigation.goBack();
    }
  }, [navigation, returnToMealPlan]);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
  }, []);

  const handleSavingChange = useCallback((saving: boolean) => {
    isSavingRef.current = saving;
  }, []);

  // Guard against hardware back button / swipe-back gesture
  React.useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (isSavingRef.current) return;
      if (!isDirtyRef.current) return;

      e.preventDefault();
      Alert.alert(
        "Discard changes?",
        "You have unsaved changes. Are you sure you want to go back?",
        [
          { text: "Keep editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => navigation.dispatch(e.data.action),
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation]);

  return (
    <WizardShell
      prefill={prefill}
      returnToMealPlan={returnToMealPlan}
      onGoBack={handleGoBack}
      onSaveComplete={handleSaveComplete}
      onDirtyChange={handleDirtyChange}
      onSavingChange={handleSavingChange}
    />
  );
}
