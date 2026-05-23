# OCRecipes

OCRecipes is a mobile nutrition tracking app: scan food barcodes and labels with your camera, track nutritional intake, plan meals with recipes, and get AI-powered nutrition advice via chat.

## Stack

- **Frontend** — Expo SDK 54, React Native 0.81, React 19, React Navigation v7, TanStack Query v5, Reanimated 4
- **Backend** — Express.js 5 with TypeScript, Drizzle ORM, PostgreSQL, JWT auth (bcrypt)
- **Shared** — TypeScript types, Drizzle schema, and Zod validation shared between client and server (`shared/`)

The repo is a monorepo: `client/` (Expo app), `server/` (Express API), and `shared/` (code used by both).

## Quick Start

Prerequisites: Node.js 18+, PostgreSQL 12+, and (for native camera builds) Xcode. See [docs/DEV_SETUP.md](docs/DEV_SETUP.md) for the full setup, including required environment variables (`DATABASE_URL`, `JWT_SECRET`, API keys).

```bash
# Install dependencies
npm install

# Push the database schema (first run only, enable pg_trgm — see DEV_SETUP)
npm run db:push

# Start the Express backend (port 3000)
npm run server:dev

# Build and run in the iOS Simulator (recommended for camera features)
npx expo run:ios

# Or run via Expo Go (simpler, but camera is unavailable)
npm run expo:dev
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system overview, data flow, and directory layout
- [docs/API.md](docs/API.md) — REST API reference (routes, auth, request/response shapes)
- [docs/DATABASE.md](docs/DATABASE.md) — database schema and table relationships
- [docs/FRONTEND.md](docs/FRONTEND.md) — client architecture, navigation, and state management
- [docs/DEV_SETUP.md](docs/DEV_SETUP.md) — environment setup, iOS/Android, and troubleshooting
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — feature walkthrough from a user's perspective
- [docs/ROADMAP.md](docs/ROADMAP.md) — planned work and direction
