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
      AllConversations: "conversation-list",
      NutritionDetail: "nutrition/:barcode",
      // Query params land in route.params unfiltered unless `parse` handles
      // them. ScanScreen forwards verifyBarcode into FrontLabelConfirm and the
      // verification submit, so a link must not choose the barcode a user's
      // label photo is credited to: drop it. `mode` stays linkable.
      Scan: {
        path: "scan",
        parse: { verifyBarcode: () => undefined },
      },
      // Drives the verify-email landing's success CTA (ocrecipes://login) to the
      // sign-in screen — pure navigation, no auth side effect.
      Login: "login",
      // ?token=… maps to route.params.token automatically (no positional param).
      VerifyEmail: "verify-email",
    },
  },
};
