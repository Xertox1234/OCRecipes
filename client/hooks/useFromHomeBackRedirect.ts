import { usePreventRemove } from "@react-navigation/native";
import type { NavigationProp, ParamListBase } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";

interface FromHomeNavigation {
  dispatch: NavigationProp<ParamListBase>["dispatch"];
  getParent: NavigationProp<ParamListBase>["getParent"];
  setParams: (params: { fromHome: undefined }) => void;
}

// The native-stack header back button and the iOS swipe-back gesture both
// dispatch a StackActions.pop() ("POP"), not CommonActions.goBack()
// ("GO_BACK") — only an explicit navigation.goBack() call produces the
// latter. Both must be treated as "the user went back".
const BACK_ACTION_TYPES = new Set(["GO_BACK", "POP"]);

/**
 * A screen reached via a cross-tab shortcut from Home (e.g. "Grocery List",
 * "Create Cookbook") sits on top of the Plan tab's own initial route —
 * React Navigation inserts a nested navigator's initial screen beneath the
 * first screen it's asked to show inside that navigator. A plain back
 * action from here pops to that initial route (MealPlanHome), not back to
 * Home.
 *
 * Intercept the back action and redirect to HomeTab instead — but only for
 * an actual back gesture (GO_BACK/POP), never the screen's own forward
 * navigation (e.g. `replace("RecipeCreate", ...)`), which is re-dispatched
 * unchanged so it proceeds. Uses `usePreventRemove` rather than a hand-rolled
 * `beforeRemove` listener + `preventDefault()`: native-stack's own back
 * gesture/button isn't fully coordinated with a plain `preventDefault()` (the
 * native view can be torn down before JS blocks it, desyncing JS state from
 * the native screen stack) — `usePreventRemove` registers with native-stack's
 * `PreventRemoveContext` so it holds the native side back too. Only armed
 * while `fromHome` is set: clearing it after the redirect lets a later,
 * genuine visit to this screen via the Plan tab itself fall through to a
 * normal back action.
 */
export function useFromHomeBackRedirect(
  navigation: FromHomeNavigation,
  fromHome: boolean | undefined,
) {
  usePreventRemove(!!fromHome, (e) => {
    if (!BACK_ACTION_TYPES.has(e.data.action.type)) {
      navigation.dispatch(e.data.action);
      return;
    }
    navigation.setParams({ fromHome: undefined });
    navigation
      .getParent<BottomTabNavigationProp<MainTabParamList>>()
      ?.navigate("HomeTab");
  });
}
