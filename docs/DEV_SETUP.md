# Development Setup Guide

## Overview

This guide covers everything needed to set up the NutriScan development environment. The project uses **tunneling** to allow mobile devices to connect to your local development server.

## Prerequisites

### Required Software

| Software   | Version | Installation                      |
| ---------- | ------- | --------------------------------- |
| Node.js    | 18+     | [nodejs.org](https://nodejs.org)  |
| npm        | 9+      | Included with Node.js             |
| PostgreSQL | 12+     | `brew install postgresql` (macOS) |
| Expo Go    | Latest  | App Store / Play Store            |

### Optional Tools

- **ngrok** - Alternative tunnel (more reliable)
- **cloudflared** - Cloudflare tunnel option
- **Postman** - API testing

## Initial Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone <repo-url>
cd Nutri-Cam

# Install dependencies
npm install
```

### 2. Environment Variables

Create a `.env` file in the project root:

```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/nutriscan

# JWT
JWT_SECRET=your-secure-random-string-here

# OpenAI
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1  # Optional

# Mobile API URL (optional - set when using fixed tunnel)
EXPO_PUBLIC_DOMAIN=https://your-tunnel.loca.lt
```

### 3. Database Setup

```bash
# Start PostgreSQL (if not running)
brew services start postgresql  # macOS

# Create database
createdb nutriscan

# Push schema to database
npm run db:push
```

## Port Configuration

| Service         | Port | Notes                      |
| --------------- | ---- | -------------------------- |
| Express Backend | 3000 | Avoid 5000 (Apple AirPlay) |
| Expo Metro      | 8081 | Auto-tunneled by Expo      |
| PostgreSQL      | 5432 | Default                    |

## Starting Development Servers

### Terminal 1: Backend Server

```bash
npm run server:dev
```

This starts the Express server on port 3000 with hot reloading.

Expected output:

```
Server running on port 3000
Connected to database
```

### Terminal 2: Expo Frontend

```bash
npm run expo:dev
```

This starts Expo with automatic ngrok tunneling (via `--tunnel` flag).

Expected output:

```
Metro waiting on exp://...
› Tunnel ready
› Scan the QR code above with Expo Go
```

### Terminal 3: Backend Tunnel

```bash
npx localtunnel --port 3000
```

This creates a public HTTPS URL for your backend API.

Expected output:

```
your url is: https://major-snakes-draw.loca.lt
```

**Important**:

- The tunnel URL changes each time you restart localtunnel
- You MUST open the tunnel URL in a browser first and click "Click to Continue" on the security page
- Without this step, all API requests will timeout with 408 errors

### 4. Configure API URL

After starting localtunnel, update the default URL in `client/lib/query-client.ts`:

```typescript
export function getApiUrl(): string {
  let host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    // UPDATE THIS URL EVERY TIME YOU RESTART LOCALTUNNEL
    return "https://major-snakes-draw.loca.lt";
  }
  // ...
}
```

Or set `EXPO_PUBLIC_DOMAIN` in your `.env` file.

### 5. Bypass Localtunnel Security Page

**CRITICAL STEP**: Open your tunnel URL (e.g., `https://major-snakes-draw.loca.lt`) in a web browser:

1. You'll see a localtunnel security/landing page
2. Click "Click to Continue"
3. This unlocks the tunnel for API requests

If you skip this step, your mobile app will get 408 timeout errors when trying to login/register.

##IMPORTANT: Follow these steps after starting localtunnel:

# 1. Copy the tunnel URL (e.g., https://major-snakes-draw.loca.lt)

# 2. Update client/lib/query-client.ts with the new URL

# 3. Open the tunnel URL in a browser and click "Click to Continue"

# 4. Reload your app in Expo Go

```bash
# Terminal 1: Backend
npm run server:dev

# Terminal 2: Expo
npm run expo:dev

# Terminal 3: Backend tunnel
npx localtunnel --port 3000

# Copy the tunnel URL and update query-client.ts or .env
```

## Testing Your Setup

1. **Scan the QR code** shown by Expo on your mobile device
2. **Open Expo Go** - the app will load
3. **Check backend logs** - you should see API requests
4. **Register an account** - verify database connection

## CORS Configuration

The backend allows all origins in development mode:

```typescript
// server/index.ts - setupCors()
res.header("Access-Control-Allow-Origin", origin || "*");
```

This prevents 403 CORS errors when accessing from mobile devices.

## Code Quality Commands

````bash
# ESLint
npm run lint           # Check for issues
npm run lint:fix       # Auto-fix issues

# TypeScript
npm run check:types    # Type checking

# Prettier
npm run format         # Format all files
npm run check:format   # Check formatting
``` / 408 Timeout

1. **Open tunnel URL in browser** - Visit the localtunnel URL and click "Click to Continue"
2. Verify backend tunnel is running: `ps aux | grep localtunnel`
3. Check `query-client.ts` has the correct tunnel URL
4. Ensure CORS is allowing all origins
5. Restart localtunnel if it's been idle (tunnels can expire)
1. Verify backend tunnel is running
2. Check `query-client.ts` has the correct tunnel URL
3. Ensure CORS is allowing all origins
4. Try accessing the tunnel URL in a browser first

### Port Already in Use

```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 npm run server:dev
````

### Database Connection Failed

```bash
# Check PostgreSQL is running
pg_isready

# Check connection string
psql $DATABASE_URL

# Create database if missing
**Localtunnel Security Page**: Always open the tunnel URL in a browser first and click through the security page. This is required for API requests to work.

Localtunnel can be unreliable. If you experience frequent timeouts, try a
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

1. Grant camera permissions in device settings
2. Check Expo Go has camera access
3. Try force-closing and reopening Expo Go

## Why Tunneling?

| Issue                                | Solution             |
| ------------------------------------ | -------------------- |
| Mobile can't reach localhost         | Public tunnel URL    |
| Local IPs unreliable across networks | Consistent HTTPS URL |
| Need HTTPS for secure features       | Tunnels provide SSL  |

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
# Shake device → "Debug Remote JS"
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

## Production Build

```bash
# Build backend
npm run server:build
npm run server:prod

# Build Expo (static)
npm run expo:static:build
```

## Notes

- Don't commit tunnel URLs to git (they change each session)
- Port 5000 conflicts with macOS AirPlay Receiver
- Expo's `--tunnel` flag uses @expo/ngrok automatically
- Backend needs a separate tunnel (localtunnel/ngrok/cloudflared)
