/**
 * Drivers for the 8 vision rows in `npm run ai:backup-gate` (PR 4 of the
 * Vertex backup rollout; owner 2026-11-03). Each calls the row's REAL service
 * function on one photo of the kind the feature is for. These services throw
 * on a bad reply, but an empty list or a null key field is also a miss for a
 * photo that plainly has content — `visionDegraded` reports those.
 *
 * Every image was looked at before it was picked (the photo judge lesson:
 * a description is not ground truth). Wikimedia Commons, except the salad,
 * which is the photo-analysis eval set's. Re-encoded to JPEG because most of
 * these services label the data URL image/jpeg whatever they were sent.
 *
 * Imported lazily by ai-backup-gate.ts after dotenv has loaded.
 */
import { randomUUID } from "node:crypto";
import type { AiFeature } from "../server/lib/ai-models";
import type { DriverOutcome } from "./ai-backup-gate-text-rows";

type Driver = () => Promise<DriverOutcome>;

const SALAD =
  "https://images.unsplash.com/photo-1607532941433-304659e8198a?w=400";
const COMMONS = "https://upload.wikimedia.org/wikipedia/commons";

export const VISION_ROW_IMAGES: Partial<Record<AiFeature, string>> = {
  "recipe-chat-image": SALAD,
  "photo-classify": SALAD,
  // Printed recipe card, "Pedernales River Chili".
  "photo-recipe": `${COMMONS}/thumb/a/a6/Recipe_Card_for_Pedernales_River_Chili_-_DPLA_-_3d1051a803e0ab4b9f54b5aada0409ed.jpg/1280px-Recipe_Card_for_Pedernales_River_Chili_-_DPLA_-_3d1051a803e0ab4b9f54b5aada0409ed.jpg`,
  // FDA Nutrition Facts label (2016 format), 230 kcal.
  "photo-label": `${COMMONS}/e/e9/FDA_Nutrition_Facts_Label_2016.png`,
  // Tesco till receipt, 10 grocery items.
  "receipt-scan": `${COMMONS}/4/45/Tesco_grocery_receipt_Finchley_1994.jpg`,
  // Petit Pois restaurant menu, about 50 dishes.
  "menu-scan": `${COMMONS}/thumb/b/bb/Menu_of_Petit_Pois_Restaurant_%281%29_2024-07-11.jpg/1280px-Menu_of_Petit_Pois_Restaurant_%281%29_2024-07-11.jpg`,
  // Heinz Tomato Ketchup bottle, front.
  "front-label-scan": `${COMMONS}/thumb/d/d3/Heinz_Tomato_Ketchup%2C_Canada_%28front%29%2C_2026-02-19.jpg/1280px-Heinz_Tomato_Ketchup%2C_Canada_%28front%29%2C_2026-02-19.jpg`,
  // Tomatoes, garlic, coriander, sliced peppers on a cutting board.
  "cooking-ingredient-photo": `${COMMONS}/thumb/7/7d/Liat_Portal_for_Foodie_Disorder_-_Ingredient_preparation_before_cooking.jpg/1280px-Liat_Portal_for_Foodie_Disorder_-_Ingredient_preparation_before_cooking.jpg`,
};

const isEmptyList = (v: unknown): boolean => Array.isArray(v) && !v.length;

/** Why a service result is a miss on the gate's photo, or undefined. */
export function visionDegraded(
  feature: AiFeature,
  result: unknown,
): string | undefined {
  const r = (result ?? {}) as Record<string, unknown>;
  switch (feature) {
    case "recipe-chat-image":
      return /no food ingredients detected/i.test(String(result))
        ? "no ingredients found"
        : undefined;
    case "photo-recipe":
      return isEmptyList(r.ingredients) ? "no ingredients" : undefined;
    case "receipt-scan":
      return isEmptyList(r.items) ? "no items" : undefined;
    case "menu-scan":
      return isEmptyList(r.menuItems) ? "no menu items" : undefined;
    case "cooking-ingredient-photo":
      return isEmptyList(result) ? "no ingredients" : undefined;
    case "photo-label":
      return r.calories == null ? "no calories" : undefined;
    case "front-label-scan":
      return r.brand == null && r.productName == null
        ? "no brand or product name"
        : undefined;
    case "photo-classify":
      return r.analysisResult == null ? "no follow-up analysis" : undefined;
    default:
      return undefined;
  }
}

async function fetchJpegBase64(url: string): Promise<string> {
  // Wikimedia rate-limits thumbnails (429) and asks for a contactable agent.
  let res: Response;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url, {
      headers: {
        "User-Agent": "OCRecipes-ai-backup-gate/1.0 (https://ocrecipes.com)",
      },
    });
    if (res.status !== 429 || attempt === 3) break;
    const wait = Math.min(Number(res.headers.get("retry-after")) || 5, 15);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!res.ok) throw new Error(`image fetch ${url}: HTTP ${res.status}`);
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize({ width: 1600, height: 1600, fit: "inside" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return jpeg.toString("base64");
}

export async function visionRowDrivers(): Promise<
  Partial<Record<AiFeature, Driver>>
> {
  const { analyzeImageForRecipe } = await import(
    "../server/services/recipe-chat"
  );
  const { analyzeRecipePhoto, analyzeLabelPhoto, classifyAndAnalyze } =
    await import("../server/services/photo-analysis");
  const { analyzeReceiptPhotos } = await import(
    "../server/services/receipt-analysis"
  );
  const { analyzeMenuPhoto } = await import("../server/services/menu-analysis");
  const { analyzeFrontLabel } = await import(
    "../server/services/front-label-analysis"
  );
  const { analyzeIngredientPhoto } = await import(
    "../server/services/cooking-session"
  );

  // Fetch each image once, before any sample runs.
  const images = new Map<string, string>();
  for (const url of new Set(Object.values(VISION_ROW_IMAGES)))
    images.set(url, await fetchJpegBase64(url));
  const image = (f: AiFeature) => images.get(VISION_ROW_IMAGES[f]!)!;

  const drive =
    (feature: AiFeature, call: (img: string) => Promise<unknown>): Driver =>
    async () => {
      const result = await call(image(feature));
      const degraded = visionDegraded(feature, result);
      return {
        text: typeof result === "string" ? result : JSON.stringify(result),
        toolRounds: 0,
        ...(degraded ? { degraded } : {}),
      };
    };

  return {
    "recipe-chat-image": drive("recipe-chat-image", (img) =>
      analyzeImageForRecipe(img, "image/jpeg"),
    ),
    "photo-recipe": drive("photo-recipe", analyzeRecipePhoto),
    "photo-label": drive("photo-label", analyzeLabelPhoto),
    "photo-classify": drive("photo-classify", classifyAndAnalyze),
    "receipt-scan": drive("receipt-scan", (img) => analyzeReceiptPhotos([img])),
    // A random id has no profile: the service then runs unpersonalised.
    "menu-scan": drive("menu-scan", (img) =>
      analyzeMenuPhoto(img, randomUUID()),
    ),
    "front-label-scan": drive("front-label-scan", analyzeFrontLabel),
    "cooking-ingredient-photo": drive("cooking-ingredient-photo", (img) =>
      analyzeIngredientPhoto(img, "image/jpeg", 0),
    ),
  };
}
