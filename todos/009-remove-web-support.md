---
title: "Remove unnecessary web support code"
status: ready
priority: medium
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [simplification, cleanup, code-review]
---

# Remove Unnecessary Web Support Code

## Summary

This is a MOBILE-ONLY app but contains ~600 lines of web support code including a landing page, web-specific hooks, and web font configurations.

## Background

The user explicitly stated this is a mobile-only app with no web presence. The following web-related code can be removed:

**Files to delete:**
- `client/hooks/useColorScheme.web.ts` (22 lines) - Web SSR handling
- `server/templates/landing-page.html` (466 lines) - Dev landing page

**Code to remove:**
- `server/index.ts:84-189` - Landing page functions (~105 lines)
- `client/constants/theme.ts:130-136` - Web font config
- `client/components/KeyboardAwareScrollViewCompat.tsx:18-26` - Web check

**Dependencies to remove from package.json:**
- `react-native-web`
- `react-dom`
- `http-proxy-middleware`
- `ws` (unused)

## Acceptance Criteria

- [ ] Delete `client/hooks/useColorScheme.web.ts`
- [ ] Delete `server/templates/` directory
- [ ] Remove `serveLandingPage`, `serveExpoManifest`, `getAppName`, `configureExpoAndLanding` from server/index.ts
- [ ] Remove web font config from theme.ts
- [ ] Simplify KeyboardAwareScrollViewCompat (remove web check)
- [ ] Remove unused npm dependencies
- [ ] Verify app still works correctly

## Implementation Notes

After removing landing page functions from server/index.ts, the main function becomes simpler:

```typescript
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  // Serve static assets only
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));

  const server = await registerRoutes(app);
  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen({ port, host: "0.0.0.0" }, () => {
    log(`express server serving on port ${port}`);
  });
})();
```

## Dependencies

- None

## Risks

- Landing page is useful during development for sharing Expo URLs
- Consider keeping a minimal version or using a different approach for dev

## Updates

### 2026-01-30
- Initial creation from code review
- Estimated ~600 LOC reduction
