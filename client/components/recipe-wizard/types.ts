export const DIET_TAG_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Gluten Free",
  "Dairy Free",
  "Keto",
  "Paleo",
  "Low Carb",
  "High Protein",
] as const;

export type DietTag = (typeof DIET_TAG_OPTIONS)[number];

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Named step constants — prefer these over numeric literals in branch logic
// (`nextStep === STEP_TAGS` reads better than `nextStep === 6`).
export const STEP_TITLE: WizardStep = 1;
export const STEP_INGREDIENTS: WizardStep = 2;
export const STEP_INSTRUCTIONS: WizardStep = 3;
export const STEP_TIME_SERVINGS: WizardStep = 4;
export const STEP_NUTRITION: WizardStep = 5;
export const STEP_TAGS: WizardStep = 6;
export const STEP_PREVIEW: WizardStep = 7;

export interface StepConfig {
  step: WizardStep;
  title: string;
  subtitle: string;
  nextLabel: string;
}

export const STEP_CONFIGS: StepConfig[] = [
  {
    step: 1,
    title: "What are you making?",
    subtitle: "Give your recipe a name",
    nextLabel: "Ingredients",
  },
  {
    step: 2,
    title: "Ingredients",
    subtitle: "What goes into this recipe?",
    nextLabel: "Instructions",
  },
  {
    step: 3,
    title: "Instructions",
    subtitle: "How do you make it?",
    nextLabel: "Time & Servings",
  },
  {
    step: 4,
    title: "Time & Servings",
    subtitle: "How long does it take?",
    nextLabel: "Nutrition",
  },
  {
    step: 5,
    title: "Nutrition",
    subtitle: "Per serving (optional — skip if you don't know)",
    nextLabel: "Tags",
  },
  {
    step: 6,
    title: "Tags & Cuisine",
    subtitle: "We suggested some based on your recipe — edit as needed",
    nextLabel: "Preview",
  },
  {
    step: 7,
    title: "Preview",
    subtitle: "Review your recipe before saving",
    nextLabel: "Save",
  },
];

export const TOTAL_STEPS = 7;
