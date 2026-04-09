import { ComponentProps } from "react";
import { Feather } from "@expo/vector-icons";

type FeatherIconName = ComponentProps<typeof Feather>["name"];

export interface AllergenOption {
  id: string;
  name: string;
  icon: FeatherIconName;
}

export interface SeverityOption {
  value: "mild" | "moderate" | "severe";
  label: string;
  description: string;
}

export interface DietTypeOption {
  id: string;
  name: string;
  description: string;
  icon: FeatherIconName;
}

export interface HealthConditionOption {
  id: string;
  name: string;
  icon: FeatherIconName;
  description: string;
}

export interface GoalOption {
  id: string;
  name: string;
  icon: FeatherIconName;
  color: string;
}

export interface ActivityLevelOption {
  id: string;
  name: string;
  description: string;
}

export interface CuisineOption {
  id: string;
  name: string;
}

export interface SkillLevelOption {
  id: string;
  name: string;
  description: string;
}

export interface CookingTimeOption {
  id: string;
  name: string;
  description: string;
}

export interface FoodDislikeOption {
  id: string;
  name: string;
}

export const COMMON_ALLERGENS: AllergenOption[] = [
  { id: "peanuts", name: "Peanuts", icon: "alert-circle" },
  { id: "tree_nuts", name: "Tree Nuts", icon: "alert-circle" },
  { id: "milk", name: "Dairy/Milk", icon: "droplet" },
  { id: "eggs", name: "Eggs", icon: "circle" },
  { id: "wheat", name: "Wheat/Gluten", icon: "layers" },
  { id: "soy", name: "Soy", icon: "square" },
  { id: "fish", name: "Fish", icon: "anchor" },
  { id: "shellfish", name: "Shellfish", icon: "anchor" },
  { id: "sesame", name: "Sesame", icon: "circle" },
];

export const SEVERITY_OPTIONS: SeverityOption[] = [
  { value: "mild", label: "Mild", description: "Slight discomfort" },
  { value: "moderate", label: "Moderate", description: "Noticeable reaction" },
  { value: "severe", label: "Severe", description: "Life-threatening" },
];

export const DIET_TYPES: DietTypeOption[] = [
  {
    id: "omnivore",
    name: "Omnivore",
    description: "I eat everything",
    icon: "globe",
  },
  {
    id: "vegetarian",
    name: "Vegetarian",
    description: "No meat or fish",
    icon: "feather",
  },
  {
    id: "vegan",
    name: "Vegan",
    description: "No animal products",
    icon: "sun",
  },
  {
    id: "pescatarian",
    name: "Pescatarian",
    description: "Vegetarian + fish",
    icon: "anchor",
  },
  {
    id: "keto",
    name: "Keto",
    description: "Very low carb, high fat",
    icon: "zap",
  },
  {
    id: "paleo",
    name: "Paleo",
    description: "Whole foods, no grains",
    icon: "sun",
  },
  {
    id: "mediterranean",
    name: "Mediterranean",
    description: "Plant-based, healthy fats",
    icon: "droplet",
  },
  {
    id: "halal",
    name: "Halal",
    description: "Islamic dietary laws",
    icon: "moon",
  },
  {
    id: "kosher",
    name: "Kosher",
    description: "Jewish dietary laws",
    icon: "star",
  },
  {
    id: "low_fodmap",
    name: "Low FODMAP",
    description: "For digestive health",
    icon: "activity",
  },
];

export const HEALTH_CONDITIONS: HealthConditionOption[] = [
  {
    id: "diabetes_type1",
    name: "Type 1 Diabetes",
    icon: "activity",
    description: "Need to monitor carbs and sugar",
  },
  {
    id: "diabetes_type2",
    name: "Type 2 Diabetes",
    icon: "activity",
    description: "Managing blood sugar levels",
  },
  {
    id: "heart_disease",
    name: "Heart Condition",
    icon: "heart",
    description: "Low sodium, heart-healthy diet",
  },
  {
    id: "high_blood_pressure",
    name: "High Blood Pressure",
    icon: "trending-up",
    description: "Limiting salt intake",
  },
  {
    id: "high_cholesterol",
    name: "High Cholesterol",
    icon: "bar-chart-2",
    description: "Watching fats and cholesterol",
  },
  {
    id: "ibs",
    name: "IBS",
    icon: "zap",
    description: "Avoiding trigger foods",
  },
  {
    id: "celiac",
    name: "Celiac Disease",
    icon: "slash",
    description: "Strict gluten-free required",
  },
  {
    id: "kidney_disease",
    name: "Kidney Condition",
    icon: "filter",
    description: "Managing protein and minerals",
  },
  {
    id: "pcos",
    name: "PCOS",
    icon: "circle",
    description: "Hormone-balancing nutrition",
  },
  {
    id: "gerd",
    name: "GERD/Acid Reflux",
    icon: "droplet",
    description: "Avoiding acidic foods",
  },
];

export const GOALS: GoalOption[] = [
  {
    id: "lose_weight",
    name: "Lose Weight",
    icon: "trending-down",
    color: "#C94E1A",
  },
  {
    id: "gain_muscle",
    name: "Build Muscle",
    icon: "trending-up",
    color: "#008A38",
  },
  { id: "maintain", name: "Maintain Weight", icon: "minus", color: "#2196F3" },
  {
    id: "eat_healthier",
    name: "Eat Healthier",
    icon: "heart",
    color: "#E91E63",
  },
  {
    id: "manage_condition",
    name: "Manage Condition",
    icon: "activity",
    color: "#9C27B0",
  },
];

export const ACTIVITY_LEVELS: ActivityLevelOption[] = [
  { id: "sedentary", name: "Sedentary", description: "Little to no exercise" },
  {
    id: "light",
    name: "Lightly Active",
    description: "Light exercise 1-3 days/week",
  },
  {
    id: "moderate",
    name: "Moderately Active",
    description: "Moderate exercise 3-5 days/week",
  },
  {
    id: "active",
    name: "Very Active",
    description: "Hard exercise 6-7 days/week",
  },
  {
    id: "athlete",
    name: "Athlete",
    description: "Professional or intense training",
  },
];

export const COMMON_DISLIKES: FoodDislikeOption[] = [
  { id: "cilantro", name: "Cilantro" },
  { id: "olives", name: "Olives" },
  { id: "mushrooms", name: "Mushrooms" },
  { id: "anchovies", name: "Anchovies" },
  { id: "blue_cheese", name: "Blue Cheese" },
  { id: "liver", name: "Liver/Organ Meats" },
  { id: "brussels_sprouts", name: "Brussels Sprouts" },
  { id: "tofu", name: "Tofu" },
  { id: "beets", name: "Beets" },
  { id: "okra", name: "Okra" },
  { id: "eggplant", name: "Eggplant" },
  { id: "coconut", name: "Coconut" },
];

export const CUISINES: CuisineOption[] = [
  { id: "american", name: "American" },
  { id: "italian", name: "Italian" },
  { id: "mexican", name: "Mexican" },
  { id: "chinese", name: "Chinese" },
  { id: "japanese", name: "Japanese" },
  { id: "indian", name: "Indian" },
  { id: "thai", name: "Thai" },
  { id: "mediterranean", name: "Mediterranean" },
  { id: "korean", name: "Korean" },
  { id: "vietnamese", name: "Vietnamese" },
  { id: "french", name: "French" },
  { id: "greek", name: "Greek" },
];

export const SKILL_LEVELS: SkillLevelOption[] = [
  {
    id: "beginner",
    name: "Beginner",
    description: "Simple recipes, basic techniques",
  },
  {
    id: "intermediate",
    name: "Intermediate",
    description: "Comfortable with most recipes",
  },
  {
    id: "advanced",
    name: "Advanced",
    description: "Complex techniques welcome",
  },
];

export const COOKING_TIMES: CookingTimeOption[] = [
  { id: "quick", name: "Quick", description: "Under 30 minutes" },
  { id: "moderate", name: "Moderate", description: "30-60 minutes" },
  { id: "leisurely", name: "Leisurely", description: "1+ hours, no rush" },
];

// Label lookups for display (used in ProfileScreen)
export const DIET_LABELS: Record<string, string> = Object.fromEntries(
  DIET_TYPES.map((d) => [d.id, d.name]),
);

export const GOAL_LABELS: Record<string, string> = Object.fromEntries(
  GOALS.map((g) => [g.id, g.name]),
);

export const ACTIVITY_LABELS: Record<string, string> = Object.fromEntries(
  ACTIVITY_LEVELS.map((a) => [a.id, a.name]),
);

export const SKILL_LABELS: Record<string, string> = Object.fromEntries(
  SKILL_LEVELS.map((s) => [s.id, s.name]),
);

export const TIME_LABELS: Record<string, string> = Object.fromEntries(
  COOKING_TIMES.map((t) => [t.id, t.name]),
);

export const CONDITION_LABELS: Record<string, string> = Object.fromEntries(
  HEALTH_CONDITIONS.map((c) => [c.id, c.name]),
);

export const ALLERGEN_LABELS: Record<string, string> = Object.fromEntries(
  COMMON_ALLERGENS.map((a) => [a.id, a.name]),
);
