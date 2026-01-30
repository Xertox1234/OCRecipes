---
title: "Restrict CORS configuration to known origins"
status: ready
priority: high
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [security, api, code-review]
---

# Restrict CORS Configuration

## Summary

The CORS configuration reflects any request origin, allowing any website to make authenticated requests to the API when combined with `Access-Control-Allow-Credentials: true`.

## Background

Current implementation in `server/index.ts:17-36`:

```typescript
function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.header("origin");
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Access-Control-Allow-Credentials", "true");
    // ...
  });
}
```

This allows any website to make cross-origin requests with the user's credentials, enabling potential CSRF attacks and data theft.

## Acceptance Criteria

- [ ] Implement origin whitelist for allowed domains
- [ ] Only set Allow-Credentials when origin is whitelisted
- [ ] Include Expo development URLs in whitelist
- [ ] Verify mobile app functionality is unaffected

## Implementation Notes

```typescript
const ALLOWED_ORIGINS = [
  'https://your-production-domain.com',
  /^exp:\/\/.*$/,  // Expo development
  /^https?:\/\/localhost(:\d+)?$/,  // Local development
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed =>
    typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
  );
}
```

Note: For a mobile-only app, CORS is less critical since native apps don't follow CORS rules. However, fixing this is still good practice.

## Dependencies

- None

## Risks

- Could break development if Expo tunnel URLs not properly whitelisted

## Updates

### 2026-01-30
- Initial creation from code review
