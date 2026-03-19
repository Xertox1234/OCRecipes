import { z } from "zod";
import { storage } from "../storage";
import { openai } from "../lib/openai";
import {
  detectAllergens,
  type AllergenMatch,
  type AllergySeverity,
} from "@shared/constants/allergens";
import { allergySchema } from "@shared/schema";

const menuItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  price: z.string().optional(),
  estimatedCalories: z.number(),
  estimatedProtein: z.number(),
  estimatedCarbs: z.number(),
  estimatedFat: z.number(),
  tags: z.array(z.string()), // e.g., ["high-protein", "vegetarian", "gluten-free"]
  recommendation: z.enum(["great", "good", "okay", "avoid"]).optional(),
  recommendationReason: z.string().optional(),
});

const menuAnalysisSchema = z.object({
  restaurantName: z.string().optional(),
  menuItems: z.array(menuItemSchema),
  cuisine: z.string().optional(),
});

export type MenuAnalysisItem = z.infer<typeof menuItemSchema>;
export type MenuAnalysisResult = z.infer<typeof menuAnalysisSchema> & {
  /** Per-item allergen flags keyed by item name. */
  allergenFlags?: Record<string, AllergenMatch>;
};

const MENU_ANALYSIS_PROMPT = `You are a nutrition expert analyzing a restaurant menu photo.
For each menu item visible:
1. Extract the item name and description
2. Extract price if visible
3. Estimate calories, protein (g), carbs (g), and fat (g) based on typical restaurant portions
4. Add relevant dietary tags: "high-protein", "low-carb", "vegetarian", "vegan", "gluten-free", "dairy-free", "spicy", "fried"
5. If user context is provided, rate each item: "great" (ideal for goals), "good" (fits goals), "okay" (acceptable), "avoid" (poor fit)
6. Provide a brief reason for the recommendation

Be realistic with calorie estimates — restaurant portions are typically larger than home-cooked.

Respond with JSON only:
{
  "restaurantName": "optional restaurant name if visible",
  "cuisine": "cuisine type if identifiable",
  "menuItems": [
    {
      "name": "item name",
      "description": "brief description",
      "price": "$12.99",
      "estimatedCalories": 650,
      "estimatedProtein": 35,
      "estimatedCarbs": 45,
      "estimatedFat": 25,
      "tags": ["high-protein"],
      "recommendation": "great",
      "recommendationReason": "High protein, fits your calorie target"
    }
  ]
}`;

export async function analyzeMenuPhoto(
  imageBase64: string,
  userId: string,
): Promise<MenuAnalysisResult> {
  // Build user context for personalized recommendations
  let userContext = "";
  try {
    const [user, profile] = await Promise.all([
      storage.getUser(userId),
      storage.getUserProfile(userId),
    ]);

    if (user) {
      const parts: string[] = [];
      if (user.dailyCalorieGoal)
        parts.push(`Daily calorie goal: ${user.dailyCalorieGoal}`);
      if (user.dailyProteinGoal)
        parts.push(`Daily protein goal: ${user.dailyProteinGoal}g`);
      if (profile?.dietType) parts.push(`Diet type: ${profile.dietType}`);
      if (profile?.primaryGoal) parts.push(`Goal: ${profile.primaryGoal}`);
      const allergies = profile?.allergies as
        | { name: string }[]
        | null
        | undefined;
      if (allergies?.length) {
        parts.push(`Allergies: ${allergies.map((a) => a.name).join(", ")}`);
      }
      const dislikes = profile?.foodDislikes as string[] | null | undefined;
      if (dislikes?.length) {
        parts.push(`Food dislikes: ${dislikes.join(", ")}`);
      }
      if (parts.length > 0) {
        userContext = `\n\nUser context for personalized recommendations:\n${parts.join("\n")}`;
      }
    }
  } catch {
    // Non-critical — proceed without personalization
  }

  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: MENU_ANALYSIS_PROMPT + userContext,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: "Analyze this restaurant menu and provide nutrition estimates for each item.",
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 4096,
      temperature: 0.3,
    });
  } catch (error) {
    console.error("Menu analysis API error:", error);
    throw new Error("Failed to analyze menu photo. Please try again.");
  }

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from menu analysis");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Menu analysis returned invalid data. Please try again.");
  }
  const validated = menuAnalysisSchema.parse(parsed);

  // Sort by recommendation: great > good > okay > avoid
  const order: Record<string, number> = {
    great: 0,
    good: 1,
    okay: 2,
    avoid: 3,
  };
  validated.menuItems.sort(
    (a, b) =>
      (order[a.recommendation || "okay"] ?? 2) -
      (order[b.recommendation || "okay"] ?? 2),
  );

  // Flag menu items containing user allergens
  let allergenFlags: Record<string, AllergenMatch> | undefined;
  try {
    const profile = await storage.getUserProfile(userId);
    const userAllergies: { name: string; severity: AllergySeverity }[] = [];
    const rawAllergies = profile?.allergies;
    if (Array.isArray(rawAllergies)) {
      for (const item of rawAllergies) {
        const parsed = allergySchema.safeParse(item);
        if (parsed.success) userAllergies.push(parsed.data);
      }
    }
    if (userAllergies.length > 0) {
      // Check both item name and description for allergen keywords
      const textToCheck = validated.menuItems.map(
        (item) => `${item.name} ${item.description || ""}`,
      );
      const matches = detectAllergens(textToCheck, userAllergies);
      if (matches.length > 0) {
        allergenFlags = {};
        for (const m of matches) {
          // Map the combined text back to the item name
          const idx = textToCheck.indexOf(m.ingredientName);
          const itemName = idx >= 0 ? validated.menuItems[idx].name : undefined;
          if (itemName && !allergenFlags[itemName]) {
            allergenFlags[itemName] = m;
          }
        }
      }
    }
  } catch {
    // Non-critical — menu analysis still works without allergen flags
  }

  return { ...validated, allergenFlags };
}
