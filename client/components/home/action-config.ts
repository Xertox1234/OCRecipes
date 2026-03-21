import type { HomeScreenNavigationProp } from "@/types/navigation";

export interface HomeAction {
  id: string;
  group: "scanning" | "nutrition" | "recipes" | "planning";
  icon: string;
  label: string;
  subtitle?: string;
  premium?: boolean;
}

/** Navigation handler for each action. Separated from config for testability. */
export function navigateAction(
  action: HomeAction,
  navigation: HomeScreenNavigationProp,
) {
  switch (action.id) {
    // Camera & Scanning
    case "scan-barcode":
      navigation.navigate("Scan");
      break;
    case "scan-receipt":
      navigation.navigate("ReceiptCapture");
      break;
    case "scan-menu":
      navigation.navigate("Scan");
      break;
    case "photo-food-log":
      navigation.navigate("Scan");
      break;
    case "scan-nutrition-label":
      navigation.navigate("Scan", { mode: "label" });
      break;
    case "batch-scan":
      navigation.navigate("BatchScan");
      break;

    // Nutrition & Health
    case "quick-log":
      navigation.navigate("QuickLog");
      break;
    case "voice-log":
      navigation.navigate("QuickLog");
      break;
    case "fasting-timer":
      navigation.navigate("Fasting");
      break;
    case "log-weight":
      navigation.navigate("ProfileTab", { screen: "WeightTracking" });
      break;
    case "ai-coach":
      navigation.navigate("CoachTab", { screen: "ChatList" });
      break;

    // Recipes
    case "search-recipes":
      navigation.navigate("MealPlanTab", {
        screen: "RecipeBrowser",
        params: {},
      });
      break;
    case "generate-recipe":
      navigation.navigate("MealPlanTab", {
        screen: "RecipeCreate",
        params: {},
      });
      break;
    case "import-recipe":
      navigation.navigate("MealPlanTab", {
        screen: "RecipeImport",
      });
      break;
    case "create-cookbook":
      navigation.navigate("MealPlanTab", {
        screen: "CookbookCreate",
      });
      break;

    // Planning
    case "meal-plan":
      navigation.navigate("MealPlanTab", {
        screen: "MealPlanHome",
      });
      break;
    case "grocery-list":
      navigation.navigate("MealPlanTab", {
        screen: "GroceryLists",
      });
      break;
    case "pantry":
      navigation.navigate("MealPlanTab", {
        screen: "Pantry",
      });
      break;
  }
}

export const HOME_ACTIONS: HomeAction[] = [
  // Camera & Scanning
  {
    id: "scan-barcode",
    group: "scanning",
    icon: "maximize",
    label: "Scan Barcode",
  },
  {
    id: "scan-receipt",
    group: "scanning",
    icon: "shopping-bag",
    label: "Scan Receipt",
  },
  {
    id: "scan-menu",
    group: "scanning",
    icon: "menu",
    label: "Scan Menu",
  },
  {
    id: "photo-food-log",
    group: "scanning",
    icon: "camera",
    label: "Photo Food Log",
  },
  {
    id: "scan-nutrition-label",
    group: "scanning",
    icon: "file-text",
    label: "Scan Nutrition Label",
  },
  {
    id: "batch-scan",
    group: "scanning",
    icon: "layers",
    label: "Batch Scan",
    subtitle: "Scan multiple barcodes",
  },

  // Nutrition & Health
  {
    id: "quick-log",
    group: "nutrition",
    icon: "edit-3",
    label: "Quick Log",
  },
  {
    id: "voice-log",
    group: "nutrition",
    icon: "mic",
    label: "Voice Log",
  },
  {
    id: "fasting-timer",
    group: "nutrition",
    icon: "clock",
    label: "Fasting Timer",
  },
  {
    id: "log-weight",
    group: "nutrition",
    icon: "trending-down",
    label: "Log Weight",
  },
  {
    id: "ai-coach",
    group: "nutrition",
    icon: "message-circle",
    label: "AI Coach",
  },

  // Recipes
  {
    id: "search-recipes",
    group: "recipes",
    icon: "search",
    label: "Search Recipes",
    subtitle: "Browse the recipe catalog",
  },
  {
    id: "generate-recipe",
    group: "recipes",
    icon: "zap",
    label: "Generate Recipe",
    subtitle: "AI-powered recipe creation",
    premium: true,
  },
  {
    id: "import-recipe",
    group: "recipes",
    icon: "download",
    label: "Import Recipe",
    subtitle: "Import from a URL",
  },
  {
    id: "create-cookbook",
    group: "recipes",
    icon: "book",
    label: "Create Cookbook",
    subtitle: "Organize your recipe collections",
  },

  // Planning
  {
    id: "meal-plan",
    group: "planning",
    icon: "calendar",
    label: "Meal Plan",
    subtitle: "Plan your weekly meals",
  },
  {
    id: "grocery-list",
    group: "planning",
    icon: "shopping-cart",
    label: "Grocery List",
    subtitle: "Manage shopping lists",
  },
  {
    id: "pantry",
    group: "planning",
    icon: "package",
    label: "Pantry",
    subtitle: "Track what you have",
  },
];

/** Get actions for a specific group */
export function getActionsByGroup(group: HomeAction["group"]): HomeAction[] {
  return HOME_ACTIONS.filter((a) => a.group === group);
}
