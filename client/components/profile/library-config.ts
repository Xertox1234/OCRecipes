import type { ComponentProps } from "react";
import type { Feather } from "@expo/vector-icons";
import type { LibraryCountsResponse } from "@shared/schemas/profile-hub";
import type { PremiumFeatureKey } from "@shared/types/premium";
import type { ProfileScreenNavigationProp } from "@/types/navigation";

type FeatherIconName = ComponentProps<typeof Feather>["name"];
type CountKey = keyof LibraryCountsResponse;

export interface LibraryItem {
  readonly id: string;
  readonly icon: FeatherIconName;
  readonly label: string;
  readonly countKey: CountKey;
  readonly premiumKey?: PremiumFeatureKey;
  /** Hide the tile while its count is 0 (Weekly Reports: nothing to open yet). */
  readonly hideWhenZero?: boolean;
}

export const LIBRARY_ITEMS: readonly LibraryItem[] = [
  {
    id: "favourites",
    icon: "heart",
    label: "Favourites",
    countKey: "favouriteRecipes",
  },
  {
    id: "cookbooks",
    icon: "book-open",
    label: "Cookbooks",
    countKey: "cookbooks",
  },
  {
    id: "savedItems",
    icon: "bookmark",
    label: "Saved Items",
    countKey: "savedItems",
  },
  {
    id: "scanHistory",
    icon: "clock",
    label: "Scan History",
    countKey: "scanHistory",
  },
  {
    id: "groceryLists",
    icon: "shopping-cart",
    label: "Grocery Lists",
    countKey: "groceryLists",
  },
  {
    id: "pantry",
    icon: "package",
    label: "Pantry",
    countKey: "pantryItems",
    premiumKey: "pantryTracking",
  },
  {
    id: "recipes",
    icon: "star",
    label: "Recipe Catalog",
    countKey: "featuredRecipes",
  },
  // No premiumKey: generating a report is Coach Pro, but reading your own
  // past reports never is (a lapsed Pro user keeps them).
  {
    id: "weeklyReports",
    icon: "trending-up",
    label: "Weekly Reports",
    countKey: "weeklyReports",
    hideWhenZero: true,
  },
];

export function visibleLibraryItems(
  items: readonly LibraryItem[],
  counts: LibraryCountsResponse,
): LibraryItem[] {
  return items.filter((i) => !i.hideWhenZero || (counts[i.countKey] ?? 0) > 0);
}

/** Switch-based navigation — follows action-config.ts pattern. */
export function navigateLibraryItem(
  id: string,
  navigation: ProfileScreenNavigationProp,
) {
  switch (id) {
    case "favourites":
      navigation.navigate("FavouriteRecipes");
      break;
    case "cookbooks":
      navigation.navigate("CookbookList");
      break;
    case "savedItems":
      navigation.navigate("SavedItems");
      break;
    case "scanHistory":
      navigation.navigate("ScanHistory");
      break;
    case "groceryLists":
      navigation.navigate("GroceryLists");
      break;
    case "pantry":
      navigation.navigate("Pantry");
      break;
    case "recipes":
      navigation.navigate("RecipeBrowser", {});
      break;
    case "weeklyReports":
      navigation.navigate("WeeklyReports");
      break;
  }
}

/**
 * The tile's screen-reader label, with the noun agreeing with the count
 * ("1 item", "16 items"); locked premium tiles say so.
 */
export function libraryTileLabel(
  label: string,
  count: number,
  locked: boolean,
): string {
  const noun = count === 1 ? "item" : "items";
  const base = `${label}: ${count} ${noun}`;
  return locked ? `${base}. Premium feature, locked` : base;
}
