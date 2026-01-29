import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcrypt";
import OpenAI from "openai";
import { storage } from "./storage";
import { requireAuth, generateToken } from "./middleware/auth";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password are required" });
      }

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ error: "Username already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
      });

      const token = generateToken(user.id.toString());

      res.status(201).json({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          dailyCalorieGoal: user.dailyCalorieGoal,
          onboardingCompleted: user.onboardingCompleted,
        },
        token,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password are required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = generateToken(user.id.toString());

      res.json({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          dailyCalorieGoal: user.dailyCalorieGoal,
          onboardingCompleted: user.onboardingCompleted,
        },
        token,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Failed to login" });
    }
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    // Stateless JWT - no session to destroy
    res.json({ success: true });
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUser(req.userId!);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      dailyCalorieGoal: user.dailyCalorieGoal,
      onboardingCompleted: user.onboardingCompleted,
    });
  });

  app.put(
    "/api/auth/profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { displayName, dailyCalorieGoal, onboardingCompleted } = req.body;
        const updates: Record<string, unknown> = {};
        if (displayName !== undefined) updates.displayName = displayName;
        if (dailyCalorieGoal !== undefined)
          updates.dailyCalorieGoal = dailyCalorieGoal;
        if (onboardingCompleted !== undefined)
          updates.onboardingCompleted = onboardingCompleted;

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: "No valid fields to update" });
        }

        const user = await storage.updateUser(req.userId!, updates);

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          dailyCalorieGoal: user.dailyCalorieGoal,
          onboardingCompleted: user.onboardingCompleted,
        });
      } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ error: "Failed to update profile" });
      }
    },
  );

  app.get(
    "/api/user/dietary-profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const profile = await storage.getUserProfile(req.userId!);
        res.json(profile || null);
      } catch (error) {
        console.error("Error fetching dietary profile:", error);
        res.status(500).json({ error: "Failed to fetch dietary profile" });
      }
    },
  );

  app.post(
    "/api/user/dietary-profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const {
          allergies,
          healthConditions,
          dietType,
          foodDislikes,
          primaryGoal,
          activityLevel,
          householdSize,
          cuisinePreferences,
          cookingSkillLevel,
          cookingTimeAvailable,
        } = req.body;

        const existingProfile = await storage.getUserProfile(req.userId!);

        let profile;
        if (existingProfile) {
          profile = await storage.updateUserProfile(req.userId!, {
            allergies,
            healthConditions,
            dietType,
            foodDislikes,
            primaryGoal,
            activityLevel,
            householdSize,
            cuisinePreferences,
            cookingSkillLevel,
            cookingTimeAvailable,
          });
        } else {
          profile = await storage.createUserProfile({
            userId: req.userId!,
            allergies,
            healthConditions,
            dietType,
            foodDislikes,
            primaryGoal,
            activityLevel,
            householdSize,
            cuisinePreferences,
            cookingSkillLevel,
            cookingTimeAvailable,
          });
        }

        await storage.updateUser(req.userId!, { onboardingCompleted: true });

        res.status(201).json(profile);
      } catch (error) {
        console.error("Error saving dietary profile:", error);
        res.status(500).json({ error: "Failed to save dietary profile" });
      }
    },
  );

  app.put(
    "/api/user/dietary-profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const updates = req.body;
        const profile = await storage.updateUserProfile(req.userId!, updates);

        if (!profile) {
          return res.status(404).json({ error: "Profile not found" });
        }

        res.json(profile);
      } catch (error) {
        console.error("Error updating dietary profile:", error);
        res.status(500).json({ error: "Failed to update dietary profile" });
      }
    },
  );

  app.get(
    "/api/scanned-items",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const items = await storage.getScannedItems(req.userId!);
        res.json(items);
      } catch (error) {
        console.error("Error fetching scanned items:", error);
        res.status(500).json({ error: "Failed to fetch items" });
      }
    },
  );

  app.get("/api/scanned-items/:id", async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const id = parseInt(Array.isArray(idParam) ? idParam[0] : idParam);
      const item = await storage.getScannedItem(id);

      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      res.json(item);
    } catch (error) {
      console.error("Error fetching scanned item:", error);
      res.status(500).json({ error: "Failed to fetch item" });
    }
  });

  app.post(
    "/api/scanned-items",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const {
          barcode,
          productName,
          brandName,
          servingSize,
          calories,
          protein,
          carbs,
          fat,
          fiber,
          sugar,
          sodium,
          imageUrl,
        } = req.body;

        const item = await storage.createScannedItem({
          userId: req.userId!,
          barcode,
          productName: productName || "Unknown Product",
          brandName,
          servingSize,
          calories: calories?.toString(),
          protein: protein?.toString(),
          carbs: carbs?.toString(),
          fat: fat?.toString(),
          fiber: fiber?.toString(),
          sugar: sugar?.toString(),
          sodium: sodium?.toString(),
          imageUrl,
        });

        await storage.createDailyLog({
          userId: req.userId!,
          scannedItemId: item.id,
          servings: "1",
          mealType: null,
        });

        res.status(201).json(item);
      } catch (error) {
        console.error("Error creating scanned item:", error);
        res.status(500).json({ error: "Failed to save item" });
      }
    },
  );

  app.get(
    "/api/daily-summary",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const dateParam = req.query.date as string;
        const date = dateParam ? new Date(dateParam) : new Date();

        const summary = await storage.getDailySummary(req.userId!, date);
        res.json(summary);
      } catch (error) {
        console.error("Error fetching daily summary:", error);
        res.status(500).json({ error: "Failed to fetch summary" });
      }
    },
  );

  app.post(
    "/api/items/:id/suggestions",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const itemId = parseInt(req.params.id);
        const item = await storage.getScannedItem(itemId);

        if (!item) {
          return res.status(404).json({ error: "Item not found" });
        }

        const userProfile = await storage.getUserProfile(req.userId!);

        let dietaryContext = "";
        if (userProfile) {
          if (
            userProfile.allergies &&
            Array.isArray(userProfile.allergies) &&
            userProfile.allergies.length > 0
          ) {
            dietaryContext += `User allergies (avoid these ingredients): ${(userProfile.allergies as any[]).map((a) => a.name).join(", ")}. `;
          }
          if (userProfile.dietType) {
            dietaryContext += `Diet: ${userProfile.dietType}. `;
          }
          if (userProfile.cookingSkillLevel) {
            dietaryContext += `Cooking skill: ${userProfile.cookingSkillLevel}. `;
          }
          if (userProfile.cookingTimeAvailable) {
            dietaryContext += `Time: ${userProfile.cookingTimeAvailable}. `;
          }
        }

        const prompt = `Given this food item: "${item.productName}"${item.brandName ? ` by ${item.brandName}` : ""}, generate creative suggestions.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Generate exactly 4 suggestions in this JSON format:
{
  "suggestions": [
    {
      "type": "recipe",
      "title": "Recipe name",
      "description": "Brief 1-2 sentence description of how to use this ingredient",
      "difficulty": "Easy/Medium/Hard",
      "timeEstimate": "15 min"
    },
    {
      "type": "recipe",
      "title": "Another recipe",
      "description": "Description",
      "difficulty": "Easy",
      "timeEstimate": "30 min"
    },
    {
      "type": "craft",
      "title": "Fun kid activity with food packaging or theme",
      "description": "Brief description of a creative activity for kids",
      "timeEstimate": "20 min"
    },
    {
      "type": "pairing",
      "title": "What goes well with this",
      "description": "Complementary foods or drinks that pair nicely"
    }
  ]
}

Keep descriptions concise. Make recipes practical and kid activities fun and safe. Return only valid JSON.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful culinary and crafts assistant. Always respond with valid JSON only, no markdown formatting.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 1024,
        });

        const responseText = completion.choices[0]?.message?.content || "{}";
        const suggestions = JSON.parse(responseText);

        res.json(suggestions);
      } catch (error) {
        console.error("Error generating suggestions:", error);
        res.status(500).json({ error: "Failed to generate suggestions" });
      }
    },
  );

  const httpServer = createServer(app);

  return httpServer;
}
