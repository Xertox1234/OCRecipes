# Development Setup Guide

## Overview

This guide covers everything needed to set up the OCRecipes development environment. For iOS Simulator or Android Emulator development, you can use your machine's local IP directly. Tunneling is an alternative for physical devices on different networks.

## Prerequisites

### Required Software

| Software   | Version | Installation                      |
| ---------- | ------- | --------------------------------- |
| Node.js    | 18+     | [nodejs.org](https://nodejs.org)  |
| npm        | 9+      | Included with Node.js             |
| PostgreSQL | 12+     | `brew install postgresql` (macOS) |

### Optional Software

| Software    | When Needed                                         |
| ----------- | --------------------------------------------------- |
| Xcode       | Required for `npx expo run:ios` (native builds)     |
| Android SDK | Required for `npx expo run:android`                 |
| Expo Go     | Quick prototyping (no camera support)               |
| ngrok       | Alternative tunnel (more reliable than localtunnel) |
| cloudflared | Cloudflare tunnel option                            |
| Postman     | API testing                                         |

## Initial Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone <repo-url>
cd OCRecipes

# Install dependencies
npm install
```

### 2. Environment Variables

Create a `.env` file in the project root. The sections below are organized by category.

#### Required

These must be set or the server will refuse to start:

```bash
# PostgreSQL connection string
DATABASE_URL=postgresql://username:password@localhost:5432/ocrecipes

# JWT signing secret (must be at least 32 characters)
JWT_SECRET=your-secure-random-string-at-least-32-chars
```

#### Server Configuration (optional, has defaults)

```bash
# Server port (default: 3000)
PORT=3000

# Environment (default: "development")
NODE_ENV=development

# Logging level: fatal | error | warn | info | debug | trace
LOG_LEVEL=info
```

#### AI and API Keys (optional, features degrade without them)

```bash
# OpenAI — powers photo analysis, nutrition coaching, recipe generation
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...

# Optional base URL override (e.g., for Azure OpenAI or a proxy)
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1

# Spoonacular — recipe catalog search
SPOONACULAR_API_KEY=your-spoonacular-key

# USDA — nutrition data lookup (falls back to "DEMO_KEY" with severe rate limits)
USDA_API_KEY=your-usda-key

# API Ninjas — nutrition data fallback source
API_NINJAS_KEY=your-api-ninjas-key

# Runware — image generation (primary provider, falls back to DALL-E)
RUNWARE_API_KEY=your-runware-key
```

#### Mobile Client

```bash
# Public API URL the mobile app uses to reach the backend.
# For iOS Simulator: use your Mac's local IP (find with: ipconfig getifaddr en0)
# For tunneling: use the tunnel URL
EXPO_PUBLIC_DOMAIN=http://192.168.x.x:3000
```

#### Apple In-App Purchase (optional, receipt validation)

Set `RECEIPT_VALIDATION_STUB=true` during development to auto-approve receipts when no Apple credentials are configured. **Never use stub mode in production.**

```bash
APPLE_ISSUER_ID=your-issuer-id
APPLE_KEY_ID=your-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
APPLE_BUNDLE_ID=com.ocrecipes.app
APPLE_ENVIRONMENT=sandbox          # "sandbox" or "production"
APPLE_APP_ID=123456789             # Numeric App Apple ID (production JWS verification)
APPLE_ROOT_CA_DIR=server/certs/    # Override path for Apple root CA certs
RECEIPT_VALIDATION_STUB=true       # Dev-only: auto-approve receipts
```

#### Google In-App Purchase (optional, receipt validation)

```bash
GOOGLE_PACKAGE_NAME=com.ocrecipes.app
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

#### Admin

```bash
# Comma-separated user IDs with admin privileges
ADMIN_USER_IDS=1,2
```

### 3. Database Setup

```bash
# Start PostgreSQL (if not running)
brew services start postgresql  # macOS

# Create database
createdb ocrecipes

# Enable required extensions
psql ocrecipes -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# Push schema to database
npm run db:push
```

> **Note:** The `pg_trgm` extension is required for GIN trigram indexes used by recipe search. It must be enabled before `db:push` or the index creation will fail.

## Port Configuration

| Service         | Port | Notes                      |
| --------------- | ---- | -------------------------- |
| Express Backend | 3000 | Avoid 5000 (Apple AirPlay) |
| Expo Metro      | 8081 | Auto-tunneled by Expo      |
| PostgreSQL      | 5432 | Default                    |

## Starting Development Servers

### Option A: iOS Simulator (recommended for camera features)

Camera features require native builds via `react-native-vision-camera` and will **not** work in Expo Go. See the "Native Builds" section below.

```bash
# Terminal 1: Backend
npm run server:dev

# Terminal 2: Build and launch in iOS Simulator
npx expo run:ios
```

Set `EXPO_PUBLIC_DOMAIN` to your Mac's local IP (e.g., `http://192.168.x.x:3000`). The simulator can reach this directly without tunneling.

### Option B: Expo Go (simpler, no camera support)

```bash
# Terminal 1: Backend
npm run server:dev

# Terminal 2: Expo with tunneling
npm run expo:dev
```

This starts Expo with automatic ngrok tunneling (via `--tunnel` flag). Scan the QR code with Expo Go on your device.

If using Expo Go with a separate backend tunnel:

```bash
# Terminal 3: Backend tunnel (if not using local IP)
npx localtunnel --port 3000
```

**Important**: Localtunnel URLs change on each restart. You must open the URL in a browser first and click "Click to Continue" — otherwise API requests will timeout with 408 errors.

### Configure API URL

Set `EXPO_PUBLIC_DOMAIN` in your `.env` file to the appropriate URL:

- **Simulator**: `http://<your-mac-ip>:3000` (find with `ipconfig getifaddr en0`)
- **Tunneling**: The tunnel URL (e.g., `https://major-snakes-draw.loca.lt`)

## Native Builds (iOS / Android)

Camera scanning, barcode reading, and OCR features use `react-native-vision-camera`, which requires a native build. **These features do not work in Expo Go.**

### iOS Simulator

```bash
# First build (installs CocoaPods, compiles native modules — ~5-10 min)
npx expo run:ios

# Subsequent runs are much faster (incremental builds)
npx expo run:ios
```

Requires Xcode to be installed. See CLAUDE.md's "iOS Simulator Setup" section for detailed first-time setup instructions and troubleshooting.

### Android Emulator / Device

```bash
npx expo run:android
```

Requires Android SDK and an emulator or connected device.

### Physical iPhone

Building to a physical iPhone requires USB connection for the initial install, Xcode signing configuration, and trusting the developer certificate on the device. See CLAUDE.md's "Physical Device Setup (iPhone)" section for the complete walkthrough.

After the initial install, subsequent development can be done wirelessly over the same WiFi network:

```bash
# Terminal 1: Backend
npm run server:dev

# Terminal 2: Metro bundler (--dev-client flag required, NOT Expo Go)
npx expo start --dev-client --lan
```

## Testing Your Setup

1. Start the backend server and verify it's running: `curl http://localhost:3000/api/health`
2. Launch the app (simulator, emulator, or Expo Go)
3. Register an account or log in — verify the database connection works
4. Check backend logs for incoming API requests

## All Available Commands

### Development

```bash
npm run server:dev          # Express backend with hot reloading
npm run expo:dev            # Expo frontend with tunneling (Expo Go)
npx expo run:ios            # Build and run on iOS Simulator (native)
npx expo run:android        # Build and run on Android emulator/device
```

### Database

```bash
npm run db:push             # Push Drizzle schema to PostgreSQL
npm run seed:recipes        # Seed community recipe data
```

### Code Quality

```bash
npm run lint                # ESLint check
npm run lint:fix            # ESLint auto-fix
npm run lint:a11y           # Accessibility lint check
npm run check:types         # TypeScript type checking
npm run format              # Prettier format all files
npm run check:format        # Check formatting without writing
```

### Testing

```bash
npm run test                # Run tests in watch mode
npm run test:run            # Run all tests once
npm run test:unit           # Run unit tests only (excludes storage integration tests)
npm run test:integration    # Run storage integration tests only
npm run test:coverage       # Run tests with coverage report
```

### End-to-End Testing (Maestro)

```bash
npm run e2e                 # Run all Maestro E2E flows
npm run e2e:smoke           # Run smoke-tagged E2E flows only
```

### Production Build

```bash
npm run server:build        # Bundle server with esbuild -> server_dist/
npm run server:prod         # Run production server
npm run expo:static:build   # Build static Expo bundle
```

### Utilities

```bash
npm run generate:icons      # Generate ingredient icons
```

## CORS Configuration

The backend allows all origins in development mode:

```typescript
// server/index.ts - setupCors()
res.header("Access-Control-Allow-Origin", origin || "*");
```

This prevents 403 CORS errors when accessing from mobile devices.

## Pre-Commit Hooks

The project uses Husky with lint-staged. On every commit:

1. **`npm run test:run`** — all tests must pass
2. **lint-staged** runs on staged files:
   - `.ts` / `.tsx` — ESLint + Prettier
   - `client/**/*.tsx` — accessibility and hardcoded color checks
   - `server/storage/*.ts` — IDOR storage check
   - `.js` / `.md` — Prettier

If tests fail or linting errors occur, the commit is blocked.

## Troubleshooting

### 403 / 408 Timeout

1. **If using localtunnel**: Open the tunnel URL in a browser and click "Click to Continue"
2. Verify backend is running: `curl http://localhost:3000/api/health`
3. If using simulator, ensure `EXPO_PUBLIC_DOMAIN` has the correct local IP
4. Restart the tunnel if it has been idle (tunnels can expire)

### Port Already in Use

```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 npm run server:dev
```

### Database Connection Failed

```bash
# Check PostgreSQL is running
pg_isready

# Check connection string
psql $DATABASE_URL

# Create database if missing
createdb ocrecipes
```

### Tunnel Connection Issues

Localtunnel can be unreliable. Alternatives:

**ngrok** (requires free account):

```bash
ngrok http 3000
```

**cloudflared** (Cloudflare tunnel):

```bash
cloudflared tunnel --url http://localhost:3000
```

### Expo Build Errors

```bash
# Clear caches
npx expo start --clear
rm -rf node_modules/.cache

# Reinstall dependencies
rm -rf node_modules
npm install
```

### Camera Not Working

1. Camera features require a native build (`npx expo run:ios` or `npx expo run:android`) — they do **not** work in Expo Go
2. Grant camera permissions in device settings
3. If using iOS Simulator, camera simulation may be limited — use a physical device for full testing
4. See CLAUDE.md's "Troubleshooting" sections for build-specific issues (e.g., `EXBarcodeScannerInterface.h` not found)

## Development Tips

### Hot Reloading

- **Backend**: tsx watches for changes automatically
- **Frontend**: Expo provides fast refresh

Shake your device or press `r` in terminal to force reload.

### Debugging

```bash
# React DevTools
npx react-devtools

# Expo debugger
# Shake device -> "Debug Remote JS"
```

### Database Inspection

```bash
# Connect to database
psql $DATABASE_URL

# View tables
\dt

# Query users
SELECT * FROM users;
```

## Notes

- Don't commit tunnel URLs or `.env` files to git
- Port 5000 conflicts with macOS AirPlay Receiver
- Expo's `--tunnel` flag uses @expo/ngrok automatically
- Backend needs a separate tunnel only if not using local IP access
- `JWT_SECRET` must be at least 32 characters (validated at startup)
- Missing optional API keys log warnings at startup — check server logs to see which features are degraded
