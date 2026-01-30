# NutriScan API Reference

## Overview

The NutriScan API is a RESTful API built with Express.js 5.0. All endpoints use JSON for request/response bodies and session-based authentication.

**Base URL**: `https://your-tunnel-url.loca.lt` (development) or your production domain

## Authentication

The API uses session-based authentication with HTTP-only cookies. Sessions are valid for 30 days.

### Session Configuration

```typescript
{
  cookie: {
    secure: true,        // HTTPS only in production
    httpOnly: true,      // Prevents XSS
    maxAge: 2592000000   // 30 days in milliseconds
  }
}
```

**Important**: All requests must include `credentials: "include"` to send/receive session cookies.

---

## Endpoints

### Authentication

#### Register User

Creates a new user account and establishes a session.

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

Authenticates a user and creates a session.

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

Destroys the current session.

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

### Daily Summary

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

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Not authenticated |
| 404 | Not Found |
| 409 | Conflict - Resource already exists |
| 500 | Internal Server Error |

---

## Rate Limiting

Currently no rate limiting is implemented. The AI suggestions endpoint has a soft limit through OpenAI's API (max 1024 tokens per response).

---

## Client Integration

### Example: Making API Requests

```typescript
import { apiRequest } from "@/lib/query-client";

// Login
const response = await apiRequest("POST", "/api/auth/login", {
  username: "user",
  password: "pass"
});
const user = await response.json();

// Fetch items
const items = await apiRequest("GET", "/api/scanned-items");
const data = await items.json();

// Create item
await apiRequest("POST", "/api/scanned-items", {
  productName: "Apple",
  calories: 95
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
