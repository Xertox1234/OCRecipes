export const BEVERAGE_TYPES = [
  "water",
  "coffee",
  "tea",
  "milk",
  "soda",
  "custom",
] as const;
export type BeverageType = (typeof BEVERAGE_TYPES)[number];

export const BEVERAGE_SIZES = {
  small: { label: "Small", oz: 8, ml: 240 },
  medium: { label: "Medium", oz: 12, ml: 355 },
  large: { label: "Large", oz: 16, ml: 475 },
} as const;
export type BeverageSize = keyof typeof BEVERAGE_SIZES;

export const BEVERAGE_MODIFIERS = ["cream", "sugar"] as const;
export type BeverageModifier = (typeof BEVERAGE_MODIFIERS)[number];

/** Beverages that support cream/sugar modifier toggles */
export const MODIFIER_BEVERAGES: readonly BeverageType[] = ["coffee", "tea"];

/** Display metadata for each non-custom beverage (Feather icon names) */
export const BEVERAGE_DISPLAY: Record<
  Exclude<BeverageType, "custom">,
  { label: string; icon: string }
> = {
  water: { label: "Water", icon: "droplet" },
  coffee: { label: "Coffee", icon: "coffee" },
  tea: { label: "Tea", icon: "coffee" },
  milk: { label: "Milk", icon: "droplet" },
  soda: { label: "Soda", icon: "zap" },
};

/** Zero-calorie beverages that skip nutrition lookup */
export const ZERO_CAL_BEVERAGES: readonly BeverageType[] = ["water"];
