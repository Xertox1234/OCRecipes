---
title: JWT Types in Shared Code Bundle Into React Native Client
track: bug
category: code-quality
module: shared
severity: medium
tags: [bundling, metro, shared-types, jsonwebtoken, node-modules]
symptoms: [React Native bundle pulls `jsonwebtoken` and Node `crypto` polyfills, '`shared/` file imports a server-only package', Bundle size increases unexpectedly after a 'pure types' refactor]
applies_to: [shared/types/**/*.ts, server/lib/**/*.ts]
created: '2026-03-27'
---

# JWT Types in Shared Code Bundle Into React Native Client

## Problem

The `AccessTokenPayload` interface and `isAccessTokenPayload` type guard were defined in `shared/types/auth.ts`. The file imported from the `jsonwebtoken` package to extend `JwtPayload`. Because `shared/` is aliased as `@shared/` and used by both server and client, the Metro bundler followed the import chain: `shared/types/auth.ts` → `jsonwebtoken` → Node.js `crypto`. The entire `jsonwebtoken` package and its Node dependencies were pulled into the React Native client bundle.

## Symptoms

- React Native bundle larger than expected
- Metro warnings about Node core modules
- A `import type` line in `shared/` triggers a runtime dependency in the client

## Root Cause

TypeScript `import type` syntactically erases at compile time, but `import { JwtPayload } from "jsonwebtoken"` (even when used only for typing) is a value import that Metro must resolve. Metro resolves it, walks the package, and follows its runtime imports. The Node-only `crypto` module is reachable from `jsonwebtoken`'s entry. Metro stubs or polyfills some Node modules but bundles the rest. The transitive dependency surfaces from a single innocuous extension.

## Solution

Move the JWT-specific types and type guard to `server/lib/jwt-types.ts` (server-only). Keep `shared/types/auth.ts` to types that both client and server genuinely need (e.g., `AuthResponse`, `LoginInput`), with no `jsonwebtoken` dependency:

```typescript
// server/lib/jwt-types.ts — new home
import type { JwtPayload } from "jsonwebtoken";

export interface AccessTokenPayload extends JwtPayload {
  userId: string;
  tokenVersion: number;
}

export function isAccessTokenPayload(x: unknown): x is AccessTokenPayload {
  /* ... */
}
```

Server middleware imports from `server/lib/jwt-types` instead of `@shared/types/auth`.

## Prevention

- Files in `shared/` must never import server-only packages (`jsonwebtoken`, `bcrypt`, `pg`, `nodemailer`, etc.) — Metro will try to bundle them.
- When a type extends a library-specific base type (like `JwtPayload`), that type belongs in the server, not in shared.
- Watch for transitive dependencies: a single `import type` that also pulls in a runtime `import` can cascade. Even `import type { X } from "pkg"` triggers Metro module resolution.
- Audit `shared/` periodically by grepping for known server-only package names.

## Related Files

- `server/lib/jwt-types.ts` — new home for `AccessTokenPayload` and `isAccessTokenPayload`
- `shared/types/auth.ts` — cleaned of `jsonwebtoken` dependency
- `server/middleware/auth.ts` — updated import path

## See Also

- [Import and re-export shared types](../conventions/import-and-re-export-shared-types-2026-05-13.md)
