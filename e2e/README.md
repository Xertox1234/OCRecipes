# E2E Tests (Maestro)

## Prerequisites

- [Maestro CLI](https://maestro.mobile.dev/) installed: `brew install maestro`
- Backend running: `npm run server:dev`
- App built and running in iOS Simulator: `npx expo run:ios`

## Environment Variables

All flows that require authentication use these env vars:

| Variable   | Description           | Default       |
| ---------- | --------------------- | ------------- |
| `USERNAME` | Test account username | `testuser`    |
| `PASSWORD` | Test account password | `testpass123` |

Set them before running:

```bash
export USERNAME=testuser
export PASSWORD=testpass123
```

## Running Tests

```bash
npm run e2e          # Run all E2E flows
npm run e2e:smoke    # Run smoke-tagged flows only (auth + navigation + onboarding)
```

## CI

A manual-trigger-only `E2E Smoke` workflow (`.github/workflows/e2e-smoke.yml`) runs `npm run e2e:smoke` on demand from the GitHub Actions tab. It is intentionally **`workflow_dispatch` only** — no push, pull_request, or scheduled trigger — because it runs on a paid macOS runner (~10x Linux minutes) and the app has no production deployment yet. Trigger it deliberately when you want to confirm the smoke flows still pass.

## Flow Structure

```
e2e/
  helpers/
    login.yaml          # Reusable login helper
  flows/
    auth/               # Authentication flows
    onboarding/         # Registration + onboarding
    home/               # Home tab, history, chat, exercise
    scan/               # Camera, barcode, photo analysis
    plan/               # Recipes, grocery lists, meal planning
    profile/            # Profile settings, goals, weight
```
