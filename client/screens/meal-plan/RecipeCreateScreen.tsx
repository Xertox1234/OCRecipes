import { useCallback, useRef } from "react";
import { Alert } from "react-native";
import {
  useNavigation,
  useRoute,
  usePreventRemove,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";
import WizardShell from "@/components/recipe-wizard/WizardShell";

// The native-stack header back button and the iOS swipe-back gesture both
// dispatch a StackActions.pop() ("POP"), not CommonActions.goBack()
// ("GO_BACK") — only an explicit navigation.goBack() call produces the
// latter. Both mean "the user went back".
const BACK_ACTION_TYPES = new Set(["GO_BACK", "POP"]);

type RecipeCreateScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeCreate"
>;

type RecipeCreateRouteProp = RouteProp<MealPlanStackParamList, "RecipeCreate">;

export default function RecipeCreateScreen() {
  const navigation = useNavigation<RecipeCreateScreenNavigationProp>();
  const route = useRoute<RecipeCreateRouteProp>();
  const { prefill, returnToMealPlan, fromHome } = route.params ?? {};
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

  // Guard against hardware back button / swipe-back gesture. Also redirects
  // to Home instead of MealPlanHome when this screen was reached (via
  // RecipeImport/RecipePhotoImport) from Home — see useFromHomeBackRedirect's
  // doc comment for why a plain back action lands in the wrong place, and why
  // this uses usePreventRemove rather than a hand-rolled beforeRemove
  // listener + preventDefault() (native-stack's own back gesture isn't fully
  // coordinated with a plain preventDefault(), which desyncs JS state from
  // the native screen stack). Always armed (not just while dirty/fromHome)
  // so the discard confirm and the redirect share one interception point —
  // running both off separate conditions would race an Alert against an
  // immediate tab switch.
  usePreventRemove(true, (e) => {
    if (isSavingRef.current) {
      navigation.dispatch(e.data.action);
      return;
    }

    const redirectHome = () => {
      navigation.setParams({ fromHome: undefined });
      navigation
        .getParent<BottomTabNavigationProp<MainTabParamList>>()
        ?.navigate("HomeTab");
    };
    const isBackFromHome =
      fromHome && BACK_ACTION_TYPES.has(e.data.action.type);

    if (isDirtyRef.current) {
      Alert.alert(
        "Discard changes?",
        "You have unsaved changes. Are you sure you want to go back?",
        [
          { text: "Keep editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              if (isBackFromHome) {
                redirectHome();
              } else {
                navigation.dispatch(e.data.action);
              }
            },
          },
        ],
      );
      return;
    }

    if (isBackFromHome) {
      redirectHome();
    } else {
      navigation.dispatch(e.data.action);
    }
  });

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
