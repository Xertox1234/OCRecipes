# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NutriScan is a mobile nutrition tracking app built with Expo/React Native (frontend) and Express.js (backend). Users scan food barcodes/labels with their camera, track nutritional intake, and receive AI-powered nutrition advice via chat.

## Development Commands

```bash
# Start development - iOS Simulator (recommended for testing camera features)
npm run server:dev    # Express backend on port 3000
npx expo run:ios      # Build and run in iOS simulator with native modules

# Start development - Expo Go (simpler, but no camera support)
npm run server:dev    # Express backend on port 3000
npm run expo:dev      # Expo frontend with tunneling (camera won't work in Expo Go)

# Database
npm run db:push       # Push Drizzle schema to PostgreSQL

# Code quality
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run check:types   # TypeScript type check
npm run format        # Prettier formatting

# Testing
npm run test          # Run tests in watch mode
npm run test:run      # Run tests once
npm run test:coverage # Run tests with coverage report

# Production build
npm run server:build  # Bundle server with esbuild → server_dist/
npm run expo:static:build  # Build static Expo bundle
```

## Architecture

### Monorepo Structure

- `client/` - React Native/Expo frontend
- `server/` - Express.js backend
- `shared/` - Code shared between client/server (database schema, models)

### Path Aliases

- `@/` → `./client`
- `@shared/` → `./shared`

### Frontend Stack

- **Expo SDK 54** with React Native 0.81, React 19
- **Navigation**: React Navigation v7 (native-stack + bottom-tabs)
- **State**: TanStack Query v5 for server state, React Context for auth/onboarding
- **Styling**: StyleSheet with custom theme system (`client/constants/theme.ts`)
- **Animations**: Reanimated 4

### Backend Stack

- **Express.js 5** with TypeScript
- **Drizzle ORM** with PostgreSQL
- **Session-based auth** with bcrypt

### Navigation Flow

1. **Login** → 2. **Onboarding** (6 screens) → 3. **Main App** (3 tabs: History, Scan, Profile)

Modal screens: NutritionDetailScreen, ItemDetailScreen

### Database Schema (`shared/schema.ts`)

Key tables: `users`, `userProfiles` (dietary preferences), `scannedItems`, `dailyLogs`, `conversations`/`messages`

### AI Integration (`server/`)

- `chat/` - OpenAI nutrition assistant with user dietary context
- `audio/` - Speech-to-text, text-to-speech
- `image/` - Image generation
- `batch/` - Rate-limited LLM batch processing

## Key Patterns

**CRITICAL:** Follow established patterns in `docs/PATTERNS.md` for all code changes. This ensures consistency, prevents common issues, and maintains code quality across the project.

### Pattern Documentation

- **`docs/PATTERNS.md`** - Comprehensive development patterns covering:
  - TypeScript patterns (type guards, shared types, Express extensions)
  - API patterns (error responses, auth, fail-fast validation)
  - Client state patterns (in-memory caching, Authorization headers, 401 handling)
  - Performance patterns (storage optimization, batching)
  - React Native patterns (safe areas, haptics, platform-specific code)
  - Camera patterns (expo-camera, scan debouncing, permissions)
  - Documentation patterns (todos, design decisions)

**Before implementing:** Check if a pattern exists. **After implementing:** Consider if your solution should become a pattern.

### Quick Pattern Reference

#### API Calls

Client uses `apiRequest()` from `client/lib/query-client.ts` for all server communication with automatic error handling. Always use Authorization header (not cookies) for auth tokens.

#### Theming

Use `useTheme()` hook. Colors, spacing, typography defined in `client/constants/theme.ts`. Supports light/dark modes.

#### Authentication

`AuthContext` manages auth state with AsyncStorage persistence. `useAuth()` hook provides login/register/logout. Token stored via in-memory cached storage (`client/lib/token-storage.ts`).

#### Onboarding

`OnboardingContext` collects dietary info across 6 screens. Data saved to `userProfiles` table on completion.

#### Safe Areas (React Native)

Always use `useSafeAreaInsets()` for screen layouts to handle iOS notch/dynamic island. Add theme spacing for visual breathing room.

#### Camera Scanning

Debounce barcode scans using ref tracking and `isScanning` state to prevent duplicate triggers. Always provide haptic feedback on successful scan.

## Testing

Unit tests use **Vitest** with tests co-located in `__tests__/` directories:

- `server/__tests__/` - Auth middleware, route validation, storage interface
- `client/lib/__tests__/` - Query client, token storage utilities
- `shared/__tests__/` - Zod schemas, type guards

**Pre-commit hooks** (via Husky) automatically run on every commit:

1. `npm run test:run` - All tests must pass
2. `lint-staged` - ESLint + Prettier on staged files

If tests fail or linting errors occur, the commit is blocked.

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection
- `SESSION_SECRET` - Express session key
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - Custom OpenAI endpoint
- `EXPO_PUBLIC_DOMAIN` - Public API domain for mobile client

## iOS Simulator Setup

### First Time Setup

The app uses `react-native-vision-camera` which requires native code compilation. You cannot use Expo Go for camera features.

1. **Start Backend Server**

   ```bash
   npm run server:dev
   ```

   Backend will run on `http://localhost:3000`

2. **Configure API URL**
   Update `.env` to use your Mac's local IP (simulator can access this):

   ```bash
   EXPO_PUBLIC_DOMAIN=http://192.168.137.175:3000
   ```

   To find your IP: `ipconfig getifaddr en0`

3. **Build & Launch Development Client**
   ```bash
   npx expo run:ios
   ```
   This will:
   - Install CocoaPods dependencies (~2 minutes)
   - Build the native iOS app with camera support (~5-10 minutes first time)
   - Launch in iOS Simulator
   - Enable hot reloading for future code changes

### Subsequent Runs

After the first build, you can launch faster:

```bash
# Terminal 1: Backend
npm run server:dev

# Terminal 2: Launch app (much faster after first build)
npx expo run:ios
```

The app will automatically reload when you make code changes (hot reload).

### Troubleshooting

**Build Errors (expo-barcode-scanner)**

- If you see `EXBarcodeScannerInterface.h` not found errors:
  ```bash
  npm uninstall expo-barcode-scanner
  cd ios && rm -rf Pods Podfile.lock && cd ..
  npx pod-install
  npx expo run:ios
  ```

**Network Errors (408, 503)**

- Ensure backend is running: check for "express server serving on port 3000"
- Verify `.env` has correct local IP, not a tunnel URL
- If using a physical device, ensure it's on the same WiFi network

**Camera Not Working in Expo Go**

- `react-native-vision-camera` is NOT supported in Expo Go
- You must use the development client: `npx expo run:ios`

## Physical Device Setup (iPhone)

The app requires a physical device for full camera functionality testing. **Your iPhone must be connected via USB cable to build the app.**

### Prerequisites

1. **Install expo-dev-client**:

   ```bash
   npx expo install expo-dev-client
   ```

2. **Enable Developer Mode on iPhone** (iOS 16+):
   - Go to **Settings → Privacy & Security → Developer Mode**
   - Turn it **ON**
   - iPhone will **restart**
   - After restart, tap **Turn On** to confirm

### First Time Build & Install

1. **Connect your iPhone to MacBook** via USB cable

2. **Unlock iPhone** and tap **"Trust This Computer"** when prompted

3. **Set up code signing in Xcode**:

   ```bash
   open ios/NutriScan.xcworkspace
   ```

   In Xcode:
   - Click **"NutriScan"** project (blue icon) in left sidebar
   - Select **"NutriScan"** target under TARGETS
   - Click **"Signing & Capabilities"** tab
   - Enable **"Automatically manage signing"** checkbox
   - Select your **Team** (your Apple ID) from dropdown
   - If bundle identifier conflict: change to `com.yourname.nutriscan`
   - Also update `app.json` to match: `"bundleIdentifier": "com.yourname.nutriscan"`

4. **Build and install** (takes 5-10 minutes first time):

   ```bash
   xcodebuild -workspace ios/NutriScan.xcworkspace -scheme NutriScan \
     -configuration Debug -destination id=YOUR_DEVICE_ID \
     -allowProvisioningUpdates build
   ```

   To find your device ID:

   ```bash
   xcrun xctrace list devices | grep "iPhone"
   ```

5. **Install the built app**:

   ```bash
   xcrun devicectl device install app --device YOUR_DEVICE_ID \
     /Users/YOUR_USERNAME/Library/Developer/Xcode/DerivedData/NutriScan-*/Build/Products/Debug-iphoneos/NutriScan.app
   ```

6. **Trust developer certificate on iPhone**:
   - Go to **Settings → General → VPN & Device Management**
   - Tap your Apple ID under "Developer App"
   - Tap **"Trust [Your Name] (Personal Team)"**
   - Tap **Trust** in popup

### Running the App

1. **Start backend server**:

   ```bash
   npm run server:dev
   ```

2. **Start Metro bundler**:

   ```bash
   npx expo start --dev-client --lan
   ```

3. **Open NutriScan app on iPhone**
   - If it shows "No development servers found":
     - Ensure iPhone and Mac are on **same WiFi network**
     - Tap **"Enter URL manually"**
     - Enter: `http://YOUR_MAC_IP:8081` (e.g., `http://192.168.137.175:8081`)
     - Tap **Connect**

4. **Find your Mac's IP** (if needed):
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```

### Subsequent Development

After first install, **USB cable is NOT required**. Just ensure both devices are on same WiFi:

```bash
# Terminal 1: Backend (MUST start this first!)
npm run server:dev
# Wait for: "express server serving on port 3000"

# Terminal 2: Metro bundler
npx expo start --dev-client --lan --clear
# The --clear flag ensures fresh bundle with latest .env variables
```

**On your iPhone:**

1. Open the NutriScan app
2. If it shows "No development servers found":
   - Tap **"Enter URL manually"**
   - Enter: `http://192.168.137.175:8081`
   - Tap **Connect**
3. App should load and connect to backend at `http://192.168.137.175:3000`

**Troubleshooting:**

- If login fails with "Network request failed": The backend server isn't running or isn't reachable
  - Verify backend is running: `curl http://localhost:3000/api/health` should return `{"status":"ok"}`
  - Check `.env` has correct IP: `EXPO_PUBLIC_DOMAIN=http://192.168.137.175:3000`
  - Restart Metro with `--clear` flag to reload environment variables
- If app can't connect to Metro: Both devices must be on same WiFi network
- To force reload on phone: Shake device → tap "Reload"

### Quick Start Commands

```bash
# Start both servers (run in separate terminals)
npm run server:dev
npx expo start --dev-client --lan

# Or use screen/tmux for persistent sessions
```

### Important Notes

- **USB cable is required** for the initial build only
- After installation, you can develop wirelessly (phone and Mac on same WiFi)
- **ALWAYS start backend server before Metro bundler** - Metro needs the backend running
- QR codes from `npx expo start` **do NOT work** - the app needs the native camera module
- Always use `--dev-client` flag, NOT Expo Go
- Your Mac IP is: `192.168.137.175` (update in `.env` if it changes)
