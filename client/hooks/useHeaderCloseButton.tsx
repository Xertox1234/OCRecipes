import { useCallback, useLayoutEffect } from "react";
import { Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

type PlanStackNavigation = Pick<
  NativeStackNavigationProp<MealPlanStackParamList>,
  "goBack" | "popTo" | "getState" | "setOptions"
> & { getParent: () => { navigate: (screen: "HomeTab") => void } | undefined };

/**
 * A Plan-stack screen that Home can open directly (a nested `navigate`) needs
 * its own close control: when the Plan tab was never mounted, that screen is
 * the ONLY route in the stack, so native-stack draws no back chevron and the
 * screen is a dead end.
 *
 * `dismiss` leaves the screen and REMOVES it from the Plan stack. Don't branch
 * on `canGoBack()`: it bubbles — it is true whenever any PARENT can go back,
 * and the tab router can always go back to Home. In the one-route case
 * `goBack()` went to the TAB navigator: Home was shown, this route was never
 * removed, and the screen reappeared on every return to Plan. With a route
 * beneath, `goBack()` is intercepted by `useFromHomeBackRedirect`, which also
 * shows Home while leaving the screen mounted.
 *
 * So only an in-Plan visit with a route in this stack's OWN state goes back.
 * Otherwise `popTo("MealPlanHome")` removes this route (adding MealPlanHome if
 * the stack never had it) — "POP_TO" isn't a back action, so
 * `useFromHomeBackRedirect` re-dispatches it unchanged — and a Home visit then
 * shows Home. `headerBackVisible: false` keeps the native chevron from
 * doubling up when there IS a route beneath.
 *
 * `disabled` re-registers the control as disabled (e.g. while a save runs),
 * so it can't leave mid-request.
 */
export function useHeaderCloseButton(
  navigation: PlanStackNavigation,
  fromHome: boolean | undefined,
  accessibilityLabel: string,
  disabled = false,
) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const dismiss = useCallback(() => {
    if (!fromHome && navigation.getState().routes.length > 1) {
      navigation.goBack();
      return;
    }
    navigation.popTo("MealPlanHome");
    if (fromHome) navigation.getParent()?.navigate("HomeTab");
  }, [fromHome, navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => (
        <Pressable
          onPress={() => {
            haptics.selection();
            dismiss();
          }}
          disabled={disabled}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={{ marginLeft: Spacing.xs }}
        >
          <Feather
            name="x"
            size={24}
            color={disabled ? theme.textSecondary : theme.text}
          />
        </Pressable>
      ),
    });
  }, [
    navigation,
    dismiss,
    haptics,
    theme.text,
    theme.textSecondary,
    accessibilityLabel,
    disabled,
  ]);

  return dismiss;
}
