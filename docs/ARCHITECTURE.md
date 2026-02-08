# NutriScan Architecture

## System Overview

NutriScan is a mobile nutrition tracking application with a monorepo architecture consisting of three main components:

```
┌─────────────────────────────────────────────────────────────────┐
│                        NutriScan System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    HTTPS/JSON    ┌──────────────────────────┐│
│  │    Mobile    │◄────────────────►│     Express Backend      ││
│  │   (Expo)     │   via Tunnel     │       (Port 3000)        ││
│  └──────────────┘                  └──────────────────────────┘│
│         │                                      │                │
│         │                          ┌───────────┼──────────┬────┐│
│         ▼                          │           │          │    ││
│  ┌──────────────┐                  ▼           ▼          ▼   ││
│  │   Shared     │         ┌────────────┐ ┌──────────┐ ┌──────┐│
│  │   Schema     │         │ PostgreSQL │ │ OpenAI   │ │Nutri-││
│  └──────────────┘         │  Database  │ │ API      │ │tion  ││
│                           └────────────┘ └──────────┘ │APIs  ││
│                                                       └──────┘│
│                                                          │      │
│                                          ┌───────────────┤      │
│                                          │       │       │      │
│                                          ▼       ▼       ▼      │
│                                       ┌────┐ ┌────┐ ┌──────┐  │
│                                       │OFF │ │USDA│ │ CNF  │  │
│                                       └────┘ └────┘ └──────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                Meal Planning Services                     │    │
│  │  ┌──────────────┐  ┌──────────────┐                      │    │
│  │  │ Spoonacular  │  │ Recipe URL   │                      │    │
│  │  │ Catalog API  │  │ Import       │                      │    │
│  │  └──────────────┘  └──────────────┘                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

External Nutrition APIs:
  OFF  = Open Food Facts (barcode → product data)
  USDA = USDA FoodData Central (text search + branded UPC lookup)
  CNF  = Canadian Nutrient File (bilingual EN/FR, ~5,690 foods)
  Also: API Ninjas Nutrition (last-resort fallback)

Meal Planning APIs:
  Spoonacular = Recipe catalog search, detail retrieval, nutrition data
  Recipe URL Import = schema.org Recipe LD+JSON extraction from any URL
```

## Directory Structure

```
Nutri-Cam/
├── client/                    # React Native/Expo Frontend
│   ├── App.tsx                # Entry point with providers
│   ├── components/            # Reusable UI components
│   │   └── recipe-builder/    # Bottom-sheet recipe builder (7 components)
│   ├── constants/             # Theme, colors, spacing
│   ├── context/               # React Context providers
│   ├── hooks/                 # Custom React hooks
│   ├── lib/                   # Utilities (query client)
│   ├── navigation/            # React Navigation stacks
│   └── screens/               # Screen components
│       ├── onboarding/        # Onboarding flow screens
│       └── meal-plan/         # Meal planning screens (5)
│
├── server/                    # Express.js Backend
│   ├── index.ts               # Server entry, CORS setup
│   ├── routes.ts              # API route definitions
│   ├── storage.ts             # Database operations
│   ├── db.ts                  # Drizzle ORM configuration
│   └── services/              # Business logic
│       ├── nutrition-lookup.ts # Multi-source nutrition pipeline
│       ├── recipe-catalog.ts  # Spoonacular catalog integration
│       └── recipe-import.ts   # URL recipe import (schema.org)
│
├── shared/                    # Shared Code
│   ├── schema.ts              # Database schema (Drizzle)
│   └── models/                # Shared type definitions
│
├── docs/                      # Documentation
├── assets/                    # Images and icons
└── scripts/                   # Build scripts
```

## Technology Stack

### Frontend

| Technology       | Version | Purpose                  |
| ---------------- | ------- | ------------------------ |
| Expo SDK         | 54      | React Native toolchain   |
| React Native     | 0.81    | Mobile UI framework      |
| React            | 19      | UI library               |
| React Navigation | 7.x     | Navigation management    |
| TanStack Query   | 5.x     | Server state management  |
| Reanimated       | 4.x     | Animations               |
| vision-camera    | 4.x     | Barcode scanning + photo |

### Backend

| Technology   | Version | Purpose            |
| ------------ | ------- | ------------------ |
| Express.js   | 5.0     | HTTP server        |
| Drizzle ORM  | -       | Database ORM       |
| PostgreSQL   | 12+     | Database           |
| bcrypt       | -       | Password hashing   |
| jsonwebtoken | -       | JWT authentication |
| OpenAI SDK   | -       | AI suggestions     |

### External APIs

| Service                                                                                | Purpose                                         | Auth        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------- |
| [Open Food Facts](https://world.openfoodfacts.org)                                     | Barcode → product data (name, nutrients, image) | None (free) |
| [Canadian Nutrient File](https://food-nutrition.canada.ca/api/canadian-nutrient-file/) | Bilingual EN/FR nutrition data, ~5,690 foods    | None (free) |
| [USDA FoodData Central](https://fdc.nal.usda.gov/)                                     | Text search + branded food UPC lookup           | API key     |
| [API Ninjas Nutrition](https://api-ninjas.com/api/nutrition)                           | Last-resort fallback                            | API key     |
| [Spoonacular](https://spoonacular.com/food-api)                                        | Recipe catalog search, detail, and nutrition    | API key     |

### Shared

| Technology  | Purpose           |
| ----------- | ----------------- |
| TypeScript  | Type safety       |
| Zod         | Schema validation |
| drizzle-zod | Schema generation |

## Path Aliases

```typescript
// tsconfig.json
{
  "paths": {
    "@/*": ["./client/*"],
    "@shared/*": ["./shared/*"]
  }
}
```

Usage:

```typescript
import { useTheme } from "@/hooks/useTheme";
import { users } from "@shared/schema";
```

---

## Database Architecture

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Database Schema                          │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│      users       │
├──────────────────┤
│ id (PK, uuid)    │──────────────────────────┐
│ username         │                          │
│ password         │                          │
│ displayName      │                          │
│ dailyCalorieGoal │                          │
│ onboardingCompleted                         │
│ createdAt        │                          │
└──────────────────┘                          │
         │                                    │
         │ 1:1                                │ 1:N
         ▼                                    │
┌──────────────────┐                          │
│  user_profiles   │                          │
├──────────────────┤                          │
│ id (PK, serial)  │                          │
│ userId (FK) ◄────│──────────────────────────┤
│ allergies (JSONB)│                          │
│ healthConditions │                          │
│ dietType         │                          │
│ foodDislikes     │                          │
│ primaryGoal      │                          │
│ activityLevel    │                          │
│ householdSize    │                          │
│ cuisinePrefs     │                          │
│ cookingSkill     │                          │
│ cookingTime      │                          │
│ createdAt        │                          │
│ updatedAt        │                          │
└──────────────────┘                          │
                                              │
┌──────────────────┐                          │
│  scanned_items   │◄─────────────────────────┘
├──────────────────┤
│ id (PK, serial)  │──────────────────────────┐
│ userId (FK)      │                          │
│ barcode          │                          │
│ productName      │                          │
│ brandName        │                          │
│ servingSize      │                          │
│ calories         │                          │
│ protein          │                          │
│ carbs            │                          │
│ fat              │                          │
│ fiber            │                          │
│ sugar            │                          │
│ sodium           │                          │
│ imageUrl         │                          │
│ scannedAt        │                          │
└──────────────────┘                          │
         │                                    │
         │ 1:N                                │
         ▼                                    │
┌──────────────────┐                          │
│   daily_logs     │                          │
├──────────────────┤                          │
│ id (PK, serial)  │                          │
│ userId (FK) ◄────│──────────────────────────┤
│ scannedItemId(FK)│                          │
│ servings         │                          │
│ mealType         │                          │
│ loggedAt         │                          │
└──────────────────┘                          │
                                              │
┌─────────────────────┐                       │
│ meal_plan_recipes   │◄──────────────────────┘
├─────────────────────┤
│ id (PK, serial)     │──────────────────────┐
│ userId (FK)         │                      │
│ title               │                      │
│ description         │                      │
│ sourceType          │  "user_created" |    │
│ sourceUrl           │  "catalog" |         │
│                     │  "url_import"        │
│ externalId          │                      │
│ cuisine             │                      │
│ difficulty          │                      │
│ servings            │                      │
│ prepTimeMinutes     │                      │
│ cookTimeMinutes     │                      │
│ instructions        │                      │
│ dietTags (JSONB)    │                      │
│ caloriesPerServing  │                      │
│ proteinPerServing   │                      │
│ carbsPerServing     │                      │
│ fatPerServing       │                      │
│ createdAt, updatedAt│                      │
└─────────────────────┘                      │
         │                                   │
         │ 1:N                               │
         ▼                                   │
┌─────────────────────┐                      │
│ recipe_ingredients  │                      │
├─────────────────────┤                      │
│ id (PK, serial)     │                      │
│ recipeId (FK)       │                      │
│ name                │                      │
│ quantity            │                      │
│ unit                │                      │
│ category            │                      │
│ displayOrder        │                      │
└─────────────────────┘                      │
                                             │
┌─────────────────────┐                      │
│ meal_plan_items     │                      │
├─────────────────────┤                      │
│ id (PK, serial)     │                      │
│ userId (FK)         │                      │
│ recipeId (FK) ◄─────│──────────────────────┘
│ scannedItemId (FK)  │
│ plannedDate         │
│ mealType            │  breakfast | lunch |
│ servings            │  dinner | snack
│ createdAt           │
└─────────────────────┘
```

### Table Relationships

- **users → user_profiles**: One-to-one (cascade delete)
- **users → scanned_items**: One-to-many (cascade delete)
- **users → daily_logs**: One-to-many (cascade delete)
- **scanned_items → daily_logs**: One-to-many (cascade delete)
- **users → meal_plan_recipes**: One-to-many (cascade delete)
- **meal_plan_recipes → recipe_ingredients**: One-to-many (cascade delete)
- **meal_plan_recipes → meal_plan_items**: One-to-many (set null on delete)
- **scanned_items → meal_plan_items**: One-to-many (set null on delete)
- **users → meal_plan_items**: One-to-many (cascade delete)

---

## Frontend Architecture

### Navigation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Navigation Structure                         │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────┐
                    │  RootStackNavigator │
                    │    (Entry Point)    │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   LoginScreen   │  │  Onboarding     │  │ MainTabNavigator│
│ (Unauthenticated)  │  Navigator      │  │ (Authenticated) │
└─────────────────┘  └────────┬────────┘  └────────┬────────┘
                              │                    │
              ┌───────────────┼───────────────┐    │
              │               │               │    │
              ▼               ▼               ▼    │
       ┌───────────┐   ┌───────────┐   ┌───────────┐
       │  Welcome  │   │ Allergies │   │  DietType │
       └───────────┘   └───────────┘   └───────────┘
              │               │               │
              ▼               ▼               ▼
       ┌───────────┐   ┌───────────┐   ┌───────────┐
       │  Health   │   │   Goals   │   │Preferences│
       │Conditions │   └───────────┘   └───────────┘
       └───────────┘

                    MainTabNavigator
         ┌──────────┬──────────┼──────────┐
         │          │          │          │
         ▼          ▼          ▼          ▼
┌────────────┐ ┌──────────────┐ ┌─────────┐ ┌────────────┐
│HistoryStack│ │MealPlanStack │ │ScanStack│ │ProfileStack│
│ Navigator  │ │  Navigator   │ │Navigator│ │ Navigator  │
├────────────┤ ├──────────────┤ ├─────────┤ ├────────────┤
│HistoryScr  │ │MealPlanHome  │ │ScanScr  │ │ProfileScr  │
│ItemDetail  │ │RecipeDetail  │ └─────────┘ └────────────┘
└────────────┘ │RecipeBrowser │
               │RecipeCreate  │
               │RecipeImport  │
               └──────────────┘
         │
         ▼
┌─────────────────┐
│NutritionDetail  │ (Modal)
│    Screen       │
└─────────────────┘
```

### State Management

```
┌─────────────────────────────────────────────────────────────────┐
│                      State Architecture                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         App.tsx                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    AuthProvider                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │               QueryClientProvider                    │  │  │
│  │  │  ┌───────────────────────────────────────────────┐  │  │  │
│  │  │  │              NavigationContainer               │  │  │  │
│  │  │  │                                               │  │  │  │
│  │  │  │              RootStackNavigator               │  │  │  │
│  │  │  │                     │                         │  │  │  │
│  │  │  │      ┌──────────────┼──────────────┐         │  │  │  │
│  │  │  │      │              │              │         │  │  │  │
│  │  │  │      ▼              ▼              ▼         │  │  │  │
│  │  │  │  Login      OnboardingProvider   Main       │  │  │  │
│  │  │  │                     │                        │  │  │  │
│  │  │  │                     ▼                        │  │  │  │
│  │  │  │              OnboardingStack                 │  │  │  │
│  │  │  └───────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

State Types:
┌────────────────────┬──────────────────────────────────────────┐
│ AuthContext        │ User session, login/logout/register      │
├────────────────────┼──────────────────────────────────────────┤
│ OnboardingContext  │ Onboarding data across 6 screens         │
├────────────────────┼──────────────────────────────────────────┤
│ TanStack Query     │ Server state (items, profiles, summary)  │
├────────────────────┼──────────────────────────────────────────┤
│ AsyncStorage       │ Persistent auth token                    │
└────────────────────┴──────────────────────────────────────────┘
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Component Hierarchy                          │
└─────────────────────────────────────────────────────────────────┘

Screens (container components)
│
├── LoginScreen
│   ├── ThemedView
│   ├── ThemedText
│   └── Button
│
├── HistoryScreen
│   ├── ThemedView
│   ├── FlatList
│   │   └── Card (per item)
│   │       ├── Image
│   │       └── ThemedText
│   └── Empty State
│
├── ScanScreen
│   ├── CameraView
│   ├── Animated Reticle
│   ├── Shutter Button
│   └── Flash Toggle
│
├── ItemDetailScreen
│   ├── Card (Nutrition Facts)
│   │   ├── ThemedText (Calories)
│   │   └── Macro Bars
│   └── Suggestions Section
│       └── Suggestion Cards (×4)
│
└── ProfileScreen
    ├── Avatar
    ├── Progress Bar
    ├── Dietary Info Cards
    └── Settings Buttons

Shared Components (client/components/)
├── Button.tsx
├── Card.tsx
├── ThemedText.tsx
├── ThemedView.tsx
├── ErrorBoundary.tsx
└── KeyboardAwareScrollViewCompat.tsx
```

---

## Backend Architecture

### Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Request Pipeline                            │
└─────────────────────────────────────────────────────────────────┘

Mobile App
    │
    │ HTTPS Request
    ▼
┌──────────────────┐
│  Tunnel (localt) │
│  or Production   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Express Server  │
├──────────────────┤
│ 1. CORS Middleware
│ 2. JSON Parser   │
│ 3. JWT Auth Check│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Route Handler  │
│   (routes.ts)    │
└────────┬─────────┘
         │
    ┌────┴────────────┐
    │         │       │
    ▼         ▼       ▼
┌────────┐ ┌──────┐ ┌───────────┐
│Storage │ │OpenAI│ │ Nutrition │
│  API   │ │  API │ │  Lookup   │
└───┬────┘ └──────┘ └─────┬─────┘
    │                     │
    ▼                     ▼
┌────────┐     (see Nutrition Lookup
│Drizzle │      Pipeline below)
│  ORM   │
└───┬────┘
    │
    ▼
┌────────┐
│Postgres│
└────────┘
```

### Nutrition Lookup Pipeline

The barcode and text-based nutrition endpoints use a multi-source lookup
chain defined in `server/services/nutrition-lookup.ts`.

#### Barcode Lookup (`GET /api/nutrition/barcode/:code`)

```
┌─────────────────────────────────────────────────────────────────┐
│                  Barcode Lookup Pipeline                         │
└─────────────────────────────────────────────────────────────────┘

Scanned Barcode
    │
    ▼
┌───────────────────────┐
│ Barcode Padding       │  Generate UPC-A / EAN-13 variants
│ barcodeVariants()     │  (zero-pad, check-digit computation)
└──────────┬────────────┘
           │  Array of candidate codes
           ▼
┌───────────────────────┐
│ Open Food Facts (OFF) │  Try each variant until found
│ GET /api/v0/product/  │
└──────────┬────────────┘
           │
      ┌────┴─────────────────────┐
      │ Found                    │ Not Found
      ▼                          ▼
┌─────────────────┐    ┌───────────────────────┐
│ Extract search  │    │ USDA Branded UPC      │
│ terms from OFF  │    │ lookupUSDAByUPC()     │
│ (English fields)│    │ Search by gtinUpc     │
└────────┬────────┘    └──────────┬────────────┘
         │                        │
         ▼                   ┌────┴────┐
┌──────────────────┐    Found│    Not  │Found
│ Cross-validate   │         ▼    Found▼
│ with CNF → USDA  │    ┌────────┐  ┌────────────┐
│ (see text lookup)│    │ Return │  │ Return 404 │
└────────┬─────────┘    │ USDA   │  │notInDatabase│
         │              │ data   │  └────────────┘
         ▼              └────────┘
┌──────────────────┐
│ Merge & validate │  Plausibility checks, serving size
│ Return best data │  normalization, source attribution
└──────────────────┘
```

#### Text-Based Lookup (`GET /api/nutrition/lookup?name=...`)

```
┌─────────────────────────────────────────────────────────────────┐
│                  Text Lookup Priority Chain                      │
└─────────────────────────────────────────────────────────────────┘

Search Query
    │
    ▼
┌───────────────────────┐
│ 1. Canadian Nutrient  │  In-memory cached food list
│    File (CNF)         │  Fuzzy bilingual matching (EN/FR)
│    lookupCNF()        │  scoreCNFMatch() ranking
└──────────┬────────────┘
           │
      ┌────┴──────┐
   Found      Not Found
      │           │
      ▼           ▼
  ┌────────┐  ┌───────────────────────┐
  │ Return │  │ 2. USDA FoodData      │
  │ CNF    │  │    Central            │
  │ data   │  │    lookupUSDA()       │
  └────────┘  └──────────┬────────────┘
                         │
                    ┌────┴──────┐
                 Found      Not Found
                    │           │
                    ▼           ▼
                ┌────────┐  ┌───────────────────┐
                │ Return │  │ 3. API Ninjas     │
                │ USDA   │  │    (last resort)  │
                │ data   │  │    lookupAPINinjas│
                └────────┘  └─────────┬─────────┘
                                      │
                                      ▼
                                 ┌──────────┐
                                 │ Return   │
                                 │ or null  │
                                 └──────────┘
```

#### Cross-Validation Logic

When OFF returns data, it is cross-validated against a secondary source
(CNF preferred, then USDA):

- **Agreement** (within 2× on calories): Use OFF data, fill gaps from secondary
- **Disagreement** (>2× difference): Prefer secondary source data
- **Implausible serving size**: Estimate from product name, normalize per-100g

### Storage Layer

```typescript
// server/storage.ts - Database operations interface

interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(data: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;

  // Profiles
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  createUserProfile(data: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(
    userId: string,
    updates: Partial<UserProfile>,
  ): Promise<UserProfile | undefined>;

  // Scanned Items
  getScannedItems(userId: string): Promise<ScannedItem[]>;
  getScannedItem(id: number): Promise<ScannedItem | undefined>;
  createScannedItem(data: InsertScannedItem): Promise<ScannedItem>;

  // Daily Logs
  getDailySummary(userId: string, date: Date): Promise<DailySummary>;
  createDailyLog(data: InsertDailyLog): Promise<DailyLog>;

  // Meal Plan Recipes
  findMealPlanRecipeByExternalId(
    userId: string,
    externalId: string,
  ): Promise<MealPlanRecipe | undefined>;
  getMealPlanRecipe(id: number): Promise<MealPlanRecipe | undefined>;
  getMealPlanRecipeWithIngredients(
    id: number,
  ): Promise<
    (MealPlanRecipe & { ingredients: RecipeIngredient[] }) | undefined
  >;
  getUserMealPlanRecipes(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ items: MealPlanRecipe[]; total: number }>;
  createMealPlanRecipe(
    recipe: InsertMealPlanRecipe,
    ingredients?: InsertRecipeIngredient[],
  ): Promise<MealPlanRecipe>;
  updateMealPlanRecipe(
    id: number,
    userId: string,
    updates: Partial<InsertMealPlanRecipe>,
  ): Promise<MealPlanRecipe | undefined>;
  deleteMealPlanRecipe(id: number, userId: string): Promise<boolean>;

  // Meal Plan Items
  getMealPlanItems(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<MealPlanItemWithRelations[]>;
  addMealPlanItem(item: InsertMealPlanItem): Promise<MealPlanItem>;
  removeMealPlanItem(id: number, userId: string): Promise<boolean>;
}
```

### Meal Planning Services

#### Recipe Catalog (`server/services/recipe-catalog.ts`)

Integrates with the Spoonacular API for browsing and importing catalog recipes.

```
┌─────────────────────────────────────────────────────────────────┐
│                  Recipe Catalog Pipeline                          │
└─────────────────────────────────────────────────────────────────┘

RecipeBrowserScreen
    │
    ├─ Search ──► GET /api/meal-plan/catalog/search
    │                  │
    │                  ▼
    │             ┌───────────────────┐
    │             │ Spoonacular API   │  query, cuisine, diet filters
    │             │ /complexSearch    │
    │             └────────┬──────────┘
    │                      │
    │                      ▼
    │             { results, totalResults, offset }
    │
    ├─ Preview ──► GET /api/meal-plan/catalog/:id
    │                  │
    │                  ▼
    │             ┌───────────────────┐
    │             │ Spoonacular API   │  Full recipe with nutrition
    │             │ /:id/information  │  and extended ingredients
    │             └───────────────────┘
    │
    └─ Save ────► POST /api/meal-plan/catalog/:id/save
                       │
                       ▼
                  Convert Spoonacular recipe → mealPlanRecipes row
                  + recipeIngredients rows
```

**Key functions**: `searchCatalog()`, `getCatalogRecipeDetail()`, `saveCatalogRecipeToDatabase()`

**Auth**: Requires `SPOONACULAR_API_KEY` environment variable.

#### Recipe URL Import (`server/services/recipe-import.ts`)

Extracts recipe data from any URL containing schema.org Recipe structured data (LD+JSON).

```
┌─────────────────────────────────────────────────────────────────┐
│                  Recipe Import Pipeline                           │
└─────────────────────────────────────────────────────────────────┘

RecipeImportScreen
    │
    │  POST /api/meal-plan/recipes/import-url { url }
    │
    ▼
┌───────────────────────┐
│ Fetch URL             │  10s timeout, 5 MB max
│ (cheerio HTML parser) │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ Find <script> tags    │  type="application/ld+json"
│ with schema.org data  │
└──────────┬────────────┘
           │
      ┌────┴──────┐
   Found      Not Found → { error: "NO_RECIPE_DATA" }
      │
      ▼
┌───────────────────────┐
│ Parse Recipe schema   │  name, description, ingredients,
│ with Zod validation   │  instructions, prep/cook time,
│                       │  nutrition, cuisine, diet tags
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ Return ImportResult   │  → Prefills RecipeCreateScreen
│ { success, data }     │
└───────────────────────┘
```

**Key functions**: `importRecipeFromUrl()`, `parseIsoDuration()`, `normalizeInstructions()`

---

## Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Authentication Flow                           │
└─────────────────────────────────────────────────────────────────┘

Registration:
┌────────┐    POST /auth/register    ┌────────┐    bcrypt.hash    ┌────────┐
│ Client │ ──────────────────────────▶ Server │ ─────────────────▶│   DB   │
└────────┘                           └────────┘                   └────────┘
    ▲                                     │
    │       { token: "jwt..." }           │
    └─────────────────────────────────────┘

Login:
┌────────┐    POST /auth/login       ┌────────┐  bcrypt.compare   ┌────────┐
│ Client │ ──────────────────────────▶ Server │ ─────────────────▶│   DB   │
└────────┘                           └────────┘                   └────────┘
    ▲                                     │
    │       { token: "jwt..." }           │
    └─────────────────────────────────────┘

Subsequent Requests:
┌────────┐  Authorization: Bearer    ┌────────┐   jwt.verify      ┌────────┐
│ Client │ ──────────────────────────▶ Server │ ─────────────────▶│Validate│
└────────┘                           └────────┘                   │ Token  │
    │                                     │                       └────────┘
    │                                     │
    │       Response with data            │
    ◀─────────────────────────────────────┘

Client-Side Auth Check:
┌──────────────────────────────────────────────────────────────┐
│                        App Launch                            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Check AsyncStorage for token │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌──────────────────┐          ┌──────────────────┐
    │   Token Found    │          │  No Token Found  │
    │  GET /auth/me    │          │  Show Login      │
    └────────┬─────────┘          └──────────────────┘
             │
             ▼
    ┌──────────────────┐
    │  Valid Token?    │
    └────────┬─────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌─────────┐      ┌─────────┐
│  Yes    │      │   No    │
│Show Main│      │Show Login│
└─────────┘      └─────────┘
```

---

## AI Integration

### Suggestion Generation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   AI Suggestions Pipeline                        │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│ ItemDetailScreen │
│ POST /api/items/ │
│   :id/suggestions│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Fetch Item &    │
│  User Profile    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Build Prompt    │
│  with Context:   │
│  - Product name  │
│  - Brand         │
│  - Allergies     │
│  - Diet type     │
│  - Cooking skill │
│  - Time available│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   OpenAI API     │
│   gpt-4o-mini    │
│   JSON mode      │
│   max 1024 tokens│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Parse JSON      │
│  4 suggestions:  │
│  - 2 recipes     │
│  - 1 craft       │
│  - 1 pairing     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Return to Client │
└──────────────────┘
```

### Photo Analysis Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                   Photo Analysis Pipeline                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│   ScanScreen     │
│  (capture photo) │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌───────────────────────────┐
│ PhotoIntentScreen│     │  Intent options:           │
│  Select intent   │────▶│  log | calories | recipe | │
└────────┬─────────┘     │  identify                 │
         │               └───────────────────────────┘
         ▼
┌──────────────────┐
│PhotoAnalysisScreen│
│ Compress & upload│
│ POST /api/photos/│
│    analyze       │
└────────┬─────────┘
         │ multipart (photo + intent)
         ▼
┌──────────────────┐     ┌───────────────────────────┐
│  Check Scan      │     │  Free: 10/day             │
│  Quota           │────▶│  Premium: unlimited       │
└────────┬─────────┘     └───────────────────────────┘
         │ within quota
         ▼
┌──────────────────┐
│  OpenAI GPT-4o   │
│  Vision API      │
│  detail="low"    │
│  JSON mode       │
│  Intent-specific │
│  prompt          │
└────────┬─────────┘
         │ AnalysisResult { foods[], overallConfidence }
         ▼
┌──────────────────┐
│ needsNutrition?  │
│ (log or calories)│
└────────┬─────────┘
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌────────┐
│  Yes   │ │   No   │
│ Batch  │ │ Skip   │
│ lookup │ │        │
└───┬────┘ └───┬────┘
    │          │
    ▼          ▼
┌──────────────────┐
│ confidence < 0.7 │
│ or clarifications│
│ needed?          │
└────────┬─────────┘
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌────────────────┐
│  Yes   │ │  No            │
│ Show   │ │  Show results  │
│ Follow │ │  directly      │
│ Up     │ └────────┬───────┘
│ Modal  │          │
└───┬────┘          │
    │               │
    ▼               │
┌──────────────┐    │
│ POST followup│    │
│ refineAnalysis│   │
│ Re-lookup    │    │
│ nutrition    │    │
└───────┬──────┘    │
        │           │
        ▼           ▼
┌──────────────────────────┐
│  Intent-specific action  │
├──────────────────────────┤
│ log:      Select items,  │
│           pick prep,     │
│           POST /confirm  │
│           → scannedItems │
│           → dailyLogs    │
│                          │
│ calories: Read-only view │
│                          │
│ recipe:   Open recipe    │
│           generation     │
│                          │
│ identify: Read-only list │
└──────────────────────────┘
```

**Key implementation details:**

- **In-memory session store** — analysis sessions are stored server-side with a 30-minute TTL and auto-cleanup. Sessions track `userId`, `result`, and `imageBase64`. Only the `log` intent creates a persistent session (`needsSession: true` in `INTENT_CONFIG`)
- **Intent-aware prompts** — `getPromptForIntent()` returns different system prompts and token limits per intent (e.g. `log`/`calories` get 500 tokens with nutrition detail, `identify` gets 300 tokens)
- **Image optimization** — client compresses photos to <1MB before upload; server uses Vision API `detail="low"` (512px, 85 tokens) for fast analysis
- **Preparation-aware nutrition** — changing a food's preparation method (e.g. raw → steamed) triggers a separate `GET /api/nutrition/lookup` call with the modified query

---

## Premium Subscription System

```
┌──────────────────────────────────────────────────────────────┐
│                  Premium Tier Architecture                     │
└──────────────────────────────────────────────────────────────┘

                    Two Tiers: free / premium
                    ─────────────────────────

┌───────────────────────────┐    ┌───────────────────────────┐
│        Free Tier          │    │      Premium Tier          │
├───────────────────────────┤    ├───────────────────────────┤
│ 10 daily scans            │    │ Unlimited scans            │
│ Standard barcodes (EAN)   │    │ All barcode types          │
│ Balanced photo quality    │    │ High-quality capture       │
│ Calorie goal only         │    │ Full macro goals (P/C/F)   │
│ No recipe generation      │    │ 5 AI recipes/day           │
│ 6 saved items max         │    │ Unlimited saved items      │
│ Photo analysis ✓          │    │ Photo analysis ✓           │
└───────────────────────────┘    └───────────────────────────┘
```

**Enforcement model:**

- **Server-side** (critical) — scan counting, recipe generation limits, saved item caps. Server returns `403 PREMIUM_REQUIRED` or `429` with limit details
- **Client-side** (camera/UI) — photo quality (`photoQualityBalance`), barcode type filtering, macro goal visibility. Enforced via `PremiumContext` + `usePremiumCamera()` hook
- **Dual** — scan limits checked client-side for UX (prevents wasted camera use), but scan records are always created server-side

**Subscription lifecycle:**

1. `GET /api/subscription/status` returns `{ tier, expiresAt, features, isActive }`
2. Server checks `subscriptionExpiresAt > now()` — if expired, downgrades to free in response
3. Client caches status for 5 minutes (TanStack Query staleTime)
4. Scan count cached for 30 seconds, refreshed after each successful scan

> **Note:** Payment integration is not yet implemented. Tier is set manually via the storage layer (`storage.updateSubscription()`).

---

## Theming System

```
┌─────────────────────────────────────────────────────────────────┐
│                      Theme Architecture                          │
└─────────────────────────────────────────────────────────────────┘

client/constants/theme.ts
├── Colors
│   ├── light (default)
│   │   ├── text: "#1A1A1A"
│   │   ├── textSecondary: "#757575"
│   │   ├── success: "#00C853" (primary green)
│   │   ├── calorieAccent: "#FF6B35" (orange)
│   │   ├── proteinAccent: "#00C853" (green)
│   │   ├── carbsAccent: "#FF6B35" (orange)
│   │   └── fatAccent: "#FFC107" (yellow)
│   │
│   └── dark
│       ├── text: "#ECEDEE"
│       ├── backgroundRoot: "#121212"
│       └── (inverted colors)
│
├── Spacing
│   ├── xs: 4px
│   ├── sm: 8px
│   ├── md: 12px
│   ├── lg: 16px
│   ├── xl: 20px
│   └── inputHeight: 48px
│
├── Typography
│   ├── h1: { fontSize: 32, fontWeight: 700 }
│   ├── h2: { fontSize: 28, fontWeight: 700 }
│   ├── body: { fontSize: 16, fontWeight: 400 }
│   └── caption: { fontSize: 12, fontWeight: 400 }
│
├── BorderRadius
│   ├── xs: 8px
│   ├── sm: 12px
│   └── full: 9999px
│
└── Shadows
    ├── small: { elevation: 1 }
    ├── medium: { elevation: 2 }
    └── large: { elevation: 4 }

Usage:
┌──────────────────────────────────────────────────────────────────┐
│ const { theme, isDark } = useTheme();                            │
│                                                                  │
│ <View style={{ backgroundColor: theme.backgroundRoot }}>        │
│   <Text style={{ color: theme.text }}>Hello</Text>              │
│ </View>                                                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

### Development

```
┌─────────────────────────────────────────────────────────────────┐
│                  Development Environment                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────┐
│  Developer   │         │   Mobile     │
│    Mac       │         │   Device     │
├──────────────┤         └──────┬───────┘
│              │                │
│ Terminal 1:  │                │ Expo Go App
│ npm run      │                │
│ server:dev   │◄───────────────┘
│ (port 3000)  │     via localtunnel
│              │
│ Terminal 2:  │◄──────── QR Code
│ npm run      │          Scan
│ expo:dev     │
│ (tunnel)     │
│              │
│ Terminal 3:  │
│ npx local-   │
│ tunnel :3000 │
│              │
└──────────────┘
        │
        ▼
┌──────────────┐
│ PostgreSQL   │
│ (local)      │
└──────────────┘
```

### Production (Future)

```
┌─────────────────────────────────────────────────────────────────┐
│                  Production Architecture                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   App Store  │     │   EAS Build  │     │   Backend    │
│   (iOS)      │     │   Service    │     │   Server     │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │ PostgreSQL   │
                                          │ (Managed)    │
                                          └──────────────┘
```

---

## Security Considerations

### Authentication

- Passwords hashed with bcrypt (10 rounds)
- JWT tokens via Authorization: Bearer header
- Tokens signed with JWT_SECRET env var
- 30-day token expiry

### CORS

- Development: All origins allowed
- Production: Should restrict to app domains

### Data Protection

- User data isolated by userId
- Cascade deletes for data cleanup
- No sensitive data in URLs

### API Security

- JWT validation on all protected routes
- Input validation with Zod schemas
- Error messages don't leak implementation details
