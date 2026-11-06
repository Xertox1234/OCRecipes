import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

import { HeaderTitle } from "@/components/HeaderTitle";

/**
 * Header options for the library screens (grocery lists, pantry, cookbooks)
 * that the Plan, Coach and Profile stacks each register. Each navigator keeps
 * its own `<Stack.Screen name=… component=…>` lines — the route-reachability
 * and sheet-provider guards read those from the navigator source — and takes
 * the options from here, so a title is written once.
 */
function titleOnly(title: string): NativeStackNavigationOptions {
  return {
    headerTitle: () => <HeaderTitle title={title} showIcon={false} />,
  };
}

export const LIBRARY_SCREEN_OPTIONS = {
  GroceryLists: titleOnly("Grocery Lists"),
  GroceryList: titleOnly("Grocery List"),
  Pantry: titleOnly("Pantry"),
  CookbookList: titleOnly("Cookbooks"),
  CookbookDetail: titleOnly("Cookbook"),
} satisfies Record<string, NativeStackNavigationOptions>;

/** CookbookCreate doubles as the edit screen: the title follows the mode. */
export function cookbookCreateOptions({
  route,
}: {
  route: { params?: { cookbookId?: number } };
}): NativeStackNavigationOptions {
  return titleOnly(route.params?.cookbookId ? "Edit Cookbook" : "New Cookbook");
}
