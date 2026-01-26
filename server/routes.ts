import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcrypt";
import session from "express-session";
import { storage } from "./storage";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "nutriscan-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

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

      req.session.userId = user.id;

      res.status(201).json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        dailyCalorieGoal: user.dailyCalorieGoal,
        onboardingCompleted: user.onboardingCompleted,
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

      req.session.userId = user.id;

      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        dailyCalorieGoal: user.dailyCalorieGoal,
        onboardingCompleted: user.onboardingCompleted,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Failed to login" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUser(req.session.userId);
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

  app.put("/api/auth/profile", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const { displayName, dailyCalorieGoal } = req.body;
      const user = await storage.updateUser(req.session.userId, {
        displayName,
        dailyCalorieGoal,
      });

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
  });

  app.get("/api/user/dietary-profile", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const profile = await storage.getUserProfile(req.session.userId);
      res.json(profile || null);
    } catch (error) {
      console.error("Error fetching dietary profile:", error);
      res.status(500).json({ error: "Failed to fetch dietary profile" });
    }
  });

  app.post("/api/user/dietary-profile", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

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

      const existingProfile = await storage.getUserProfile(req.session.userId);

      let profile;
      if (existingProfile) {
        profile = await storage.updateUserProfile(req.session.userId, {
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
          userId: req.session.userId,
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

      await storage.updateUser(req.session.userId, { onboardingCompleted: true });

      res.status(201).json(profile);
    } catch (error) {
      console.error("Error saving dietary profile:", error);
      res.status(500).json({ error: "Failed to save dietary profile" });
    }
  });

  app.put("/api/user/dietary-profile", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const updates = req.body;
      const profile = await storage.updateUserProfile(req.session.userId, updates);

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      res.json(profile);
    } catch (error) {
      console.error("Error updating dietary profile:", error);
      res.status(500).json({ error: "Failed to update dietary profile" });
    }
  });

  app.get("/api/scanned-items", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const items = await storage.getScannedItems(req.session.userId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching scanned items:", error);
      res.status(500).json({ error: "Failed to fetch items" });
    }
  });

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

  app.post("/api/scanned-items", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

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
        userId: req.session.userId,
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
        userId: req.session.userId,
        scannedItemId: item.id,
        servings: "1",
        mealType: null,
      });

      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating scanned item:", error);
      res.status(500).json({ error: "Failed to save item" });
    }
  });

  app.get("/api/daily-summary", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const dateParam = req.query.date as string;
      const date = dateParam ? new Date(dateParam) : new Date();

      const summary = await storage.getDailySummary(req.session.userId, date);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching daily summary:", error);
      res.status(500).json({ error: "Failed to fetch summary" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
