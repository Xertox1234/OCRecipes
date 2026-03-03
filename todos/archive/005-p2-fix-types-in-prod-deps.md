---
title: "Move @types packages to devDependencies"
status: done
priority: medium
created: 2026-02-27
updated: 2026-03-02
assignee:
labels: [dependencies, config, tech-debt]
---

# Move @types Packages to devDependencies

## Summary

Three `@types/*` packages are in production `dependencies` instead of `devDependencies`. They're only needed at build/compile time and inflate the production install.

## Affected Packages

- `@types/bcrypt` (line 41)
- `@types/jsonwebtoken` (line 42)
- `@types/multer` (line 43)

## Acceptance Criteria

- [x] All three `@types/*` packages moved to `devDependencies`
- [x] `npm install --production` no longer installs type packages
- [x] TypeScript compilation still works (`npm run check:types`)
- [x] Server builds successfully (`npm run server:build`)

## Implementation Notes

```bash
npm uninstall @types/bcrypt @types/jsonwebtoken @types/multer
npm install -D @types/bcrypt @types/jsonwebtoken @types/multer
```

Also rename `"name": "my-app"` in package.json to `"nutriscan"` while touching the file.

## Dependencies

- None

## Risks

- None — type packages are never imported at runtime

## Updates

### 2026-02-27
- Initial creation from codebase audit
