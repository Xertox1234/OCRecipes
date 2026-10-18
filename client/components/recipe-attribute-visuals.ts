import type React from "react";
import type { MaterialCommunityIcons } from "@expo/vector-icons";
import type { AllergenId } from "@shared/constants/allergens";
import type { RecipeAttributeId } from "@shared/constants/recipe-attributes";
import {
  BADGE_SEVERITY_FILL_OPACITY,
  LOW_SEVERITY_VISUALS,
  type BadgeSeverityColorKey,
} from "./badge-severity-visuals";

export type AttributeIconName = React.ComponentProps<
  typeof MaterialCommunityIcons
>["name"];

/** Same fill as the severity badges, so the contrast suite covers the chips. */
export const ATTRIBUTE_CHIP_FILL_OPACITY = BADGE_SEVERITY_FILL_OPACITY;

export const RECIPE_ATTRIBUTE_VISUALS: Record<
  RecipeAttributeId,
  { icon: AttributeIconName; colorKey: BadgeSeverityColorKey }
> = {
  vegetarian: { icon: "leaf", colorKey: "badgeSuccessText" },
  vegan: { icon: "sprout", colorKey: "badgeSuccessText" },
  gluten_free: { icon: "barley-off", colorKey: "badgeSuccessText" },
  dairy_free: { icon: "cheese-off", colorKey: "badgeSuccessText" },
  quick: { icon: "timer-outline", colorKey: "badgeNeutralText" },
};

/** The "Contains:" chips keep today's mild-allergen colour. */
export const CONTAINS_COLOR_KEY: BadgeSeverityColorKey =
  LOW_SEVERITY_VISUALS.colorKey;

// The set has no shellfish or sesame glyph; the chip's word carries the meaning.
export const ALLERGEN_ICON: Record<AllergenId, AttributeIconName> = {
  peanuts: "peanut",
  tree_nuts: "nut",
  milk: "cheese",
  eggs: "egg-outline",
  wheat: "barley",
  soy: "soy-sauce",
  fish: "fish",
  shellfish: "jellyfish-outline",
  sesame: "seed-outline",
};
