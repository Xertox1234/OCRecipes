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
│         │                                      │                │
│         ▼                                      ▼                │
│  ┌──────────────┐                  ┌──────────────────────────┐│
│  │   Shared     │                  │      PostgreSQL          ││
│  │   Schema     │◄────────────────►│      Database            ││
│  └──────────────┘                  └──────────────────────────┘│
│                                             │                   │
│                                             ▼                   │
│                                    ┌──────────────────────────┐│
│                                    │   OpenAI API (GPT-4o)    ││
│                                    │   AI Suggestions         ││
│                                    └──────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
Nutri-Cam/
├── client/                    # React Native/Expo Frontend
│   ├── App.tsx                # Entry point with providers
│   ├── components/            # Reusable UI components
│   ├── constants/             # Theme, colors, spacing
│   ├── context/               # React Context providers
│   ├── hooks/                 # Custom React hooks
│   ├── lib/                   # Utilities (query client)
│   ├── navigation/            # React Navigation stacks
│   └── screens/               # Screen components
│       └── onboarding/        # Onboarding flow screens
│
├── server/                    # Express.js Backend
│   ├── index.ts               # Server entry, CORS setup
│   ├── routes.ts              # API route definitions
│   ├── storage.ts             # Database operations
│   └── db.ts                  # Drizzle ORM configuration
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

| Technology | Version | Purpose |
|------------|---------|---------|
| Expo SDK | 54 | React Native toolchain |
| React Native | 0.81 | Mobile UI framework |
| React | 19 | UI library |
| React Navigation | 7.x | Navigation management |
| TanStack Query | 5.x | Server state management |
| Reanimated | 4.x | Animations |
| expo-camera | - | Barcode scanning |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Express.js | 5.0 | HTTP server |
| Drizzle ORM | - | Database ORM |
| PostgreSQL | 12+ | Database |
| bcrypt | - | Password hashing |
| express-session | - | Session management |
| OpenAI SDK | - | AI suggestions |

### Shared

| Technology | Purpose |
|------------|---------|
| TypeScript | Type safety |
| Zod | Schema validation |
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
│ userId (FK) ◄────│──────────────────────────┘
│ scannedItemId(FK)│
│ servings         │
│ mealType         │
│ loggedAt         │
└──────────────────┘
```

### Table Relationships

- **users → user_profiles**: One-to-one (cascade delete)
- **users → scanned_items**: One-to-many (cascade delete)
- **users → daily_logs**: One-to-many (cascade delete)
- **scanned_items → daily_logs**: One-to-many (cascade delete)

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
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
│  HistoryStack   │ │  ScanStack  │ │  ProfileStack   │
│  Navigator      │ │  Navigator  │ │  Navigator      │
├─────────────────┤ ├─────────────┤ ├─────────────────┤
│ HistoryScreen   │ │ ScanScreen  │ │ ProfileScreen   │
│ ItemDetailScreen│ └─────────────┘ └─────────────────┘
└─────────────────┘
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
│ 3. Session Check │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Route Handler  │
│   (routes.ts)    │
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌────────┐
│Storage │ │OpenAI  │
│  API   │ │  API   │
└───┬────┘ └────────┘
    │
    ▼
┌──────────────────┐
│    Drizzle ORM   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   PostgreSQL     │
└──────────────────┘
```

### Storage Layer

```typescript
// server/storage.ts - Database operations interface

interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>
  getUserByUsername(username: string): Promise<User | undefined>
  createUser(data: InsertUser): Promise<User>
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>

  // Profiles
  getUserProfile(userId: string): Promise<UserProfile | undefined>
  createUserProfile(data: InsertUserProfile): Promise<UserProfile>
  updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile | undefined>

  // Scanned Items
  getScannedItems(userId: string): Promise<ScannedItem[]>
  getScannedItem(id: number): Promise<ScannedItem | undefined>
  createScannedItem(data: InsertScannedItem): Promise<ScannedItem>

  // Daily Logs
  getDailySummary(userId: string, date: Date): Promise<DailySummary>
  createDailyLog(data: InsertDailyLog): Promise<DailyLog>
}
```

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
    │         Set-Cookie: session         │
    └─────────────────────────────────────┘

Login:
┌────────┐    POST /auth/login       ┌────────┐  bcrypt.compare   ┌────────┐
│ Client │ ──────────────────────────▶ Server │ ─────────────────▶│   DB   │
└────────┘                           └────────┘                   └────────┘
    ▲                                     │
    │         Set-Cookie: session         │
    └─────────────────────────────────────┘

Subsequent Requests:
┌────────┐   Cookie: session         ┌────────┐   Validate        ┌────────┐
│ Client │ ──────────────────────────▶ Server │ ─────────────────▶│Session │
└────────┘                           └────────┘                   │ Store  │
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
              │  Check AsyncStorage for user  │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌──────────────────┐          ┌──────────────────┐
    │   User Found     │          │  No User Found   │
    │  GET /auth/me    │          │  Show Login      │
    └────────┬─────────┘          └──────────────────┘
             │
             ▼
    ┌──────────────────┐
    │  Valid Session?  │
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
- HTTP-only session cookies
- Secure cookies in production (HTTPS only)
- 30-day session expiry

### CORS
- Development: All origins allowed
- Production: Should restrict to app domains

### Data Protection
- User data isolated by userId
- Cascade deletes for data cleanup
- No sensitive data in URLs

### API Security
- Session validation on all protected routes
- Input validation with Zod schemas
- Error messages don't leak implementation details
