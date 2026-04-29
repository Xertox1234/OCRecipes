import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./RootStackNavigator";

function parseIntOrZero(value: string): number {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? 0 : num;
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["ocrecipes://", "https://ocrecipes.app"],
  config: {
    screens: {
      Main: {
        screens: {
          CoachTab: {
            screens: {
              Chat: {
                path: "chat/:conversationId",
                parse: { conversationId: parseIntOrZero },
              },
            },
          },
        },
      },
      FeaturedRecipeDetail: {
        path: "recipe/:recipeId",
        parse: {
          recipeId: parseIntOrZero,
          type: (value: string) =>
            value === "mealPlan" ? "mealPlan" : "community",
        },
      },
      RecipeChat: {
        path: "recipe-chat/:conversationId?",
        parse: { conversationId: parseIntOrZero },
      },
      NotebookEntry: {
        path: "notebook-entry/:entryId",
        parse: { entryId: parseIntOrZero },
      },
      NutritionDetail: "nutrition/:barcode",
      Scan: "scan",
    },
  },
};
