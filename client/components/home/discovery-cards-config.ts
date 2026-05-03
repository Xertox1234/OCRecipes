export interface DiscoveryCard {
  id: string;
  eyebrow: string;
  headline: string;
  subtitle: string;
  emoji: string;
  ctaLabel: string;
}

export const DISCOVERY_CARDS: DiscoveryCard[] = [
  {
    id: "scan-receipt",
    eyebrow: "✨ Try this",
    headline: "Scan receipts to fill your pantry instantly",
    subtitle: "Point your camera at any grocery receipt.",
    emoji: "📷",
    ctaLabel: "Scan Now",
  },
  {
    id: "photo-food-log",
    eyebrow: "✨ Try this",
    headline: "Log food by snapping a photo",
    subtitle: "No searching — just point and shoot.",
    emoji: "📷",
    ctaLabel: "Try Photo Log",
  },
  {
    id: "scan-menu",
    eyebrow: "✨ Try this",
    headline: "Point at a restaurant menu to track your meal",
    subtitle: "Works at any restaurant or café.",
    emoji: "🍽",
    ctaLabel: "Scan a Menu",
  },
  {
    id: "scan-nutrition-label",
    eyebrow: "✨ Try this",
    headline: "Scan nutrition labels for instant, accurate data",
    subtitle: "More reliable than barcode lookup.",
    emoji: "📋",
    ctaLabel: "Scan a Label",
  },
  {
    id: "batch-scan",
    eyebrow: "✨ Try this",
    headline: "Scan multiple barcodes at once",
    subtitle: "Bulk-log a whole grocery haul in seconds.",
    emoji: "📦",
    ctaLabel: "Try Batch Scan",
  },
  {
    id: "meal-plan",
    eyebrow: "✨ Try this",
    headline: "Plan your week's meals and hit your goals",
    subtitle: "Auto-generates your grocery list too.",
    emoji: "📅",
    ctaLabel: "Start Planning",
  },
  {
    id: "grocery-list",
    eyebrow: "✨ Try this",
    headline: "Build smart shopping lists from your meal plan",
    subtitle: "One tap from your weekly plan to the shop.",
    emoji: "🛒",
    ctaLabel: "Create a List",
  },
  {
    id: "pantry",
    eyebrow: "✨ Try this",
    headline: "Track what's in your kitchen",
    subtitle: "Never waste food or duplicate ingredients.",
    emoji: "🥫",
    ctaLabel: "Open Pantry",
  },
  {
    id: "generate-recipe",
    eyebrow: "✨ Try this",
    headline: "Generate custom recipes tailored to your goals",
    subtitle: "AI-powered and ready to cook.",
    emoji: "⚡",
    ctaLabel: "Generate Recipe",
  },
  {
    id: "import-recipe",
    eyebrow: "✨ Try this",
    headline: "Import any recipe from a website in seconds",
    subtitle: "Paste a URL and we'll parse the rest.",
    emoji: "🔗",
    ctaLabel: "Import a Recipe",
  },
];
