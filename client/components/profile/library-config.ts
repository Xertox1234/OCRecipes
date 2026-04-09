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
    label: "Recipes",
    countKey: "featuredRecipes",
  },
];

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
      navigation.navigate("CookbookListModal");
      break;
    case "savedItems":
      navigation.navigate("SavedItems");
      break;
    case "scanHistory":
      navigation.navigate("ScanHistory", { showAll: true });
      break;
    case "groceryLists":
      navigation.navigate("GroceryListsModal");
      break;
    case "pantry":
      navigation.navigate("PantryModal");
      break;
    case "recipes":
      navigation.navigate("RecipeBrowserModal");
      break;
  }
}
