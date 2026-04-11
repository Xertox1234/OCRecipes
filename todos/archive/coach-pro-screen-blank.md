---
title: "Coach Pro: Screen renders blank — debug and fix"
status: backlog
priority: high
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [coach-pro, client, bug, urgent]
---

# Coach Pro: Screen renders blank on load

## Summary

The CoachProScreen renders as a completely blank screen (just background color + tab bar visible). The Coach tab now routes to CoachProScreen for premium users but nothing renders. Needs debugging and fixing.

## Background

The Coach Pro feature was implemented and merged via PR #36 (squash merged to main). The ChatStackNavigator was updated to conditionally route `coachPro` users to `CoachProScreen` instead of `ChatList` via `initialRouteName`. The screen loads (the background color is correct, tab bar shows Coach as selected) but no content appears — no dashboard, no chat, no error.

## Likely Causes (investigate in order)

1. **`useCoachContext` hook blocks rendering** — The screen conditionally renders `CoachDashboard` only when `context` data exists (`{context && <CoachDashboard ... />}`). If the `GET /api/coach/context` call fails (403 because premium check fails, network error, or server error), `context` will be undefined and the dashboard never renders. The `CoachChat` component should still render regardless, but check if it has a similar conditional.

2. **`usePremiumFeature("coachPro")` returns false** — If the premium context hasn't loaded yet or returns false, `useCoachContext(false)` is called with `enabled: false`, so it never fetches. And `CoachChat` receives `isCoachPro: false`. Verify the premium context is loaded before the screen mounts.

3. **`useCoachContext` endpoint returns 403** — The `GET /api/coach/context` endpoint calls `checkPremiumFeature(req, res, "coachPro", "Coach Pro")`. If the server's `TIER_FEATURES.premium` doesn't include `coachPro`, this returns 403. Verify by running: `curl -s http://localhost:3000/api/coach/context -H "Authorization: Bearer <token>"`.

4. **CoachChat has no visible content when conversationId is null** — On initial load, `conversationId` is `null`. The `useChatMessages(null)` hook has `enabled: !!conversationId` so it returns no messages. If CoachChat renders nothing when there are no messages and no streaming content, the screen will be blank.

5. **Import error or crash** — Check Metro bundler logs and React Native debugger for errors. A missing import or undefined component would cause a blank render.

## Debugging Steps

```bash
# 1. Check if the context endpoint works
TOKEN=$(curl -s http://localhost:3000/api/auth/login -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"demo123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s http://localhost:3000/api/coach/context -H "Authorization: Bearer $TOKEN"
# Should return JSON with goals, todayIntake, notebook, suggestions
# If 403 → premium feature not recognized
# If 500 → server error in context assembly

# 2. Check Metro logs for errors
# Look at the terminal running `npx expo start` for red error output

# 3. Check React Native debugger
# In simulator: Cmd+D → "Open Debugger" → check console for errors
```

## Key Files

- `client/screens/CoachProScreen.tsx` — Main screen, composes dashboard + chat
- `client/components/coach/CoachDashboard.tsx` — Dashboard (only renders when context loaded)
- `client/components/coach/CoachChat.tsx` — Chat area
- `client/hooks/useCoachContext.ts` — Fetches /api/coach/context
- `client/navigation/ChatStackNavigator.tsx` — Routes to CoachPro when `isCoachPro`
- `server/routes/coach-context.ts` — GET /api/coach/context endpoint

## Acceptance Criteria

- [ ] Coach tab shows the CoachProScreen with dashboard header for premium users
- [ ] Dashboard shows greeting, stat cards, and suggestion chips
- [ ] Chat input bar is visible and functional
- [ ] Non-premium users still see the old chat list

## Updates

### 2026-04-10
- Initial creation after blank screen observed in simulator
- Backend confirmed serving `coachPro: true` for demo user
- Navigator correctly sets `initialRouteName="CoachPro"` for coachPro users
- Screen loads (correct background, tab selected) but renders no content
