---
title: 'Test fetch mocks route by parsed hostname, never url.includes(host); CodeQL flags the substring form'
track: knowledge
category: conventions
module: server
tags: [testing, security, codeql]
applies_to: ["server/**/__tests__/*.ts"]
created: '2026-11-04'
---

# Test fetch mocks route by parsed hostname, never url.includes(host); CodeQL flags the substring form

## Rule

When a test's `fetch` mock branches on which upstream is being called, compare the parsed hostname:

```ts
// ✅
if (new URL(url).hostname === "api.api-ninjas.com") { ... }
// ❌ CodeQL js/incomplete-url-substring-sanitization (high)
if (url.includes("api-ninjas.com")) { ... }
```

## Why

CodeQL's `js/incomplete-url-substring-sanitization` scans test files too. It raised alert 283 (high) on the substring form in `nutrition-lookup.test.ts` and failed the CodeQL check on PR #1733. The executor that opened the PR had reported "all checks passed", so the red check was found only by reading the checks on the head SHA. The hostname form also makes the mock exact: `evil-api-ninjas.com.attacker` no longer matches.

## Related Files

- `server/services/__tests__/nutrition-lookup.test.ts`

## See Also

- [ssrf-ipv6-mapped-hex-form-and-bracketed-hostname](../logic-errors/ssrf-ipv6-mapped-hex-form-and-bracketed-hostname-2026-10-29.md): hostname parsing in production code
