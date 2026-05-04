import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { MulterError } from "multer";
import { logger } from "./lib/logger";
import { register as registerAuth } from "./routes/auth";
import { register as registerProfile } from "./routes/profile";
import { register as registerNutrition } from "./routes/nutrition";
import { register as registerPhotos } from "./routes/photos";
import { register as registerSuggestions } from "./routes/suggestions";
import { register as registerSavedItems } from "./routes/saved-items";
import { register as registerRecipes } from "./routes/recipes";
import { register as registerRecipeSearch } from "./routes/recipe-search";
import { register as registerRecipeCatalog } from "./routes/recipe-catalog";
import { register as registerRecipeImport } from "./routes/recipe-import";
import { register as registerMealPlan } from "./routes/meal-plan";
import { register as registerRecipeGenerate } from "./routes/recipe-generate";
import { register as registerGrocery } from "./routes/grocery";
import { register as registerPantry } from "./routes/pantry";
import { register as registerSubscription } from "./routes/subscription";
import { register as registerGoals } from "./routes/goals";
import { register as registerMealSuggestions } from "./routes/meal-suggestions";
import { register as registerWeightRoutes } from "./routes/weight";
import { register as registerFood } from "./routes/food";
import { register as registerHealthKit } from "./routes/healthkit";
import { register as registerAdaptiveGoals } from "./routes/adaptive-goals";
import { register as registerChat } from "./routes/chat";
import { register as registerCoachContext } from "./routes/coach-context";
import { register as registerNotebook } from "./routes/notebook";
import { register as registerRecipeChat } from "./routes/recipe-chat";
import { register as registerFasting } from "./routes/fasting";
import { register as registerMedication } from "./routes/medication";
import { register as registerMenu } from "./routes/menu";
import { register as registerMicronutrients } from "./routes/micronutrients";
import { register as registerReceipt } from "./routes/receipt";
import { register as registerCooking } from "./routes/cooking";
import { register as registerAllergenCheck } from "./routes/allergen-check";
import { register as registerCookbooks } from "./routes/cookbooks";
import { register as registerFavouriteRecipes } from "./routes/favourite-recipes";
import { register as registerVerification } from "./routes/verification";
import { register as registerBatchScan } from "./routes/batch-scan";
import { register as registerBeverages } from "./routes/beverages";
import { register as registerCarousel } from "./routes/carousel";
import { register as registerProfileHub } from "./routes/profile-hub";
import { register as registerPublicApi } from "./routes/public-api";
import { register as registerAdminApiKeys } from "./routes/admin-api-keys";
import { register as registerApiDocs } from "./routes/api-docs";
import { register as registerPushTokens } from "./routes/push-tokens";
import { register as registerReminders } from "./routes/reminders";
import { registerCoachCommitmentsRoutes } from "./routes/coach-commitments";
import { initSearchIndex } from "./services/recipe-search";
import { startNotificationScheduler } from "./services/notification-scheduler";

export async function registerRoutes(app: Express): Promise<Server> {
  // Public API (separate namespace, registered first to avoid auth conflicts)
  registerApiDocs(app);
  registerPublicApi(app);
  registerAdminApiKeys(app);

  // Register all route modules
  registerAuth(app);
  registerProfile(app);
  registerNutrition(app);
  registerPhotos(app);
  registerSuggestions(app);
  registerSavedItems(app);
  // Register recipe-search BEFORE recipes — the `/api/recipes/search` and
  // `/api/recipes/browse` routes must be matched before `/api/recipes/:id`,
  // otherwise Express will try to parse "search"/"browse" as an int id.
  registerRecipeSearch(app);
  registerRecipes(app);
  registerRecipeCatalog(app);
  registerRecipeImport(app);
  registerMealPlan(app);
  registerRecipeGenerate(app);
  registerGrocery(app);
  registerPantry(app);
  registerSubscription(app);
  registerGoals(app);
  registerMealSuggestions(app);
  registerWeightRoutes(app);
  registerFood(app);
  registerHealthKit(app);
  registerAdaptiveGoals(app);
  registerChat(app);
  registerCoachContext(app);
  registerNotebook(app);
  registerRecipeChat(app);
  registerFasting(app);
  registerMedication(app);
  registerMenu(app);
  registerMicronutrients(app);
  registerReceipt(app);
  registerCooking(app);
  registerAllergenCheck(app);
  registerCookbooks(app);
  registerFavouriteRecipes(app);
  registerVerification(app);
  registerBatchScan(app);
  registerBeverages(app);
  registerCarousel(app);
  registerProfileHub(app);
  registerPushTokens(app);
  registerReminders(app);
  registerCoachCommitmentsRoutes(app);

  // Initialize search index (non-blocking — server starts even if index fails)
  initSearchIndex().catch((err) => {
    logger.error({ err }, "Failed to initialize search index");
  });

  // Start push notification scheduler (daily 09:00 commitment reminders)
  startNotificationScheduler();

  // Multer error handler - returns 400 for file validation errors instead of 500
  app.use(
    (
      err: Error,
      req: Request,
      res: Response,
      next: (err?: Error) => void,
    ): void => {
      if (err instanceof MulterError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      if (err.message?.includes("Invalid file type")) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    },
  );

  const httpServer = createServer(app);

  return httpServer;
}
