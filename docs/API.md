# NutriScan API Reference

## Overview

The NutriScan API is a RESTful API built with Express.js 5.0. All endpoints use JSON for request/response bodies and JWT-based authentication.

**Base URL**: `http://192.168.137.175:3000` (development) or your production domain

## Authentication

The API uses JWT (JSON Web Token) authentication via the `Authorization` header. Tokens are valid for 30 days.

### Token Configuration

```typescript
// server/middleware/auth.ts
jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
```

**Important**: All authenticated requests must include `Authorization: Bearer <token>` header. Login/register responses return a `token` field that should be stored client-side (AsyncStorage) and sent with every request.

---

## Endpoints

### Authentication

#### Register User

Creates a new user account and returns a JWT token.

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "string",
  "password": "string"
}
```

**Response** `201 Created`

```json
{
  "id": "uuid",
  "username": "string",
  "displayName": null,
  "dailyCalorieGoal": 2000,
  "onboardingCompleted": false
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | Username and password are required |
| 409 | Username already exists |
| 500 | Failed to create account |

---

#### Login

Authenticates a user and returns a JWT token.

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "string",
  "password": "string"
}
```

**Response** `200 OK`

```json
{
  "id": "uuid",
  "username": "string",
  "displayName": "string | null",
  "dailyCalorieGoal": 2000,
  "onboardingCompleted": false
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | Username and password are required |
| 401 | Invalid credentials |
| 500 | Failed to login |

---

#### Logout

Client-side only: discard the stored JWT token.

```http
POST /api/auth/logout
```

**Response** `200 OK`

```json
{
  "success": true
}
```

---

#### Get Current User

Returns the authenticated user's information.

```http
GET /api/auth/me
```

**Response** `200 OK`

```json
{
  "id": "uuid",
  "username": "string",
  "displayName": "string | null",
  "dailyCalorieGoal": 2000,
  "onboardingCompleted": true
}
```

**Errors**
| Status | Message |
|--------|---------|
| 401 | Not authenticated |

---

#### Update Profile

Updates the current user's profile settings.

```http
PUT /api/auth/profile
Content-Type: application/json

{
  "displayName": "string",
  "dailyCalorieGoal": 2500,
  "onboardingCompleted": true
}
```

All fields are optional. Only provided fields will be updated.

**Response** `200 OK`

```json
{
  "id": "uuid",
  "username": "string",
  "displayName": "string",
  "dailyCalorieGoal": 2500,
  "onboardingCompleted": true
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | No valid fields to update |
| 401 | Not authenticated |
| 404 | User not found |

---

### Dietary Profile

#### Get Dietary Profile

Fetches the user's dietary preferences and restrictions.

```http
GET /api/user/dietary-profile
```

**Response** `200 OK`

```json
{
  "id": 1,
  "userId": "uuid",
  "allergies": [
    { "name": "peanuts", "severity": "severe" },
    { "name": "dairy", "severity": "mild" }
  ],
  "healthConditions": ["diabetes", "high_blood_pressure"],
  "dietType": "vegetarian",
  "foodDislikes": ["mushrooms", "olives"],
  "primaryGoal": "lose_weight",
  "activityLevel": "moderate",
  "householdSize": 2,
  "cuisinePreferences": ["italian", "mexican", "asian"],
  "cookingSkillLevel": "intermediate",
  "cookingTimeAvailable": "moderate",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

Returns `null` if no profile exists.

---

#### Create Dietary Profile

Creates or updates the user's dietary profile. Automatically marks onboarding as completed.

```http
POST /api/user/dietary-profile
Content-Type: application/json

{
  "allergies": [
    { "name": "string", "severity": "mild|moderate|severe" }
  ],
  "healthConditions": ["string"],
  "dietType": "omnivore|vegetarian|vegan|pescatarian|keto|paleo|gluten_free",
  "foodDislikes": ["string"],
  "primaryGoal": "lose_weight|gain_muscle|maintain|eat_healthier",
  "activityLevel": "sedentary|light|moderate|active|athlete",
  "householdSize": 1,
  "cuisinePreferences": ["string"],
  "cookingSkillLevel": "beginner|intermediate|advanced",
  "cookingTimeAvailable": "quick|moderate|extended|leisurely"
}
```

**Response** `201 Created` - Returns the created/updated profile object.

---

#### Update Dietary Profile

Partially updates the user's dietary profile.

```http
PUT /api/user/dietary-profile
Content-Type: application/json

{
  "dietType": "vegan",
  "activityLevel": "active"
}
```

**Response** `200 OK` - Returns the updated profile object.

**Errors**
| Status | Message |
|--------|---------|
| 401 | Not authenticated |
| 404 | Profile not found |

---

### Scanned Items

#### List Scanned Items

Returns all items scanned by the user, ordered by most recent first.

```http
GET /api/scanned-items
```

**Response** `200 OK`

```json
[
  {
    "id": 1,
    "userId": "uuid",
    "barcode": "012345678901",
    "productName": "Organic Apple Juice",
    "brandName": "Nature's Best",
    "servingSize": "8 fl oz (240ml)",
    "calories": "120.00",
    "protein": "0.00",
    "carbs": "29.00",
    "fat": "0.00",
    "fiber": "0.00",
    "sugar": "26.00",
    "sodium": "10.00",
    "imageUrl": "https://example.com/image.jpg",
    "scannedAt": "2024-01-15T14:30:00.000Z"
  }
]
```

---

#### Get Scanned Item

Retrieves a single scanned item by ID.

```http
GET /api/scanned-items/:id
```

**Response** `200 OK` - Returns the item object.

**Errors**
| Status | Message |
|--------|---------|
| 404 | Item not found |

---

#### Create Scanned Item

Creates a new scanned item and automatically logs it to the daily food log.

```http
POST /api/scanned-items
Content-Type: application/json

{
  "barcode": "012345678901",
  "productName": "Organic Apple Juice",
  "brandName": "Nature's Best",
  "servingSize": "8 fl oz (240ml)",
  "calories": 120,
  "protein": 0,
  "carbs": 29,
  "fat": 0,
  "fiber": 0,
  "sugar": 26,
  "sodium": 10,
  "imageUrl": "https://example.com/image.jpg"
}
```

**Response** `201 Created` - Returns the created item object.

**Note**: A daily log entry with `servings: 1` is automatically created.

---

### Nutrition Lookup

#### Barcode Lookup

Looks up nutrition data for a product barcode. Uses a multi-source pipeline:
Open Food Facts → USDA branded UPC fallback → cross-validation with CNF/USDA.

Barcode padding is handled automatically (UPC-A ↔ EAN-13 variants, zero-padding,
check-digit computation).

```http
GET /api/nutrition/barcode/:code
```

**Path Parameters**
| Parameter | Type | Validation | Description |
|-----------|------|------------|-------------|
| code | string | Digits only, max 50 chars | UPC/EAN barcode |

**Response** `200 OK` — Product found

```json
{
  "productName": "Good Host Iced Tea",
  "brandName": "Good Host",
  "servingSize": "250 ml",
  "calories": 90,
  "protein": 0,
  "carbs": 23,
  "fat": 0,
  "fiber": 0,
  "sugar": 22,
  "sodium": 15,
  "imageUrl": "https://images.openfoodfacts.org/...",
  "source": "cnf"
}
```

**Response** `404 Not Found` — Product not in any database

```json
{
  "notInDatabase": true,
  "message": "Product not found in any database"
}
```

The `notInDatabase` flag is used by the client to show a manual product name
search UI instead of an error.

**Response** `400 Bad Request`

```json
{
  "error": "Invalid barcode format"
}
```

**Source Values**
| Value | Meaning |
|-------|---------|
| `cnf` | Canadian Nutrient File (cross-validated) |
| `usda` | USDA FoodData Central |
| `api-ninjas` | API Ninjas fallback |
| `cache` | Previously cached result |

---

#### Nutrition Text Lookup

Looks up nutrition data by food name. Uses priority chain: CNF → USDA → API Ninjas.

```http
GET /api/nutrition/lookup?name=coffee+whitener
```

**Query Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| name | string | Food name to search for |

**Response** `200 OK`

```json
{
  "productName": "Coffee whitener, powder",
  "calories": 515,
  "protein": 2.5,
  "carbs": 55.2,
  "fat": 33.4,
  "fiber": 0,
  "sugar": 54.2,
  "sodium": 230,
  "source": "cnf"
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | Food name is required |
| 404 | No nutrition data found |

---

#### Get Daily Summary

Returns aggregated nutritional data for a specific day.

```http
GET /api/daily-summary?date=2024-01-15
```

**Query Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| date | ISO string | today | Date to get summary for |

**Response** `200 OK`

```json
{
  "totalCalories": 1850,
  "totalProtein": 75,
  "totalCarbs": 220,
  "totalFat": 65,
  "itemCount": 8
}
```

---

### AI Suggestions

#### Generate Suggestions

Generates AI-powered suggestions for a scanned item using OpenAI's GPT-4o-mini model.

```http
POST /api/items/:id/suggestions
```

**Response** `200 OK`

```json
{
  "suggestions": [
    {
      "type": "recipe",
      "title": "Apple Juice Smoothie Bowl",
      "description": "Blend with frozen berries and top with granola for a refreshing breakfast.",
      "difficulty": "Easy",
      "timeEstimate": "10 min"
    },
    {
      "type": "recipe",
      "title": "Apple Juice Glazed Chicken",
      "description": "Use as a base for a sweet and tangy glaze for grilled chicken.",
      "difficulty": "Medium",
      "timeEstimate": "45 min"
    },
    {
      "type": "craft",
      "title": "Juice Carton Birdhouse",
      "description": "Transform the empty carton into a colorful birdhouse for the garden.",
      "timeEstimate": "30 min"
    },
    {
      "type": "pairing",
      "title": "Perfect Pairings",
      "description": "Pairs well with sharp cheddar, cinnamon pastries, or as a mixer with sparkling water."
    }
  ]
}
```

**Suggestion Types**
| Type | Description |
|------|-------------|
| recipe | Cooking ideas using the scanned item |
| craft | Kid-friendly activities |
| pairing | Complementary foods and drinks |

**Errors**
| Status | Message |
|--------|---------|
| 401 | Not authenticated |
| 404 | Item not found |
| 500 | Failed to generate suggestions |

---

### Photo Analysis

#### Analyze Photo

Uploads a food photo for AI-powered identification using OpenAI's GPT-4o Vision model. Returns detected foods with optional nutrition data. Rate limited to 10 requests per minute.

```http
POST /api/photos/analyze
Content-Type: multipart/form-data
```

**Request (multipart)**

| Field  | Type   | Required | Description                                                    |
| ------ | ------ | -------- | -------------------------------------------------------------- |
| photo  | File   | Yes      | Food photo (JPEG/PNG)                                          |
| intent | string | No       | One of `log`, `calories`, `recipe`, `identify`. Default: `log` |

**Response** `200 OK`

```json
{
  "sessionId": "uuid-string",
  "intent": "log",
  "foods": [
    {
      "name": "grilled chicken breast",
      "quantity": "1 piece (~150g)",
      "confidence": 0.85,
      "needsClarification": false,
      "category": "protein",
      "nutrition": {
        "name": "grilled chicken breast",
        "calories": 284,
        "protein": 53,
        "carbs": 0,
        "fat": 6,
        "fiber": 0,
        "sugar": 0,
        "sodium": 120,
        "servingSize": "150g",
        "source": "usda"
      }
    }
  ],
  "overallConfidence": 0.85,
  "needsFollowUp": false,
  "followUpQuestions": []
}
```

`nutrition` is only populated for intents that need it (`log`, `calories`). For `identify` and `recipe` intents it will be `null`.

**Errors**

| Status | Message                                                     |
| ------ | ----------------------------------------------------------- |
| 400    | No photo provided                                           |
| 401    | Not authenticated                                           |
| 429    | Daily scan limit reached (free: 10/day, premium: unlimited) |
| 500    | Vision API error                                            |

#### Submit Follow-up

Refines a previous analysis by answering a clarification question. Only available when `needsFollowUp` was `true` in the analyze response. Sessions expire after 30 minutes.

```http
POST /api/photos/analyze/:sessionId/followup
```

**Path Parameters**

| Param     | Description                          |
| --------- | ------------------------------------ |
| sessionId | Session ID from the analyze response |

**Request**

```json
{
  "question": "Is the chicken grilled or fried?",
  "answer": "It's grilled with olive oil"
}
```

| Field    | Type   | Max Length | Description                |
| -------- | ------ | ---------- | -------------------------- |
| question | string | 500 chars  | The clarification question |
| answer   | string | 1000 chars | User's answer              |

**Response** `200 OK`

Same shape as the analyze response with updated foods, confidence, and follow-up status.

**Errors**

| Status | Message                      |
| ------ | ---------------------------- |
| 401    | Not authenticated            |
| 404    | Session not found or expired |

#### Confirm Photo Analysis

Saves the analysis result to the database as a scanned item and daily log entry. Only applicable for the `log` intent.

```http
POST /api/photos/confirm
```

**Request**

```json
{
  "sessionId": "uuid-string",
  "foods": [
    {
      "name": "grilled chicken breast",
      "quantity": "1 piece",
      "calories": 284,
      "protein": 53,
      "carbs": 0,
      "fat": 6
    }
  ],
  "mealType": "lunch",
  "preparationMethods": [{ "name": "chicken breast", "method": "Grilled" }],
  "analysisIntent": "log"
}
```

| Field              | Type   | Required | Description                 |
| ------------------ | ------ | -------- | --------------------------- |
| sessionId          | string | Yes      | Session ID from analyze     |
| foods              | array  | Yes      | Foods to log with nutrition |
| mealType           | string | No       | e.g. "breakfast", "lunch"   |
| preparationMethods | array  | No       | Per-food `{ name, method }` |
| analysisIntent     | string | No       | Original intent             |

**Response** `201 Created`

```json
{
  "id": 42,
  "userId": "uuid",
  "productName": "grilled chicken breast",
  "calories": "284.00",
  "protein": "53.00",
  "carbs": "0.00",
  "fat": "6.00",
  "sourceType": "photo",
  "aiConfidence": "0.85",
  "preparationMethods": [{ "name": "chicken breast", "method": "Grilled" }],
  "analysisIntent": "log",
  "scannedAt": "2026-02-08T12:00:00.000Z"
}
```

**Errors**

| Status | Message                      |
| ------ | ---------------------------- |
| 400    | Invalid request body         |
| 401    | Not authenticated            |
| 404    | Session not found or expired |

---

### Meal Plan Recipes

#### List User Recipes

Returns all meal plan recipes created by the authenticated user.

```http
GET /api/meal-plan/recipes
```

**Response** `200 OK`

```json
{
  "items": [
    {
      "id": 1,
      "userId": "uuid",
      "title": "Chicken Stir Fry",
      "description": "Quick weeknight dinner",
      "sourceType": "user_created",
      "sourceUrl": null,
      "externalId": null,
      "cuisine": "Asian",
      "difficulty": "Easy",
      "servings": 2,
      "prepTimeMinutes": 10,
      "cookTimeMinutes": 15,
      "imageUrl": null,
      "instructions": "1. Dice chicken...\n2. Heat oil...",
      "dietTags": [],
      "caloriesPerServing": "350.00",
      "proteinPerServing": "30.00",
      "carbsPerServing": "25.00",
      "fatPerServing": "12.00",
      "fiberPerServing": null,
      "sugarPerServing": null,
      "sodiumPerServing": null,
      "createdAt": "2026-01-15T10:30:00.000Z",
      "updatedAt": "2026-01-15T10:30:00.000Z"
    }
  ],
  "total": 1
}
```

---

#### Get Recipe with Ingredients

Returns a single recipe with its full ingredient list.

```http
GET /api/meal-plan/recipes/:id
```

**Response** `200 OK`

```json
{
  "id": 1,
  "title": "Chicken Stir Fry",
  "ingredients": [
    {
      "id": 1,
      "recipeId": 1,
      "name": "chicken breast",
      "quantity": "200.00",
      "unit": "g",
      "category": "protein",
      "displayOrder": 0
    }
  ]
}
```

**Errors**
| Status | Message |
|--------|---------|
| 404 | Recipe not found |

---

#### Create Recipe

Creates a new meal plan recipe with optional ingredients.

```http
POST /api/meal-plan/recipes
Content-Type: application/json

{
  "title": "Chicken Stir Fry",
  "description": "Quick weeknight dinner",
  "cuisine": "Asian",
  "difficulty": "Easy",
  "servings": 2,
  "prepTimeMinutes": 10,
  "cookTimeMinutes": 15,
  "instructions": "1. Dice chicken...\n2. Heat oil...",
  "dietTags": ["gluten_free"],
  "caloriesPerServing": 350,
  "proteinPerServing": 30,
  "carbsPerServing": 25,
  "fatPerServing": 12,
  "ingredients": [
    { "name": "chicken breast", "quantity": 200, "unit": "g", "category": "protein" }
  ]
}
```

**Response** `201 Created` — Returns the created recipe object.

---

#### Update Recipe

Updates an existing meal plan recipe.

```http
PUT /api/meal-plan/recipes/:id
Content-Type: application/json
```

Body: same fields as create (all optional). Returns the updated recipe.

**Errors**
| Status | Message |
|--------|---------|
| 404 | Recipe not found |

---

#### Delete Recipe

Deletes a meal plan recipe and its ingredients (cascade).

```http
DELETE /api/meal-plan/recipes/:id
```

**Response** `204 No Content`

---

### Meal Plan Items

#### Get Meal Plan Items

Returns meal plan items for a date range, with related recipe and scanned item data.

```http
GET /api/meal-plan?start=2026-01-15&end=2026-01-21
```

**Query Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| start | ISO date string | Yes | Start of date range (YYYY-MM-DD) |
| end | ISO date string | Yes | End of date range (YYYY-MM-DD) |

**Response** `200 OK`

```json
[
  {
    "id": 1,
    "userId": "uuid",
    "recipeId": 5,
    "scannedItemId": null,
    "plannedDate": "2026-01-15",
    "mealType": "dinner",
    "servings": "1.00",
    "createdAt": "2026-01-14T20:00:00.000Z",
    "recipe": {
      "id": 5,
      "title": "Chicken Stir Fry",
      "caloriesPerServing": "350.00"
    },
    "scannedItem": null
  }
]
```

---

#### Add Item to Meal Plan

Adds a recipe or scanned item to a meal plan slot.

```http
POST /api/meal-plan/items
Content-Type: application/json

{
  "recipeId": 5,
  "plannedDate": "2026-01-15",
  "mealType": "dinner",
  "servings": 1
}
```

**Body Fields**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| recipeId | number | No* | Meal plan recipe ID |
| scannedItemId | number | No* | Scanned item ID |
| plannedDate | string | Yes | Date (YYYY-MM-DD) |
| mealType | string | Yes | `breakfast`, `lunch`, `dinner`, or `snack` |
| servings | number | No | Defaults to 1 |

\* At least one of `recipeId` or `scannedItemId` must be provided.

**Response** `201 Created` — Returns the created meal plan item.

---

#### Remove Item from Meal Plan

Removes an item from the meal plan.

```http
DELETE /api/meal-plan/items/:id
```

**Response** `204 No Content`

---

### Recipe Catalog (Spoonacular)

#### Search Catalog

Searches the Spoonacular recipe catalog with optional filters.

```http
GET /api/meal-plan/catalog/search?query=pasta&cuisine=Italian&diet=vegetarian&number=10
```

**Query Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| query | string | — | Search query |
| cuisine | string | — | Cuisine filter (e.g., Italian, Mexican, Asian) |
| diet | string | — | Diet filter (e.g., vegetarian, vegan, keto) |
| type | string | — | Meal type filter |
| maxReadyTime | number | — | Max prep+cook time in minutes (1-1440) |
| number | number | 10 | Max results to return |
| offset | number | 0 | Pagination offset |

**Response** `200 OK`

```json
{
  "results": [
    {
      "id": 12345,
      "title": "Pasta Primavera",
      "image": "https://...",
      "readyInMinutes": 30
    }
  ],
  "offset": 0,
  "number": 10,
  "totalResults": 42
}
```

**Errors**
| Status | Message |
|--------|---------|
| 402 | Spoonacular API quota exceeded (CATALOG_QUOTA_EXCEEDED) |

---

#### Get Catalog Recipe Preview

Fetches detailed information about a Spoonacular recipe.

```http
GET /api/meal-plan/catalog/:id
```

**Response** `200 OK` — Full recipe details including nutrition and ingredients.

**Errors**
| Status | Message |
|--------|---------|
| 402 | Spoonacular API quota exceeded (CATALOG_QUOTA_EXCEEDED) |

---

#### Save Catalog Recipe

Saves a Spoonacular recipe to the user's meal plan recipe collection. If the recipe was already saved (dedup by `externalId`), returns the existing record.

```http
POST /api/meal-plan/catalog/:id/save
```

**Response** `201 Created` — Returns the newly saved `MealPlanRecipe` object.

**Response** `200 OK` — Recipe was already saved; returns the existing `MealPlanRecipe`.

**Errors**
| Status | Message |
|--------|---------|
| 402 | Spoonacular API quota exceeded (CATALOG_QUOTA_EXCEEDED) |

---

### Recipe Import

#### Import Recipe from URL

Imports a recipe from a URL by parsing schema.org Recipe structured data (LD+JSON), saves it to the database as a `MealPlanRecipe` with `sourceType: "url_import"`.

```http
POST /api/meal-plan/recipes/import-url
Content-Type: application/json

{
  "url": "https://example.com/recipe/chicken-stir-fry"
}
```

**Response** `201 Created` — Returns the saved `MealPlanRecipe` object (with `id`, `userId`, `createdAt`, etc.).

**Error Response** `422 Unprocessable Entity`

```json
{
  "error": "NO_RECIPE_DATA",
  "message": "No recipe structured data found on page"
}
```

**Error Types**
| Error Code | Description |
|------------|-------------|
| NO_RECIPE_DATA | Page has no schema.org Recipe markup |
| FETCH_FAILED | Could not fetch the URL |
| PARSE_ERROR | Recipe data could not be parsed |
| TIMEOUT | Request exceeded 10 second timeout |
| RESPONSE_TOO_LARGE | Page exceeds 5 MB limit |

---

### Subscription

#### Get Subscription Status

Returns the user's current subscription tier and feature flags.

```http
GET /api/subscription/status
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "tier": "free",
  "expiresAt": null,
  "features": {
    "maxDailyScans": 10,
    "advancedBarcodes": false,
    "highQualityCapture": false,
    "videoRecording": false,
    "photoAnalysis": true,
    "macroGoals": false,
    "recipeGeneration": false,
    "dailyRecipeGenerations": 0
  },
  "isActive": true
}
```

If the user's premium subscription has expired, the server returns free-tier features regardless of the stored tier.

---

#### Get Daily Scan Count

Returns the number of items scanned today.

```http
GET /api/subscription/scan-count
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "count": 3
}
```

---

#### Get Recipe Generation Status

Returns today's recipe generation usage and limits.

```http
GET /api/recipes/generation-status
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "generationsToday": 2,
  "dailyLimit": 5,
  "canGenerate": true
}
```

Free users receive `dailyLimit: 0` and `canGenerate: false`.

---

#### Premium Error Responses

Endpoints gated behind premium return these error codes:

| Status | Code                  | Description                                                               |
| ------ | --------------------- | ------------------------------------------------------------------------- |
| 403    | `PREMIUM_REQUIRED`    | Feature requires a premium subscription                                   |
| 429    | `DAILY_LIMIT_REACHED` | Daily usage limit exceeded (includes `generationsToday` and `dailyLimit`) |

---

## Data Types

### Allergy

```typescript
interface Allergy {
  name: string;
  severity: "mild" | "moderate" | "severe";
}
```

### Diet Types

- `omnivore`
- `vegetarian`
- `vegan`
- `pescatarian`
- `keto`
- `paleo`
- `gluten_free`

### Activity Levels

- `sedentary` - Little to no exercise
- `light` - Light exercise 1-3 days/week
- `moderate` - Moderate exercise 3-5 days/week
- `active` - Hard exercise 6-7 days/week
- `athlete` - Very hard exercise, physical job

### Primary Goals

- `lose_weight`
- `gain_muscle`
- `maintain`
- `eat_healthier`

### Cooking Skill Levels

- `beginner`
- `intermediate`
- `advanced`

### Cooking Time Available

- `quick` - Under 15 minutes
- `moderate` - 15-30 minutes
- `extended` - 30-60 minutes
- `leisurely` - Over 60 minutes

---

## Error Handling

All error responses follow this format:

```json
{
  "error": "Human-readable error message"
}
```

### Common HTTP Status Codes

| Status | Meaning                            |
| ------ | ---------------------------------- |
| 200    | Success                            |
| 201    | Created                            |
| 400    | Bad Request - Invalid input        |
| 401    | Unauthorized - Not authenticated   |
| 404    | Not Found                          |
| 409    | Conflict - Resource already exists |
| 500    | Internal Server Error              |

---

## Rate Limiting

### Internal Rate Limits

| Endpoint                     | Window   | Max Requests | Key          |
| ---------------------------- | -------- | ------------ | ------------ |
| `POST /api/recipes/generate` | 1 minute | 3            | userId or IP |

Free-tier users also have daily limits enforced server-side:

- **Scans**: 10 per day (counted via `scanned_items` table)
- **Recipe generation**: 0 per day (feature disabled for free tier)
- **Saved items**: 6 maximum (enforced on save)

Premium users have no daily scan limit and can generate up to 5 recipes per day.

### External API Rate Limits

- **Open Food Facts**: No hard limit, but be respectful (User-Agent header sent)
- **USDA FoodData Central**: 1,000 requests/hour per API key
- **Canadian Nutrient File**: No documented limit (government API)
- **API Ninjas**: Depends on plan tier
- **Spoonacular**: Depends on plan tier

---

## Client Integration

### Example: Making API Requests

```typescript
import { apiRequest } from "@/lib/query-client";

// Login
const response = await apiRequest("POST", "/api/auth/login", {
  username: "user",
  password: "pass",
});
const user = await response.json();

// Fetch items
const items = await apiRequest("GET", "/api/scanned-items");
const data = await items.json();

// Create item
await apiRequest("POST", "/api/scanned-items", {
  productName: "Apple",
  calories: 95,
});
```

### TanStack Query Integration

```typescript
import { useQuery } from "@tanstack/react-query";

// Fetch scanned items
const { data: items } = useQuery({
  queryKey: ["/api/scanned-items"],
});

// Fetch daily summary
const { data: summary } = useQuery({
  queryKey: ["/api/daily-summary"],
});
```
