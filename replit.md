# NutriScan - Replit Project Documentation

## Overview

NutriScan is a mobile nutrition tracking application built with Expo/React Native for the frontend and Express.js for the backend. The app allows users to scan food barcodes and nutrition labels using their device camera, track daily nutritional intake, and receive personalized nutrition advice through AI-powered chat features.

The application follows a monorepo structure with shared code between client and server, uses PostgreSQL for data persistence, and integrates with OpenAI APIs for intelligent nutrition analysis and chat capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: Expo SDK 54 with React Native 0.81
- **Navigation**: React Navigation v7 with native stack navigators and bottom tab navigation
- **State Management**: TanStack Query (React Query) for server state, React Context for auth and onboarding
- **Styling**: StyleSheet API with a custom theme system supporting light/dark modes
- **Path Aliases**: `@/` maps to `./client`, `@shared/` maps to `./shared`

**Navigation Structure**:
- Root Stack: Login → Onboarding → Main (tabs)
- Onboarding Navigator: 6-step flow (Welcome, Allergies, HealthConditions, DietType, Goals, Preferences)
- Tab Navigator: History, Scan (camera), Chat, Profile
- Each tab has its own stack navigator for drill-down screens

**Onboarding Flow** (client/navigation/OnboardingNavigator.tsx):
- Collects comprehensive dietary information across 6 screens
- Allergies include severity levels (mild/moderate/severe) for safety-critical warnings
- All screens have skip option for users who prefer defaults
- Data persisted via OnboardingContext and saved to server on completion
- After completion, user.onboardingCompleted=true triggers navigation to main app

**Item Detail Screen** (client/screens/ItemDetailScreen.tsx):
- Displays full nutrition facts for a scanned food item
- Auto-fetches AI-generated suggestions on load
- Suggestions include: 2 recipes, 1 kid-friendly craft activity, 1 food pairing idea
- AI suggestions respect user's dietary profile (allergies, diet type, cooking skill)

**Key Design Patterns**:
- Custom hooks for theming (`useTheme`), authentication (`useAuth`), and screen options
- Reanimated for smooth animations
- Error boundary with fallback UI for crash recovery
- Keyboard-aware components with platform-specific handling

### Backend Architecture
- **Framework**: Express.js 5 with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Authentication**: Session-based auth with bcrypt password hashing, stored in express-session
- **API Design**: RESTful endpoints under `/api/` prefix

**Server Structure**:
- `server/index.ts`: Express app setup with CORS, static serving
- `server/routes.ts`: API route definitions with session middleware
- `server/storage.ts`: Data access layer implementing `IStorage` interface
- `server/db.ts`: Drizzle database connection

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: `shared/schema.ts` - contains all table definitions
- **Main Tables**:
  - `users`: Authentication and basic user settings
  - `userProfiles`: Detailed dietary preferences (allergies, health conditions, diet type)
  - `scannedItems`: History of scanned food products with nutrition data
  - `dailyLogs`: Daily food intake tracking
  - `conversations`/`messages`: Chat history for AI assistant

### AI Integration Architecture
Located in `server/replit_integrations/`:
- **Chat**: OpenAI-powered nutrition assistant with personalized system prompts based on user dietary profile
- **Audio**: Voice chat capabilities with speech-to-text and text-to-speech
- **Image**: Image generation for food-related content
- **Batch**: Rate-limited batch processing utilities for LLM calls

The AI chat system builds context-aware prompts that incorporate user allergies, health conditions, and dietary preferences for personalized recommendations.

### Client-Side Data Flow
1. Authentication state managed via `AuthContext` with AsyncStorage persistence
2. API calls through `apiRequest()` utility with automatic error handling
3. TanStack Query for caching and synchronizing server state
4. Onboarding data collected through multi-step wizard, submitted on completion

## External Dependencies

### Core Services
- **PostgreSQL Database**: Primary data store, connection via `DATABASE_URL` environment variable
- **OpenAI API**: Powers the nutrition chat assistant and image features
  - Configured via `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`
  - Uses custom base URL for Replit AI integrations

### Mobile-Specific Dependencies
- **expo-camera**: Barcode and label scanning
- **expo-image-picker**: Photo library access for nutrition label images
- **expo-haptics**: Tactile feedback for scan confirmations
- **AsyncStorage**: Local auth token persistence

### Development/Build
- **Drizzle Kit**: Database migrations (`drizzle.config.ts`)
- **esbuild**: Server bundling for production
- **Babel with module-resolver**: Path alias support for imports

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Express session encryption key
- `AI_INTEGRATIONS_OPENAI_API_KEY`: OpenAI API key for AI features
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: Custom OpenAI endpoint
- `EXPO_PUBLIC_DOMAIN`: Public domain for API calls from mobile client
- `REPLIT_DEV_DOMAIN`: Development domain (auto-set by Replit)