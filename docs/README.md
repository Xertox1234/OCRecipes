# NutriScan Documentation

Welcome to the NutriScan documentation. This guide covers everything you need to know about developing, deploying, and using NutriScan.

## Quick Links

| Document | Description |
|----------|-------------|
| [DEV_SETUP.md](./DEV_SETUP.md) | Development environment setup |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture and design |
| [API.md](./API.md) | Complete API reference |
| [DATABASE.md](./DATABASE.md) | Database schema and queries |
| [FRONTEND.md](./FRONTEND.md) | Frontend development guide |
| [USER_GUIDE.md](./USER_GUIDE.md) | End-user documentation |

---

## What is NutriScan?

NutriScan is a mobile nutrition tracking application that helps users:

- **Scan food barcodes** to instantly view nutritional information
- **Track daily intake** with automatic calorie and macro calculations
- **Receive AI-powered suggestions** for recipes and food pairings
- **Manage dietary preferences** including allergies and health conditions

## Tech Stack

### Frontend
- **Expo SDK 54** - React Native development platform
- **React Native 0.81** - Cross-platform mobile UI
- **React 19** - UI library
- **React Navigation 7** - Navigation and routing
- **TanStack Query 5** - Server state management
- **Reanimated 4** - Animations

### Backend
- **Express.js 5** - Web server framework
- **Drizzle ORM** - TypeScript-first ORM
- **PostgreSQL** - Relational database
- **OpenAI API** - AI-powered suggestions

### Shared
- **TypeScript** - Type safety
- **Zod** - Schema validation

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 12+
- iOS device/simulator or Android device/emulator
- Expo Go app (for development)

### Quick Start

```bash
# Clone the repository
git clone <repo-url>
cd Nutri-Cam

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL and API keys

# Push database schema
npm run db:push

# Start development servers (in separate terminals)
npm run server:dev    # Terminal 1: Backend
npm run expo:dev      # Terminal 2: Frontend
npx localtunnel --port 3000  # Terminal 3: Backend tunnel
```

See [DEV_SETUP.md](./DEV_SETUP.md) for detailed setup instructions.

---

## Project Structure

```
Nutri-Cam/
├── client/                 # React Native/Expo frontend
│   ├── components/         # Reusable UI components
│   ├── constants/          # Theme and configuration
│   ├── context/            # React Context providers
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utilities
│   ├── navigation/         # Navigation configuration
│   └── screens/            # Screen components
├── server/                 # Express.js backend
│   ├── index.ts            # Server entry point
│   ├── routes.ts           # API routes
│   ├── storage.ts          # Database operations
│   └── db.ts               # Database connection
├── shared/                 # Shared code
│   └── schema.ts           # Database schema
├── docs/                   # Documentation
└── assets/                 # Images and icons
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Express session encryption key |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Yes | OpenAI API key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | No | Custom OpenAI endpoint |
| `EXPO_PUBLIC_DOMAIN` | No | Public API domain for mobile |

---

## Development Commands

```bash
# Frontend
npm run expo:dev          # Start Expo with tunneling

# Backend
npm run server:dev        # Start Express server (dev)
npm run server:build      # Build for production
npm run server:prod       # Run production build

# Database
npm run db:push           # Sync schema to database

# Code Quality
npm run lint              # Run ESLint
npm run lint:fix          # Fix ESLint issues
npm run check:types       # TypeScript type checking
npm run format            # Format with Prettier
```

---

## API Overview

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Sign in
- `POST /api/auth/logout` - Sign out
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile

### Dietary Profile
- `GET /api/user/dietary-profile` - Get preferences
- `POST /api/user/dietary-profile` - Create/update preferences

### Food Tracking
- `GET /api/scanned-items` - List scanned items
- `GET /api/scanned-items/:id` - Get item details
- `POST /api/scanned-items` - Add scanned item
- `GET /api/daily-summary` - Daily nutrition summary

### AI Features
- `POST /api/items/:id/suggestions` - Get AI suggestions

See [API.md](./API.md) for complete documentation.

---

## Key Features

### Barcode Scanning
- Supports EAN-13, EAN-8, UPC-A, UPC-E, QR codes
- Real-time camera detection
- Flash support for low light

### Nutrition Tracking
- Automatic daily calorie/macro aggregation
- Serving size multipliers
- Historical data retention

### AI Suggestions
- Personalized based on dietary profile
- Considers allergies and restrictions
- Recipe difficulty and time estimates

### Onboarding
- 6-step preference collection
- Allergy severity levels
- Health condition awareness

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run linting and type checking
5. Submit a pull request

---

## License

Private project - All rights reserved.
