import type { FeatureTipId } from "../schemas/coach-weekly-report";

/**
 * Copy for the weekly report's "Did you know?" and "Try this week" cards.
 * Shared so the server picks ids and the app renders the same words. `target`
 * is an in-app destination the app resolves to a navigation call — not a deep
 * link, so a tip never widens what a link from outside can open.
 */
export type FeatureTipTarget =
  | "scanBarcode"
  | "scanPhoto"
  | "importRecipe"
  | "pantry"
  | "mealPlan"
  | "voiceRecipe"
  | "cookbooks";

export interface FeatureTip {
  title: string;
  body: string;
  actionLabel: string;
  target: FeatureTipTarget;
}

export const FEATURE_TIPS: Record<FeatureTipId, FeatureTip> = {
  barcode: {
    title: "Scan before you buy",
    body: "Scan the barcode on any grocery item to see its nutrition, macros and allergens before it goes in your basket.",
    actionLabel: "Scan something",
    target: "scanBarcode",
  },
  photo: {
    title: "Log a meal with one photo",
    body: "Point the camera at your plate and confirm what it found. No typing, no searching.",
    actionLabel: "Open the camera",
    target: "scanPhoto",
  },
  import: {
    title: "Make any recipe yours",
    body: "Photograph a cookbook page or paste a link, and it becomes a recipe with nutrition worked out.",
    actionLabel: "Import a recipe",
    target: "importRecipe",
  },
  pantry: {
    title: "Cook from what you have",
    body: "Coach can see your pantry. Add what's in your kitchen and ask “what can I make tonight?” It uses up what expires first.",
    actionLabel: "Set up my pantry",
    target: "pantry",
  },
  mealPlan: {
    title: "Plan the week in one go",
    body: "Drop recipes onto the days ahead and your grocery list builds itself, sized to the servings you planned.",
    actionLabel: "Plan my week",
    target: "mealPlan",
  },
  voice: {
    title: "Say what you feel like cooking",
    body: "Tap the mic and describe a dish in your own words, and Coach turns it into a recipe that fits your goals.",
    actionLabel: "Try it by voice",
    target: "voiceRecipe",
  },
  cookbooks: {
    title: "Keep your favourites together",
    body: "Group recipes into cookbooks, like weeknight dinners or batch cooking, so the ones you love are a tap away.",
    actionLabel: "Make a cookbook",
    target: "cookbooks",
  },
};
