---
title: "Use Static `import` for Node Built-Ins and Hot-Path Modules"
track: knowledge
category: conventions
tags: [performance, esm, dynamic-import, node-builtins, hot-path]
module: server
applies_to: ["server/**/*.ts"]
created: 2026-05-13
---

# Use Static `import` for Node Built-Ins and Hot-Path Modules

## Rule

Use static `import` at the top of the module for Node.js built-ins (`crypto`,
`fs`, `path`, `url`, `stream`, etc.) and for any dependency used every time a
function runs. Reserve dynamic `import()` for **conditionally loaded** heavy
optional dependencies.

## Smell patterns

- `const x = await import("crypto")` inside a function called per request.
- `await import()` anywhere on a hot path (auth, route handlers, validation).
- Dynamic imports for tiny utility modules.
- `await import()` "to defer until needed" inside a function that always
  needs it.

## Why

Dynamic imports add real overhead and undermine bundler optimization:

1. **Built-ins are already loaded.** The Node.js runtime has `crypto`, `fs`,
   etc. resident from process start. Dynamic-importing them adds the
   resolution + module-record lookup overhead (~1-5ms per call) to fetch
   something already in memory.
2. **Static imports resolve once at module load.** Dynamic imports resolve on
   every call — even if the module is cached, the await microtask
   scheduling alone costs measurable time on a hot path.
3. **Dynamic imports defeat tree-shaking.** Bundlers can't statically prove
   what's used; conditional code paths can't be eliminated.

## Examples

### Bad — dynamic import on every Google receipt validation

```typescript
async function getGoogleAccessToken(): Promise<string> {
  const crypto = await import("crypto"); // ~1-5ms overhead per call
  const sign = crypto.createSign("RSA-SHA256");
  // ...
}
```

### Good — static import at module top level

```typescript
import crypto from "crypto";

async function getGoogleAccessToken(): Promise<string> {
  const sign = crypto.createSign("RSA-SHA256"); // Instant, already loaded
  // ...
}
```

### When dynamic import is the right choice

Use dynamic `import()` only when:

- The dependency is **large** (e.g., a PDF parser, an image processing lib).
- The dependency is **optional** (only loaded when a feature flag or user
  action triggers it).
- The dependency is **rarely used** (won't pay back the import cost on cold
  start).

```typescript
async function importRecipeFromPdf(file: Buffer) {
  const { parsePdf } = await import("pdf-parse"); // Heavy + only on PDF flow
  return parsePdf(file);
}
```

## Exceptions

- **Plugin systems** that resolve modules by name at runtime — dynamic import
  is structurally required.
- **Code-split bundles** in client bundlers where dynamic import is the
  splitting boundary.

## Related Files

- `server/services/receipt-validation.ts` — fixed the dynamic `crypto` import
  on the Google access-token hot path.

## See Also

- [fetch-timeout-abort-signal-external-apis](fetch-timeout-abort-signal-external-apis-2026-05-13.md) —
  another hot-path performance concern in the same module.
