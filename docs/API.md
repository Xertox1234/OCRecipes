# OCRecipes API Reference

## Overview

The OCRecipes API is a RESTful API built with Express.js 5.0 with 40 route modules and 130+ endpoints. All endpoints use JSON for request/response bodies and JWT-based authentication.

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
  "user": {
    "id": "uuid",
    "username": "string",
    "displayName": null,
    "avatarUrl": null,
    "dailyCalorieGoal": null,
    "onboardingCompleted": false,
    "subscriptionTier": "free"
  },
  "token": "jwt-token-string"
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | Zod validation error |
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
  "user": {
    "id": "uuid",
    "username": "string",
    "displayName": "string | null",
    "avatarUrl": "string | null",
    "dailyCalorieGoal": 2000,
    "onboardingCompleted": true,
    "subscriptionTier": "free"
  },
  "token": "jwt-token-string"
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | Zod validation error |
| 401 | Invalid credentials |
| 500 | Failed to log in |

---

#### Logout

Invalidates the current token by incrementing the user's token version. All existing tokens for this user become invalid.

```http
POST /api/auth/logout
Authorization: Bearer <token>
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
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "id": "uuid",
  "username": "string",
  "displayName": "string | null",
  "avatarUrl": "string | null",
  "dailyCalorieGoal": 2000,
  "onboardingCompleted": true,
  "subscriptionTier": "free"
}
```

**Errors**
| Status | Message |
|--------|---------|
| 401 | User not found |

---

#### Update Profile

Updates the current user's profile settings.

```http
PUT /api/auth/profile
Authorization: Bearer <token>
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
  "avatarUrl": "string | null",
  "dailyCalorieGoal": 2500,
  "onboardingCompleted": true,
  "subscriptionTier": "free"
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | No valid fields to update |
| 401 | Not authenticated |
| 404 | User not found |

---

#### Delete Account

Permanently deletes the user's account and all associated data (GDPR/CCPA compliance). Requires password confirmation.

```http
DELETE /api/auth/account
Authorization: Bearer <token>
Content-Type: application/json

{
  "password": "string"
}
```

**Response** `200 OK`

```json
{
  "success": true
}
```

**Errors**
| Status | Message |
|--------|---------|
| 401 | Invalid credentials |
| 404 | User not found |

---

#### Upload Avatar

Uploads a user avatar image (multipart form data). Validates image content via magic bytes (JPEG, PNG, WebP only).

```http
POST /api/user/avatar
Authorization: Bearer <token>
Content-Type: multipart/form-data

avatar: <file>
```

**Response** `200 OK`

```json
{
  "avatarUrl": "/api/avatars/uuid-timestamp.jpg"
}
```

---

#### Delete Avatar

Removes the user's avatar image.

```http
DELETE /api/user/avatar
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "success": true
}
```

---

### Dietary Profile

#### Get Dietary Profile

Fetches the user's dietary preferences and restrictions.

```http
GET /api/user/dietary-profile
Authorization: Bearer <token>
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
Authorization: Bearer <token>
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
Authorization: Bearer <token>
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
Authorization: Bearer <token>
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
Authorization: Bearer <token>
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
Authorization: Bearer <token>
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

#### Delete Scanned Item

Deletes a scanned item and its associated daily logs.

```http
DELETE /api/scanned-items/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

---

#### Toggle Favourite

Adds or removes a scanned item from the user's favourites.

```http
POST /api/scanned-items/:id/favourite
Authorization: Bearer <token>
```

**Response** `200 OK` — Returns `{ favourited: true }` or `{ favourited: false }`.

---

### Nutrition Lookup

#### Barcode Lookup

Looks up nutrition data for a product barcode. Uses a multi-source pipeline:
Open Food Facts → USDA branded UPC fallback → cross-validation with CNF/USDA.

Barcode padding is handled automatically (UPC-A ↔ EAN-13 variants, zero-padding,
check-digit computation).

```http
GET /api/nutrition/barcode/:code
Authorization: Bearer <token>
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
Authorization: Bearer <token>
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
Authorization: Bearer <token>
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

Generates AI-powered suggestions for a scanned item using OpenAI's GPT-4o-mini model. Results are cached per user/item/profile for 30 days.

```http
POST /api/items/:id/suggestions
Authorization: Bearer <token>
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
  ],
  "cacheId": 42
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

#### Get Suggestion Instructions

Generates detailed instructions for a specific suggestion. Results are cached.

```http
POST /api/items/:itemId/suggestions/:suggestionIndex/instructions
Authorization: Bearer <token>
Content-Type: application/json

{
  "suggestionTitle": "Apple Juice Smoothie Bowl",
  "suggestionType": "recipe",
  "cacheId": 42
}
```

**Response** `200 OK`

```json
{
  "instructions": "Step-by-step instruction text..."
}
```

---

### Goals

#### Get Goals

Returns the current user's daily nutrition targets.

```http
GET /api/goals
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "dailyCalorieGoal": 2000,
  "dailyProteinGoal": 150,
  "dailyCarbsGoal": 200,
  "dailyFatGoal": 67,
  "goalsCalculatedAt": "2026-02-10T12:00:00.000Z"
}
```

#### Calculate Goals

Calculates personalized daily nutrition targets from a physical profile using the Mifflin-St Jeor formula. Saves the profile and calculated goals to the user record.

```http
POST /api/goals/calculate
Authorization: Bearer <token>
```

**Request Body**

| Field         | Type   | Required | Description                                                                                |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------------------ |
| weight        | number | yes      | Weight in kg (20-500)                                                                      |
| height        | number | yes      | Height in cm (50-300)                                                                      |
| age           | number | yes      | Age in years (13-120)                                                                      |
| gender        | string | yes      | `"male"`, `"female"`, or `"other"`                                                         |
| activityLevel | string | yes      | `"sedentary"`, `"light"`, `"moderate"`, `"active"`, or `"athlete"`                         |
| primaryGoal   | string | yes      | `"lose_weight"`, `"gain_muscle"`, `"maintain"`, `"eat_healthier"`, or `"manage_condition"` |

**Response** `200 OK`

```json
{
  "dailyCalories": 2100,
  "dailyProtein": 158,
  "dailyCarbs": 210,
  "dailyFat": 70,
  "profile": {
    "weight": 75,
    "height": 180,
    "age": 30,
    "gender": "male",
    "activityLevel": "moderate",
    "primaryGoal": "maintain"
  }
}
```

**Errors**

| Status | Message                   |
| ------ | ------------------------- |
| 400    | Zod validation error      |
| 500    | Failed to calculate goals |

#### Update Goals

Manually update daily nutrition targets. All fields are optional — only provided fields are updated.

```http
PUT /api/goals
Authorization: Bearer <token>
```

**Request Body**

| Field            | Type   | Required | Description           |
| ---------------- | ------ | -------- | --------------------- |
| dailyCalorieGoal | number | no       | Calories (500-10000)  |
| dailyProteinGoal | number | no       | Protein grams (0-500) |
| dailyCarbsGoal   | number | no       | Carbs grams (0-1000)  |
| dailyFatGoal     | number | no       | Fat grams (0-500)     |

**Response** `200 OK`

```json
{
  "dailyCalorieGoal": 2200,
  "dailyProteinGoal": 165,
  "dailyCarbsGoal": 220,
  "dailyFatGoal": 73
}
```

---

### Photo Analysis

#### Analyze Photo

Uploads a food photo for AI-powered identification using OpenAI's GPT-4o Vision model. Returns detected foods with optional nutrition data. Supports `auto` intent for smart classification (detects barcodes, labels, menus, or food). Rate limited to 10 requests per minute.

```http
POST /api/photos/analyze
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request (multipart)**

| Field  | Type   | Required | Description                                                                             |
| ------ | ------ | -------- | --------------------------------------------------------------------------------------- |
| photo  | File   | Yes      | Food photo (JPEG/PNG/WebP)                                                              |
| intent | string | No       | One of `auto`, `log`, `calories`, `recipe`, `identify`, `menu`, `label`. Default: `log` |

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

When `intent` is `auto`, the response also includes:

```json
{
  "contentType": "food|label|barcode|menu|unknown",
  "confidence": 0.92,
  "resolvedIntent": "log",
  "barcode": "012345678901"
}
```

`nutrition` is only populated for intents that need it (`log`, `calories`). For `identify` and `recipe` intents it will be `null`.

**Errors**

| Status | Message                                                     |
| ------ | ----------------------------------------------------------- |
| 400    | No photo provided                                           |
| 401    | Not authenticated                                           |
| 413    | Image too large for analysis session                        |
| 429    | Daily scan limit reached (free: 10/day, premium: unlimited) |
| 500    | Vision API error                                            |

#### Submit Follow-up

Refines a previous analysis by answering a clarification question. Only available when `needsFollowUp` was `true` in the analyze response. Sessions expire after 30 minutes.

```http
POST /api/photos/analyze/:sessionId/followup
Authorization: Bearer <token>
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
Authorization: Bearer <token>
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

#### Analyze Recipe Photo

Analyzes a photo of a recipe (handwritten or printed) and extracts structured recipe data. Premium feature.

```http
POST /api/photos/analyze-recipe
Authorization: Bearer <token>
Content-Type: multipart/form-data

photo: <file>
```

**Response** `200 OK` — Extracted recipe data (title, ingredients, instructions).

**Errors**

| Status | Message                        |
| ------ | ------------------------------ |
| 400    | No photo provided              |
| 403    | Premium required               |
| 500    | Failed to analyze recipe photo |

---

#### Analyze Nutrition Label

Analyzes a photo of a nutrition facts label using OCR. Returns structured nutrition data and a session ID for confirmation. Shares the daily scan limit with photo analysis.

```http
POST /api/photos/analyze-label
Authorization: Bearer <token>
Content-Type: multipart/form-data

photo: <file>
barcode: "012345678901" (optional)
```

**Response** `200 OK`

```json
{
  "sessionId": "uuid-string",
  "intent": "label",
  "labelData": {
    "productName": "string | null",
    "servingSize": "string | null",
    "calories": 120,
    "protein": 5,
    "totalCarbs": 20,
    "totalFat": 3,
    "dietaryFiber": 2,
    "totalSugars": 8,
    "sodium": 150,
    "confidence": 0.92
  },
  "barcode": "012345678901"
}
```

---

#### Confirm Label Analysis

Saves label analysis result to the database as a scanned item and daily log. Scales nutrition values by servings consumed. If a barcode is provided, seeds the nutrition cache (insert-only, never overwrites).

```http
POST /api/photos/confirm-label
Authorization: Bearer <token>
Content-Type: application/json

{
  "sessionId": "uuid-string",
  "servingsConsumed": 1.5,
  "mealType": "lunch"
}
```

| Field            | Type   | Required | Default | Description                   |
| ---------------- | ------ | -------- | ------- | ----------------------------- |
| sessionId        | string | Yes      |         | Session ID from analyze-label |
| servingsConsumed | number | No       | 1       | Servings consumed (0.1-100)   |
| mealType         | string | No       |         | e.g. "breakfast", "lunch"     |

**Response** `201 Created` — Returns the created scanned item.

---

### Meal Plan Recipes

#### List User Recipes

Returns all meal plan recipes created by the authenticated user.

```http
GET /api/meal-plan/recipes
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of meal plan recipe objects.

---

#### Get Recipe with Ingredients

Returns a single recipe with its full ingredient list.

```http
GET /api/meal-plan/recipes/:id
Authorization: Bearer <token>
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

Creates a new meal plan recipe with optional ingredients. Meal types are auto-inferred from title and ingredients. Image is auto-generated asynchronously if none provided.

```http
POST /api/meal-plan/recipes
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Chicken Stir Fry",
  "description": "Quick weeknight dinner",
  "cuisine": "Asian",
  "difficulty": "Easy",
  "servings": 2,
  "prepTimeMinutes": 10,
  "cookTimeMinutes": 15,
  "instructions": ["Dice chicken", "Heat oil"],
  "dietTags": ["gluten_free"],
  "sourceType": "user_created",
  "caloriesPerServing": 350,
  "proteinPerServing": 30,
  "carbsPerServing": 25,
  "fatPerServing": 12,
  "ingredients": [
    { "name": "chicken breast", "quantity": "200", "unit": "g", "category": "protein" }
  ]
}
```

| Field      | Type   | Required | Description                                                                                |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------ |
| sourceType | string | No       | `user_created`, `quick_entry`, `ai_suggestion`, or `photo_import`. Default: `user_created` |

**Response** `201 Created` — Returns the created recipe object.

---

#### Update Recipe

Updates an existing meal plan recipe.

```http
PUT /api/meal-plan/recipes/:id
Authorization: Bearer <token>
Content-Type: application/json
```

Body: same fields as create (all optional, excluding `ingredients`). Returns the updated recipe.

**Errors**
| Status | Message |
|--------|---------|
| 404 | Recipe not found |

---

#### Delete Recipe

Deletes a meal plan recipe and its ingredients (cascade).

```http
DELETE /api/meal-plan/recipes/:id
Authorization: Bearer <token>
```

**Response** `204 No Content`

---

### Meal Plan Items

#### Get Meal Plan Items

Returns meal plan items for a date range, with related recipe and scanned item data.

```http
GET /api/meal-plan?start=2026-01-15&end=2026-01-21
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| start | ISO date string | Yes | Start of date range (YYYY-MM-DD) |
| end | ISO date string | Yes | End of date range (YYYY-MM-DD). Max 90 days from start. |

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
Authorization: Bearer <token>
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
Authorization: Bearer <token>
```

**Response** `204 No Content`

---

#### Reorder Meal Plan Items

Reorders meal plan items by setting sort order values.

```http
PATCH /api/meal-plan/reorder
Authorization: Bearer <token>
Content-Type: application/json

{
  "items": [
    { "id": 1, "sortOrder": 0 },
    { "id": 2, "sortOrder": 1 }
  ]
}
```

| Field | Type  | Required | Description                                                  |
| ----- | ----- | -------- | ------------------------------------------------------------ |
| items | array | Yes      | Array of `{ id: number, sortOrder: number }`. Max 100 items. |

**Response** `200 OK`

```json
{
  "success": true
}
```

---

#### Confirm Meal Plan Item

Confirms a meal plan item as eaten, creating a daily log entry. Premium feature.

```http
POST /api/meal-plan/items/:id/confirm
Authorization: Bearer <token>
```

**Response** `201 Created` — Returns the created daily log entry.

**Errors**

| Status | Message                          |
| ------ | -------------------------------- |
| 403    | Premium required                 |
| 404    | Meal plan item not found         |
| 409    | Meal plan item already confirmed |

---

#### Generate Meal Plan from Pantry

Generates an AI meal plan based on the user's pantry items and dietary profile. Premium feature.

```http
POST /api/meal-plan/generate-from-pantry
Authorization: Bearer <token>
Content-Type: application/json

{
  "days": 3,
  "startDate": "2026-01-20"
}
```

| Field     | Type   | Required | Description                  |
| --------- | ------ | -------- | ---------------------------- |
| days      | number | Yes      | Number of days to plan (1-7) |
| startDate | string | Yes      | Start date (YYYY-MM-DD)      |

**Response** `200 OK` — Generated meal plan with meals for each day.

**Errors**

| Status | Message                   |
| ------ | ------------------------- |
| 400    | No pantry items available |
| 403    | Premium required          |

---

#### Save Generated Meal Plan

Batch-saves a generated meal plan (creates recipes, ingredients, and plan items atomically).

```http
POST /api/meal-plan/save-generated
Authorization: Bearer <token>
Content-Type: application/json

{
  "meals": [
    {
      "mealType": "lunch",
      "title": "Pantry Pasta",
      "description": "Quick pasta with pantry staples",
      "servings": 2,
      "prepTimeMinutes": 10,
      "cookTimeMinutes": 20,
      "difficulty": "Easy",
      "ingredients": [
        { "name": "pasta", "quantity": "200", "unit": "g" }
      ],
      "instructions": ["Boil pasta", "Mix sauce"],
      "dietTags": ["vegetarian"],
      "caloriesPerServing": 400,
      "proteinPerServing": 12,
      "carbsPerServing": 60,
      "fatPerServing": 10,
      "plannedDate": "2026-01-20"
    }
  ]
}
```

**Response** `201 Created`

```json
{
  "saved": 3,
  "items": []
}
```

---

### Recipe Catalog (Spoonacular)

#### Search Catalog

Searches the Spoonacular recipe catalog with optional filters. Automatically injects user's allergens as intolerance parameters.

```http
GET /api/meal-plan/catalog/search?query=pasta&cuisine=Italian&diet=vegetarian&number=10
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| query | string | -- | Search query (required, 1-200 chars) |
| cuisine | string | -- | Cuisine filter (e.g., Italian, Mexican, Asian) |
| diet | string | -- | Diet filter (e.g., vegetarian, vegan, keto) |
| type | string | -- | Meal type filter |
| maxReadyTime | number | -- | Max prep+cook time in minutes (1-1440) |
| number | number | 10 | Max results to return (1-50) |
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
Authorization: Bearer <token>
```

**Response** `200 OK` — Full recipe details including nutrition and ingredients.

**Errors**
| Status | Message |
|--------|---------|
| 402 | Spoonacular API quota exceeded (CATALOG_QUOTA_EXCEEDED) |

---

#### Save Catalog Recipe

Saves a Spoonacular recipe to the user's meal plan recipe collection. If the recipe was already saved (dedup by `externalId`), returns the existing record. Quality gate rejects recipes with no instructions and no ingredients.

```http
POST /api/meal-plan/catalog/:id/save
Authorization: Bearer <token>
```

**Response** `201 Created` — Returns the newly saved `MealPlanRecipe` object.

**Response** `200 OK` — Recipe was already saved; returns the existing `MealPlanRecipe`.

**Errors**
| Status | Message |
|--------|---------|
| 402 | Spoonacular API quota exceeded (CATALOG_QUOTA_EXCEEDED) |
| 422 | Recipe has no instructions or ingredients |

---

### Recipe Import

#### Import Recipe from URL

Imports a recipe from a URL by parsing schema.org Recipe structured data (LD+JSON), saves it to the database as a `MealPlanRecipe` with `sourceType: "url_import"`. Auto-generates an image asynchronously if the source had none.

```http
POST /api/meal-plan/recipes/import-url
Authorization: Bearer <token>
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

### Community Recipes

#### Get Featured Recipes

Returns featured public community recipes.

```http
GET /api/recipes/featured?limit=12&offset=0
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | number | 12 | Max results (1-50) |
| offset | number | 0 | Pagination offset |

**Response** `200 OK` — Array of community recipe objects (with `authorId` stripped).

---

#### Browse Recipes

Unified recipe browse combining community and personal recipes. Optionally returns frequently-used recipes for a meal type.

```http
GET /api/recipes/browse?query=pasta&cuisine=Italian&mealType=dinner
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| query | string | Search query (max 200 chars) |
| cuisine | string | Cuisine filter |
| diet | string | Diet filter |
| limit | number | Max results (1-100) |
| mealType | string | `breakfast`, `lunch`, `dinner`, or `snack` |

**Response** `200 OK`

```json
{
  "community": [],
  "personal": [],
  "frequent": []
}
```

---

#### Get Community Recipes

Returns community recipes matching a product name (and optionally barcode).

```http
GET /api/recipes/community?productName=chicken+breast&barcode=012345678901
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| productName | string | Yes | Product name to search |
| barcode | string | No | Barcode to match |

**Response** `200 OK` — Array of community recipe objects.

---

#### Get My Recipes

Returns the authenticated user's own community recipes.

```http
GET /api/recipes/mine
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of community recipe objects.

---

#### Get Recipe

Returns a specific community recipe by ID. Only shows public recipes or recipes owned by the user.

```http
GET /api/recipes/:id
Authorization: Bearer <token>
```

**Response** `200 OK` — Community recipe object (with `authorId` stripped).

**Errors**
| Status | Message |
|--------|---------|
| 404 | Recipe not found |

---

#### Generate Recipe (Premium)

Generates a new recipe using AI. Rate limited to 3 per minute.

```http
POST /api/recipes/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "productName": "chicken breast",
  "barcode": "012345678901",
  "servings": 4,
  "dietPreferences": ["gluten_free"],
  "timeConstraint": "30 minutes"
}
```

| Field           | Type     | Required | Description                   |
| --------------- | -------- | -------- | ----------------------------- |
| productName     | string   | Yes      | Base ingredient (3-200 chars) |
| barcode         | string   | No       | Product barcode               |
| servings        | number   | No       | Servings (1-20)               |
| dietPreferences | string[] | No       | Diet tags (max 10)            |
| timeConstraint  | string   | No       | Time limit (max 50 chars)     |

**Response** `201 Created` — Returns the generated community recipe.

**Errors**
| Status | Message |
|--------|---------|
| 403 | Premium required |
| 429 | Daily recipe generation limit reached |

---

#### Share/Unshare Recipe

Toggles a recipe's public visibility in the community.

```http
POST /api/recipes/:id/share
Authorization: Bearer <token>
Content-Type: application/json

{
  "isPublic": true
}
```

**Response** `200 OK` — Returns the updated recipe.

**Errors**
| Status | Message |
|--------|---------|
| 404 | Recipe not found or not owned by you |

---

#### Delete Recipe

Deletes a community recipe (author only).

```http
DELETE /api/recipes/:id
Authorization: Bearer <token>
```

**Response** `204 No Content`

---

#### Get Recipe Share Payload

Returns share-ready data for a recipe (title, description, image, deep link).

```http
GET /api/recipes/:recipeType/:recipeId/share
Authorization: Bearer <token>
```

**Path Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| recipeType | string | `mealPlan` or `community` |
| recipeId | number | Recipe ID |

**Response** `200 OK`

```json
{
  "title": "Chicken Stir Fry",
  "description": "Quick weeknight dinner",
  "imageUrl": "https://...",
  "deepLink": "ocrecipes://recipe/5?type=mealPlan"
}
```

---

### Recipe Generation Status

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

#### Upgrade Subscription

Upgrades the user to premium tier by submitting an IAP receipt.

```http
POST /api/subscription/upgrade
Authorization: Bearer <token>
Content-Type: application/json

{
  "receipt": "string",
  "platform": "ios" | "android"
}
```

**Response** `200 OK` — Returns updated subscription status.

---

#### Restore Subscription

Restores a previously purchased subscription using receipt data.

```http
POST /api/subscription/restore
Authorization: Bearer <token>
Content-Type: application/json

{
  "receipt": "string",
  "platform": "ios" | "android"
}
```

**Response** `200 OK` — Returns updated subscription status.

---

#### Premium Error Responses

Endpoints gated behind premium return these error codes:

| Status | Code                  | Description                                                               |
| ------ | --------------------- | ------------------------------------------------------------------------- |
| 403    | `PREMIUM_REQUIRED`    | Feature requires a premium subscription                                   |
| 429    | `DAILY_LIMIT_REACHED` | Daily usage limit exceeded (includes `generationsToday` and `dailyLimit`) |

---

### Saved Items

#### List Saved Items

Returns all items saved by the user.

```http
GET /api/saved-items
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of saved item objects.

---

#### Get Saved Item Count

Returns the count of the user's saved items (used for free-tier cap enforcement).

```http
GET /api/saved-items/count
Authorization: Bearer <token>
```

**Response** `200 OK` — `{ count: number }`

---

#### Save Item

Saves a scanned item for quick re-logging.

```http
POST /api/saved-items
Authorization: Bearer <token>
Content-Type: application/json

{
  "sourceItemId": 123,
  "productName": "string",
  "calories": 120,
  "protein": 5,
  "carbs": 20,
  "fat": 3
}
```

**Response** `201 Created` — Returns saved item.
Free-tier users are limited to 6 saved items.

---

#### Delete Saved Item

```http
DELETE /api/saved-items/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

---

### Grocery Lists

#### Generate Grocery List

Auto-generates a grocery list from meal plan items in a date range.

```http
POST /api/meal-plan/grocery-lists
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "string",
  "dateRangeStart": "2025-01-20",
  "dateRangeEnd": "2025-01-26"
}
```

**Response** `201 Created` — Returns the grocery list with auto-populated items.

---

#### List Grocery Lists

```http
GET /api/meal-plan/grocery-lists
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of grocery lists.

---

#### Get Grocery List

```http
GET /api/meal-plan/grocery-lists/:id
Authorization: Bearer <token>
```

**Response** `200 OK` — Grocery list with items.

---

#### Update Grocery List Item

Toggles checked status or updates item details.

```http
PUT /api/meal-plan/grocery-lists/:id/items/:itemId
Authorization: Bearer <token>
Content-Type: application/json

{
  "isChecked": true
}
```

**Response** `200 OK`

---

#### Add Item to Grocery List

Manually adds an item to a grocery list.

```http
POST /api/meal-plan/grocery-lists/:id/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "string",
  "quantity": 2,
  "unit": "cups",
  "category": "produce"
}
```

**Response** `201 Created`

---

#### Add Grocery Item to Pantry

Moves a checked grocery item to the user's pantry.

```http
POST /api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry
Authorization: Bearer <token>
```

**Response** `200 OK`

---

#### Delete Grocery List

```http
DELETE /api/meal-plan/grocery-lists/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

---

### Pantry

#### List Pantry Items

```http
GET /api/pantry
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of pantry items.

---

#### Add Pantry Item

```http
POST /api/pantry
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "string",
  "quantity": 1,
  "unit": "kg",
  "category": "produce",
  "expiresAt": "2025-02-15T00:00:00.000Z"
}
```

**Response** `201 Created`

---

#### Update Pantry Item

```http
PUT /api/pantry/:id
Authorization: Bearer <token>
Content-Type: application/json
```

**Response** `200 OK`

---

#### Delete Pantry Item

```http
DELETE /api/pantry/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

---

#### Get Expiring Items

Returns pantry items expiring within the next 7 days.

```http
GET /api/pantry/expiring
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of pantry items near expiration.

---

### Meal Suggestions

#### Generate Meal Suggestions

AI-powered meal suggestions based on user's dietary profile, goals, and pantry contents.

```http
POST /api/meal-plan/suggest
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of meal suggestion objects. Results are cached per user.

---

### Weight Tracking

#### List Weight Logs

Returns the user's weight history.

```http
GET /api/weight
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of weight log entries, most recent first.

---

#### Get Weight Trend

Returns weight trend analysis (rate of change, moving average).

```http
GET /api/weight/trend
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "currentWeight": 75.5,
  "startWeight": 80.0,
  "trendRate": -0.5,
  "trendDirection": "losing",
  "entries": []
}
```

---

#### Log Weight

```http
POST /api/weight
Authorization: Bearer <token>
Content-Type: application/json

{
  "weight": 75.5,
  "note": "Morning weigh-in",
  "source": "manual"
}
```

**Response** `201 Created`

---

#### Delete Weight Log

```http
DELETE /api/weight/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

---

#### Set Goal Weight

```http
PUT /api/goals/weight
Authorization: Bearer <token>
Content-Type: application/json

{
  "goalWeight": 70.0
}
```

**Response** `200 OK`

---

### Food NLP & Voice

#### Parse Food Text

Parses natural language food descriptions into structured nutrition data.

```http
POST /api/food/parse-text
Authorization: Bearer <token>
Content-Type: application/json

{
  "text": "2 eggs and a slice of toast with butter"
}
```

**Response** `200 OK` — Array of parsed food items with estimated nutrition.

---

#### Transcribe Voice

Transcribes audio to text for voice-based food logging.

```http
POST /api/food/transcribe
Authorization: Bearer <token>
Content-Type: multipart/form-data

audio: <file>
```

**Response** `200 OK` — `{ text: "transcribed text" }`

---

### HealthKit Sync

#### Sync HealthKit Data

Pushes HealthKit data from the device to the server.

```http
POST /api/healthkit/sync
Authorization: Bearer <token>
Content-Type: application/json

{
  "dataType": "weight",
  "entries": [{ "value": 75.5, "date": "2025-01-15T08:00:00Z" }]
}
```

**Response** `200 OK` — `{ synced: number }`

---

#### Get HealthKit Settings

```http
GET /api/healthkit/settings
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of `{ dataType, enabled, lastSyncAt, syncDirection }`.

---

#### Update HealthKit Settings

```http
PUT /api/healthkit/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "dataType": "weight",
  "enabled": true,
  "syncDirection": "read"
}
```

**Response** `200 OK`

---

### Adaptive Goals

#### Get Adaptive Goal Suggestion

Returns the current adaptive goal adjustment suggestion based on weight trends.

```http
GET /api/goals/adaptive
Authorization: Bearer <token>
```

**Response** `200 OK` — Adjustment suggestion or `null` if no adjustment needed.

---

#### Accept Adjustment

Applies the suggested goal adjustment.

```http
POST /api/goals/adaptive/accept
Authorization: Bearer <token>
```

**Response** `200 OK` — Updated goals.

---

#### Dismiss Adjustment

Dismisses the current suggestion without applying.

```http
POST /api/goals/adaptive/dismiss
Authorization: Bearer <token>
```

**Response** `200 OK`

---

#### Update Adaptive Settings

Enables or disables adaptive goal adjustment.

```http
PUT /api/goals/adaptive/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "adaptiveGoalsEnabled": true
}
```

**Response** `200 OK`

---

#### Get Adjustment History

```http
GET /api/goals/adjustment-history
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of past goal adjustment log entries.

---

### Chat (AI Nutrition Coach)

#### List Conversations

Returns the user's chat conversations, optionally filtered by type.

```http
GET /api/chat/conversations?type=coach&limit=50
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | number | 50 | Max results (max 50) |
| type | string | -- | Filter by `coach`, `recipe`, or `remix` |

**Response** `200 OK` — Array of conversation objects.

---

#### Create Conversation

Creates a new chat conversation. For `remix` type, requires a `sourceRecipeId`.

```http
POST /api/chat/conversations
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Meal prep advice",
  "type": "coach",
  "sourceRecipeId": 42
}
```

| Field          | Type   | Required | Description                                     |
| -------------- | ------ | -------- | ----------------------------------------------- |
| title          | string | No       | Conversation title (max 200 chars)              |
| type           | string | No       | `coach`, `recipe`, or `remix`. Default: `coach` |
| sourceRecipeId | number | No\*     | Required for `remix` type                       |

**Response** `201 Created`

---

#### Get Conversation Messages

```http
GET /api/chat/conversations/:id/messages
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of messages (`{ role, content, createdAt, metadata }`).

---

#### Send Message (SSE Streaming)

Sends a message and receives the AI response via Server-Sent Events. Routes to either the nutrition coach or recipe chat based on conversation type. Premium feature.

```http
POST /api/chat/conversations/:id/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "What should I eat for dinner tonight?",
  "screenContext": "HomeScreen showing 800 cal remaining"
}
```

| Field         | Type   | Required | Description                             |
| ------------- | ------ | -------- | --------------------------------------- |
| content       | string | Yes      | Message text (1-2000 chars)             |
| screenContext | string | No       | Current screen context (max 1500 chars) |

**Response** — SSE stream of `data:` events. For coach chat: `{ content: "..." }` chunks. For recipe chat: may include `{ recipe: {...} }`, `{ imageUrl: "..." }`, and `{ content: "..." }` events. Terminates with `{ done: true }`.

---

#### Delete Conversation

```http
DELETE /api/chat/conversations/:id
Authorization: Bearer <token>
```

**Response** `204 No Content`

---

#### Get Chat Suggestion Chips

Returns predefined suggestion chips for chat. Currently only supports `type=recipe`.

```http
GET /api/chat/suggestions?type=recipe
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of suggestion chip strings.

---

#### Save Recipe from Chat

Saves a recipe generated during a chat conversation as a meal plan recipe.

```http
POST /api/chat/conversations/:id/save-recipe
Authorization: Bearer <token>
Content-Type: application/json

{
  "messageId": 123
}
```

**Response** `201 Created` — Returns the saved meal plan recipe.

**Errors**
| Status | Message |
|--------|---------|
| 400 | Invalid conversation ID |
| 404 | Recipe not found in message |

---

#### Upload Image for Recipe Chat

Uploads an image for recipe-specific chat analysis. Analyzes the image for ingredients and saves as a user message. Premium feature.

```http
POST /api/chat/conversations/:id/upload-image
Authorization: Bearer <token>
Content-Type: multipart/form-data

photo: <file>
```

**Response** `201 Created`

```json
{
  "message": { "id": 1, "role": "user", "content": "..." },
  "ingredientAnalysis": "Detected: tomatoes, onions, garlic..."
}
```

---

### Fasting

#### Get Fasting Schedule

Returns the user's active fasting schedule.

```http
GET /api/fasting/schedule
Authorization: Bearer <token>
```

**Response** `200 OK` — Schedule object or `null`.

---

#### Set Fasting Schedule

Creates or updates the user's fasting schedule.

```http
PUT /api/fasting/schedule
Authorization: Bearer <token>
Content-Type: application/json

{
  "protocol": "16:8",
  "fastingHours": 16,
  "eatingHours": 8,
  "eatingWindowStart": "12:00",
  "eatingWindowEnd": "20:00"
}
```

**Response** `200 OK`

---

#### Start Fast

Begins a new fasting session.

```http
POST /api/fasting/start
Authorization: Bearer <token>
```

**Response** `201 Created` — Returns the fasting log entry.

---

#### End Fast

Ends the current active fast.

```http
POST /api/fasting/end
Authorization: Bearer <token>
```

**Response** `200 OK` — Returns the completed fasting log with actual duration.

---

#### Get Current Fast

Returns the currently active fast, if any.

```http
GET /api/fasting/current
Authorization: Bearer <token>
```

**Response** `200 OK` — Current fasting log or `null`.

---

#### Get Fasting History

```http
GET /api/fasting/history
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of past fasting log entries with stats.

---

### Medication (GLP-1)

#### List Medication Logs

```http
GET /api/medication/logs
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of medication log entries.

---

#### Log Medication

```http
POST /api/medication/log
Authorization: Bearer <token>
Content-Type: application/json

{
  "medicationName": "semaglutide",
  "brandName": "Ozempic",
  "dosage": "0.5mg",
  "sideEffects": ["nausea"],
  "appetiteLevel": 2,
  "notes": "Feeling less hungry"
}
```

**Response** `201 Created`

---

#### Update Medication Log

```http
PUT /api/medication/log/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

---

#### Delete Medication Log

```http
DELETE /api/medication/log/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

---

#### Get Medication Insights

Returns AI-generated insights about the user's medication journey (trends, side effects, appetite changes).

```http
GET /api/medication/insights
Authorization: Bearer <token>
```

**Response** `200 OK` — Insights object with trends and recommendations.

---

#### Get High-Protein Suggestions

Returns protein-rich food suggestions tailored for GLP-1 users.

```http
GET /api/medication/protein-suggestions
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of food suggestions.

---

#### Toggle GLP-1 Mode

Enables or disables GLP-1 medication mode on the user's profile.

```http
PUT /api/user/glp1-mode
Authorization: Bearer <token>
Content-Type: application/json

{
  "glp1Mode": true,
  "glp1Medication": "semaglutide",
  "glp1StartDate": "2025-01-01T00:00:00.000Z"
}
```

**Response** `200 OK`

---

### Menu Scanning

#### Scan Menu

Analyzes a restaurant menu photo using AI vision.

```http
POST /api/menu/scan
Authorization: Bearer <token>
Content-Type: multipart/form-data

image: <file>
```

**Response** `200 OK`

```json
{
  "id": 1,
  "restaurantName": "Joe's Diner",
  "cuisine": "American",
  "menuItems": [
    {
      "name": "Grilled Chicken Salad",
      "description": "...",
      "calories": 450,
      "protein": 35,
      "carbs": 20,
      "fat": 25
    }
  ]
}
```

---

#### Get Menu Scan History

```http
GET /api/menu/history
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of past menu scan results.

---

#### Delete Menu Scan

```http
DELETE /api/menu/scans/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

---

### Micronutrients

#### Get Item Micronutrients

Returns detailed vitamin and mineral data for a scanned item.

```http
GET /api/micronutrients/item/:id
Authorization: Bearer <token>
```

**Response** `200 OK` — Object with per-micronutrient values.

---

#### Get Daily Micronutrient Summary

Returns aggregated micronutrient intake for the current day.

```http
GET /api/micronutrients/daily
Authorization: Bearer <token>
```

**Response** `200 OK` — Aggregated micronutrient totals with % of RDA.

---

#### Get Micronutrient Reference Values

Returns the reference daily intake values (RDAs) for all tracked micronutrients.

```http
GET /api/micronutrients/reference
Authorization: Bearer <token>
```

**Response** `200 OK` — Array of `{ name, unit, rda, upperLimit }`.

---

### Cookbooks

#### List Cookbooks

Returns the authenticated user's cookbooks.

```http
GET /api/cookbooks?limit=50
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | number | 50 | Max results (max 100) |

**Response** `200 OK` — Array of cookbook objects.

---

#### Create Cookbook

```http
POST /api/cookbooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Weeknight Dinners",
  "description": "Quick meals for busy evenings",
  "coverImageUrl": "https://example.com/image.jpg"
}
```

| Field         | Type   | Required | Description                       |
| ------------- | ------ | -------- | --------------------------------- |
| name          | string | Yes      | Cookbook name (1-200 chars)       |
| description   | string | No       | Description (max 1000 chars)      |
| coverImageUrl | string | No       | Cover image URL (http/https only) |

**Response** `201 Created` — Returns the created cookbook.

---

#### Get Cookbook with Recipes

Returns a single cookbook with its resolved recipe list.

```http
GET /api/cookbooks/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "id": 1,
  "name": "Weeknight Dinners",
  "description": "Quick meals for busy evenings",
  "coverImageUrl": null,
  "recipes": [
    {
      "id": 1,
      "recipeId": 5,
      "recipeType": "mealPlan",
      "title": "Chicken Stir Fry",
      "imageUrl": "https://..."
    }
  ]
}
```

---

#### Update Cookbook

```http
PATCH /api/cookbooks/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name"
}
```

Body: same fields as create (all optional, at least one required).

**Response** `200 OK` — Returns the updated cookbook.

**Errors**
| Status | Message |
|--------|---------|
| 404 | Cookbook not found |

---

#### Delete Cookbook

```http
DELETE /api/cookbooks/:id
Authorization: Bearer <token>
```

**Response** `204 No Content`

---

#### Add Recipe to Cookbook

Adds a recipe (meal plan or community) to a cookbook.

```http
POST /api/cookbooks/:id/recipes
Authorization: Bearer <token>
Content-Type: application/json

{
  "recipeId": 5,
  "recipeType": "mealPlan"
}
```

| Field      | Type   | Required | Description                                    |
| ---------- | ------ | -------- | ---------------------------------------------- |
| recipeId   | number | Yes      | Recipe ID                                      |
| recipeType | string | No       | `mealPlan` or `community`. Default: `mealPlan` |

**Response** `201 Created` — Returns the cookbook recipe entry.

**Errors**
| Status | Message |
|--------|---------|
| 404 | Cookbook not found |
| 409 | Recipe already exists in this cookbook |

---

#### Remove Recipe from Cookbook

```http
DELETE /api/cookbooks/:id/recipes/:recipeId?recipeType=mealPlan
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| recipeType | string | mealPlan | `mealPlan` or `community` |

**Response** `204 No Content`

**Errors**
| Status | Message |
|--------|---------|
| 404 | Cookbook not found / Recipe not found in cookbook |

---

### Cooking Sessions

#### Create Cooking Session

Starts a new cooking session for photo-based ingredient tracking. Premium feature.

```http
POST /api/cooking/sessions
Authorization: Bearer <token>
```

**Response** `201 Created`

```json
{
  "id": "uuid-string",
  "ingredients": [],
  "photos": [],
  "createdAt": 1704067200000
}
```

**Errors**
| Status | Message |
|--------|---------|
| 403 | Premium required |
| 429 | Session limit reached |

---

#### Get Cooking Session

```http
GET /api/cooking/sessions/:id
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "id": "uuid-string",
  "ingredients": [
    {
      "id": "uuid",
      "name": "chicken breast",
      "quantity": 200,
      "unit": "g",
      "confidence": 0.9,
      "category": "protein",
      "photoId": "uuid",
      "userEdited": false
    }
  ],
  "photos": [{ "id": "uuid", "addedAt": 1704067200000 }],
  "createdAt": 1704067200000
}
```

---

#### Add Photo to Cooking Session

Uploads a photo of ingredients. AI detects and merges ingredients into the session. Returns allergen warnings if user has declared allergies. Max 10 photos per session.

```http
POST /api/cooking/sessions/:id/photos
Authorization: Bearer <token>
Content-Type: multipart/form-data

photo: <file>
```

**Response** `200 OK`

```json
{
  "id": "uuid-string",
  "ingredients": [],
  "photos": [],
  "createdAt": 1704067200000,
  "newDetections": 3,
  "allergenWarnings": [
    {
      "ingredientName": "peanut butter",
      "allergenId": "peanuts",
      "severity": "severe"
    }
  ]
}
```

---

#### Edit Ingredient

Updates a detected ingredient in the session.

```http
PATCH /api/cooking/sessions/:id/ingredients/:ingredientId
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "chicken thigh",
  "quantity": 300,
  "unit": "g",
  "preparationMethod": "diced"
}
```

All fields are optional. Sets `userEdited: true`.

**Response** `200 OK` — `{ ingredient: {...} }`

---

#### Delete Ingredient

Removes an ingredient from the session.

```http
DELETE /api/cooking/sessions/:id/ingredients/:ingredientId
Authorization: Bearer <token>
```

**Response** `200 OK` — `{ ingredients: [...] }`

---

#### Get Nutrition Summary

Calculates nutrition totals for the session's ingredients.

```http
POST /api/cooking/sessions/:id/nutrition
Authorization: Bearer <token>
Content-Type: application/json

{
  "cookingMethod": "grilled"
}
```

**Response** `200 OK` — Nutrition summary with per-ingredient and total values.

**Errors**
| Status | Message |
|--------|---------|
| 400 | No ingredients in session |

---

#### Log Cooking Session

Logs the session as a single composite meal to the daily food log and cleans up the session.

```http
POST /api/cooking/sessions/:id/log
Authorization: Bearer <token>
Content-Type: application/json

{
  "mealType": "dinner"
}
```

**Response** `201 Created` — Returns the created scanned item (with `sourceType: "cook_session"`).

**Errors**
| Status | Message |
|--------|---------|
| 400 | No ingredients to log |

---

#### Generate Recipe from Session

Generates an AI recipe based on the session's ingredients. Premium feature.

```http
POST /api/cooking/sessions/:id/recipe
Authorization: Bearer <token>
```

**Response** `200 OK` — Generated recipe object.

**Errors**
| Status | Message |
|--------|---------|
| 400 | No ingredients for recipe |
| 403 | Premium required |

---

#### Get Substitution Suggestions

Returns AI-powered ingredient substitution suggestions for the session.

```http
POST /api/cooking/sessions/:id/substitutions
Authorization: Bearer <token>
Content-Type: application/json

{
  "ingredientIds": ["uuid-1", "uuid-2"]
}
```

| Field         | Type     | Required | Description                                        |
| ------------- | -------- | -------- | -------------------------------------------------- |
| ingredientIds | string[] | No       | Specific ingredient IDs. Omit for all ingredients. |

**Response** `200 OK` — Substitution suggestions per ingredient.

---

### Barcode Verification

#### Submit Verification

Submits a barcode verification from a label scan session. Compares with existing verifications and updates the product's verification level. Does NOT count toward daily scan limit.

```http
POST /api/verification/submit
Authorization: Bearer <token>
Content-Type: application/json

{
  "barcode": "012345678901",
  "sessionId": "uuid-string"
}
```

**Response** `200 OK`

```json
{
  "isMatch": true,
  "verificationLevel": "verified",
  "verificationCount": 3,
  "canScanFrontLabel": true
}
```

**Verification Levels**
| Level | Description |
|-------|-------------|
| `unverified` | No matching verifications |
| `single_verified` | 1-2 matching verifications |
| `verified` | 3+ matching verifications (consensus reached) |

**Errors**
| Status | Message |
|--------|---------|
| 400 | Label scan confidence too low |
| 404 | Label session not found or expired |
| 409 | You have already verified this product |

---

#### Get Verification Status

Returns the verification status for a barcode.

```http
GET /api/verification/:barcode
Authorization: Bearer <token>
```

**Path Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| barcode | string | 8-14 digit numeric barcode |

**Response** `200 OK`

```json
{
  "verificationLevel": "verified",
  "verificationCount": 3,
  "consensusNutritionData": {
    "calories": 120,
    "protein": 3,
    "carbs": 24,
    "fat": 1.5
  },
  "hasFrontLabelData": true
}
```

---

#### Get User Verification Stats

Returns the authenticated user's verification count, streak, and badge tier.

```http
GET /api/verification/user-count
Authorization: Bearer <token>
```

**Response** `200 OK` — Verification stats object.

---

#### Upload Front Label Photo

Uploads a front-of-package photo for AI extraction. Requires prior back-label verification.

```http
POST /api/verification/front-label
Authorization: Bearer <token>
Content-Type: multipart/form-data

photo: <file>
barcode: "012345678901"
```

**Response** `200 OK`

```json
{
  "sessionId": "uuid-string",
  "data": {
    "brand": "HealthBrand",
    "productName": "Whole Grain Cereal",
    "netWeight": "350g",
    "claims": ["Whole Grain", "No Added Sugar"]
  }
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | You must verify the nutrition label before scanning the front |
| 429 | Too many front-label scan requests |

---

#### Confirm Front Label Data

Confirms front-label extraction and stores it on the barcode verification record. Awards 0.5 gamification credit on first scan per barcode per user.

```http
POST /api/verification/front-label/confirm
Authorization: Bearer <token>
Content-Type: application/json

{
  "barcode": "012345678901",
  "sessionId": "uuid-string"
}
```

**Response** `200 OK`

```json
{
  "success": true,
  "frontLabelScanned": true
}
```

---

#### Get Reformulation Flags (Admin)

Returns products flagged for potential reformulation. Admin only.

```http
GET /api/verification/reformulation-flags?status=flagged&limit=50&offset=0
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | `flagged` or `resolved` |
| limit | number | Max results (default 50, max 100) |
| offset | number | Pagination offset |

**Response** `200 OK`

```json
{
  "flags": [],
  "total": 0,
  "limit": 50,
  "offset": 0
}
```

---

#### Resolve Reformulation Flag (Admin)

Resolves a reformulation flag. Admin only.

```http
POST /api/verification/reformulation-flags/:flagId/resolve
Authorization: Bearer <token>
```

**Response** `200 OK` — `{ success: true }`

---

### Public Verified Product API (v1)

The public API serves verified nutrition data to external consumers. Authenticated via `X-API-Key` header (not JWT).

#### Get Product by Barcode

```http
GET /api/v1/products/:barcode
X-API-Key: ocr_live_your_key_here
```

**Path Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| barcode | string | 8-14 digit numeric barcode |

Barcodes are automatically expanded to common variants (zero-padded, check-digit computed).

**Response (Free Tier)** `200 OK`

```json
{
  "data": {
    "barcode": "012345678901",
    "productName": "Whole Grain Cereal",
    "brandName": "HealthBrand",
    "servingSize": "30g",
    "calories": 120,
    "protein": 3,
    "carbs": 24,
    "fat": 1.5,
    "source": "usda",
    "verified": false
  }
}
```

**Response (Paid Tier)** `200 OK`

```json
{
  "data": {
    "barcode": "012345678901",
    "productName": "Whole Grain Cereal",
    "brandName": "HealthBrand",
    "servingSize": "30g",
    "calories": 120,
    "protein": 3,
    "carbs": 24,
    "fat": 1.5,
    "source": "verified",
    "verified": true,
    "verificationLevel": "verified",
    "verificationCount": 3,
    "lastVerifiedAt": "2026-03-15T10:00:00.000Z",
    "frontLabel": {
      "brand": "HealthBrand",
      "productName": "Whole Grain Cereal",
      "netWeight": "350g",
      "claims": ["Whole Grain", "No Added Sugar"]
    }
  }
}
```

**Tiers**
| Tier | Price | Requests/Month | Data |
|------|-------|----------------|------|
| Free | $0 | 500 | Unverified nutrition |
| Starter | $29/mo | 10,000 | Verified + unverified |
| Pro | $99/mo | 100,000 | Verified + unverified |

**Rate Limit Headers**
| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Monthly request quota |
| `X-RateLimit-Remaining` | Requests remaining |
| `X-RateLimit-Reset` | ISO 8601 quota reset time |

**Errors**
| Status | Code | Description |
|--------|------|-------------|
| 400 | VALIDATION_ERROR | Invalid barcode format |
| 401 | API_KEY_INVALID | Missing or invalid API key |
| 401 | API_KEY_REVOKED | API key has been revoked |
| 404 | NOT_FOUND | Product not found |
| 429 | TIER_LIMIT_EXCEEDED | Monthly request limit exceeded |

---

#### API Documentation Page

Serves an HTML documentation page for the public API.

```http
GET /api/v1/docs
```

**Auth**: None required.

**Response** — HTML page with full API documentation.

---

### Admin API Key Management

All admin endpoints require authentication and admin role.

#### Create API Key

```http
POST /api/admin/api-keys
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Integration",
  "tier": "free"
}
```

| Field | Type   | Required | Description                                  |
| ----- | ------ | -------- | -------------------------------------------- |
| name  | string | Yes      | Key name (1-100 chars)                       |
| tier  | string | No       | `free`, `starter`, or `pro`. Default: `free` |

**Response** `201 Created`

```json
{
  "id": 1,
  "keyPrefix": "ocr_live_abc1",
  "plaintextKey": "ocr_live_abc123...",
  "name": "My Integration",
  "tier": "free",
  "message": "Store this key securely. It will not be shown again."
}
```

---

#### List API Keys

Returns all API keys with usage statistics.

```http
GET /api/admin/api-keys
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": 1,
      "keyPrefix": "ocr_live_abc1",
      "name": "My Integration",
      "tier": "free",
      "status": "active",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "revokedAt": null,
      "usage": {}
    }
  ]
}
```

---

#### Revoke API Key

```http
DELETE /api/admin/api-keys/:id
Authorization: Bearer <token>
```

**Response** `200 OK` — `{ message: "API key revoked" }`

---

#### Update API Key Tier

```http
PATCH /api/admin/api-keys/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "tier": "starter"
}
```

**Response** `200 OK`

```json
{
  "message": "API key tier updated",
  "tier": "starter"
}
```

---

### Favourite Recipes

#### List Favourite Recipes

Returns the user's favourited recipes with resolved recipe data.

```http
GET /api/favourite-recipes?limit=50
Authorization: Bearer <token>
```

**Query Parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | number | 50 | Max results (1-100) |

**Response** `200 OK` — Array of resolved recipe objects.

---

#### Toggle Favourite Recipe

Adds or removes a recipe from the user's favourites.

```http
POST /api/favourite-recipes/toggle
Authorization: Bearer <token>
Content-Type: application/json

{
  "recipeId": 5,
  "recipeType": "mealPlan"
}
```

| Field      | Type   | Required | Description               |
| ---------- | ------ | -------- | ------------------------- |
| recipeId   | number | Yes      | Recipe ID                 |
| recipeType | string | Yes      | `mealPlan` or `community` |

**Response** `200 OK`

```json
{
  "favourited": true
}
```

**Errors**
| Status | Message |
|--------|---------|
| 403 | Favourite recipe limit reached |

---

#### Check Favourite Status

```http
GET /api/favourite-recipes/check?recipeId=5&recipeType=mealPlan
Authorization: Bearer <token>
```

**Response** `200 OK` — `{ favourited: boolean }`

---

#### Get Favourite Recipe IDs

Returns all favourited recipe IDs for the user (optimized for list rendering).

```http
GET /api/favourite-recipes/ids
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "ids": [
    { "recipeId": 5, "recipeType": "mealPlan" },
    { "recipeId": 12, "recipeType": "community" }
  ]
}
```

---

### Batch Scanning

#### Save Batch Scanned Items

Saves multiple scanned items to a destination (daily log, pantry, or grocery list).

```http
POST /api/batch/save
Authorization: Bearer <token>
Content-Type: application/json

{
  "items": [
    {
      "productName": "Organic Milk",
      "barcode": "012345678901",
      "calories": 120,
      "protein": 8,
      "carbs": 12,
      "fat": 5
    }
  ],
  "destination": "daily_log",
  "mealType": "breakfast",
  "groceryListId": null
}
```

| Field         | Type   | Required | Description                              |
| ------------- | ------ | -------- | ---------------------------------------- |
| items         | array  | Yes      | Array of scanned item objects            |
| destination   | string | Yes      | `daily_log`, `pantry`, or `grocery_list` |
| mealType      | string | No       | Meal type for `daily_log` destination    |
| groceryListId | number | No       | Required for `grocery_list` destination  |

**Response** `200 OK`

```json
{
  "success": true,
  "destination": "daily_log",
  "created": 3
}
```

For `grocery_list` destination, also returns `groceryListId`.

---

### Beverages

#### Log Beverage

Logs a beverage with auto-calculated nutrition from type, size, and modifiers. Creates a scanned item and daily log entry.

```http
POST /api/beverages/log
Authorization: Bearer <token>
Content-Type: application/json

{
  "beverageType": "coffee",
  "size": "medium",
  "modifiers": ["cream", "sugar"],
  "mealType": "breakfast"
}
```

| Field          | Type     | Required | Description                                              |
| -------------- | -------- | -------- | -------------------------------------------------------- |
| beverageType   | string   | Yes      | Beverage type (e.g., `water`, `coffee`, `tea`, `custom`) |
| size           | string   | Yes      | `small`, `medium`, or `large`                            |
| modifiers      | string[] | No       | Additions (e.g., `cream`, `sugar`, `milk`)               |
| customName     | string   | No       | Name for custom beverages (max 100 chars)                |
| customCalories | number   | No       | Calorie override for custom beverages (0-5000)           |
| mealType       | string   | No       | Meal type for daily log                                  |

**Response** `201 Created` — Returns the created scanned item (with `sourceType: "beverage"`).

**Errors**
| Status | Message |
|--------|---------|
| 422 | Could not find nutrition data for this beverage |

---

### Receipt Scanning

#### Scan Receipt

Uploads 1-3 receipt photos for AI analysis and grocery item extraction. Premium feature.

```http
POST /api/receipt/scan
Authorization: Bearer <token>
Content-Type: multipart/form-data

photos: <file[]>
```

Max 3 photos. Subject to monthly scan cap.

**Response** `200 OK`

```json
{
  "items": [
    {
      "name": "Organic Milk",
      "quantity": 1,
      "unit": "L",
      "category": "dairy",
      "estimatedShelfLifeDays": 14,
      "confidence": 0.95
    }
  ],
  "overallConfidence": 0.88,
  "isPartialExtraction": false
}
```

**Errors**
| Status | Message |
|--------|---------|
| 400 | No photos provided |
| 403 | Premium required |
| 429 | Monthly receipt scan limit reached |

---

#### Confirm Receipt Items

Accepts reviewed receipt items and bulk-adds them to the pantry with estimated expiration dates. Premium feature.

```http
POST /api/receipt/confirm
Authorization: Bearer <token>
Content-Type: application/json

{
  "items": [
    {
      "name": "Organic Milk",
      "quantity": 1,
      "unit": "L",
      "category": "dairy",
      "estimatedShelfLifeDays": 14
    }
  ]
}
```

| Field                          | Type   | Required | Description                              |
| ------------------------------ | ------ | -------- | ---------------------------------------- |
| items[].name                   | string | Yes      | Item name (1-200 chars)                  |
| items[].quantity               | number | No       | Quantity (0-9999, default 1)             |
| items[].unit                   | string | No       | Unit (max 50 chars)                      |
| items[].category               | string | No       | Category (max 50 chars, default "other") |
| items[].estimatedShelfLifeDays | number | Yes      | Days until expiration (1-730)            |

**Response** `200 OK`

```json
{
  "added": 5,
  "items": []
}
```

---

#### Get Receipt Scan Count

Returns the user's monthly receipt scan count and limit.

```http
GET /api/receipt/scan-count
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "count": 3,
  "limit": 10,
  "remaining": 7
}
```

---

### Profile Hub

#### Get Profile Widgets

Returns widget data for the profile screen (calorie budget, fasting status, weight trend).

```http
GET /api/profile/widgets
Authorization: Bearer <token>
```

**Response** `200 OK` — Widget data object.

---

#### Get Library Counts

Returns counts of the user's recipes, cookbooks, saved items, etc. (single optimized query).

```http
GET /api/profile/library-counts
Authorization: Bearer <token>
```

**Response** `200 OK` — Object with count fields.

---

### Recipe Carousel

#### Get Carousel

Returns personalized recipe suggestions for the home screen carousel based on user's dietary profile.

```http
GET /api/carousel
Authorization: Bearer <token>
```

**Response** `200 OK`

```json
{
  "cards": [
    {
      "id": 1,
      "title": "Quick Chicken Stir Fry",
      "imageUrl": "https://...",
      "difficulty": "Easy",
      "timeEstimate": "25 min"
    }
  ]
}
```

---

#### Dismiss Carousel Recipe

Dismisses a recipe from the carousel so it won't appear again.

```http
POST /api/carousel/dismiss
Authorization: Bearer <token>
Content-Type: application/json

{
  "recipeId": 42
}
```

**Response** `204 No Content`

---

### Allergen Check

#### Check Allergens

Checks a list of ingredients against the user's declared allergies and returns allergen matches with safe substitution suggestions.

```http
POST /api/allergen-check
Authorization: Bearer <token>
Content-Type: application/json

{
  "ingredients": ["peanut butter", "whole wheat bread", "milk"]
}
```

**Response** `200 OK`

```json
{
  "matches": [
    {
      "ingredientName": "peanut butter",
      "allergenId": "peanuts",
      "severity": "severe"
    }
  ],
  "substitutions": [
    {
      "originalIngredientId": "allergen-check-0",
      "suggestion": "sunflower seed butter",
      "allergenId": "peanuts",
      "severity": "severe"
    }
  ]
}
```

If the user has no allergies declared, returns empty `matches` and `substitutions`.

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
- `manage_condition`

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

Some endpoints also include a `code` field for programmatic error handling:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE"
}
```

### Common HTTP Status Codes

| Status | Meaning                              |
| ------ | ------------------------------------ |
| 200    | Success                              |
| 201    | Created                              |
| 204    | No Content                           |
| 400    | Bad Request - Invalid input          |
| 401    | Unauthorized - Not authenticated     |
| 403    | Forbidden - Insufficient permissions |
| 404    | Not Found                            |
| 409    | Conflict - Resource already exists   |
| 413    | Payload Too Large                    |
| 422    | Unprocessable Entity                 |
| 429    | Too Many Requests                    |
| 500    | Internal Server Error                |

---

## Rate Limiting

### Internal Rate Limits

| Endpoint                                       | Window   | Max Requests | Key          |
| ---------------------------------------------- | -------- | ------------ | ------------ |
| `POST /api/recipes/generate`                   | 1 minute | 3            | userId or IP |
| `POST /api/cooking/sessions/:id/photos`        | 1 minute | 10           | userId or IP |
| `POST /api/cooking/sessions/:id/substitutions` | 1 minute | 5            | userId or IP |
| `POST /api/verification/submit`                | 1 minute | 10           | userId or IP |
| `POST /api/verification/front-label`           | 1 minute | 10           | userId or IP |
| `POST /api/receipt/scan`                       | 1 minute | 5            | userId or IP |
| `POST /api/batch/save`                         | 1 minute | 10           | userId or IP |

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
const { user, token } = await response.json();

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
