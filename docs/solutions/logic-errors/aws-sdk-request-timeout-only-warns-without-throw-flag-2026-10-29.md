---
title: The AWS SDK v3 Node handler has no timeouts by default, and requestTimeout alone only logs a warning — set throwOnRequestTimeout too
track: bug
category: logic-errors
module: server
severity: medium
tags: [architecture, reliability, aws-sdk, s3, r2, timeouts, network]
symptoms: ["a stalled R2 hangs avatar, cover and recipe-image requests", "requestTimeout set but the request still never fails"]
applies_to: [server/lib/image-store.ts]
created: '2026-10-29'
---

# AWS SDK request timeouts need throwOnRequestTimeout

## Problem

The R2 `S3Client` was built with the default `NodeHttpHandler`, whose `connectionTimeout`, `requestTimeout` and `socketTimeout` are all 0 (disabled). A stalled R2 hung every upload and delete.

## Symptoms

- Requests that touch R2 never return during an R2 incident.

## Root Cause

Defaults are 0 (`@smithy/types` `httpHandlerInitialization.d.ts`). And in `@smithy/node-http-handler` 4.x, an expired `requestTimeout` calls `logger.warn` and keeps waiting unless `throwOnRequestTimeout` is true (`dist-cjs/index.js` `setRequestTimeout`) — the obvious one-line fix does nothing.

## Solution

```ts
new S3Client({
  ...,
  requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000, throwOnRequestTimeout: true },
});
```

The plain-object `requestHandler` shorthand is accepted since 3.521; `throwOnRequestTimeout` since 3.910. A timeout then rejects with a `TimeoutError`.

## Prevention

- When adding any SDK client, read its handler defaults; assert the constructor options in a test.
- The OpenAI SDK has the opposite trap: a 600 s default timeout and 2 retries (`maxRetries`) per call.

## Related Files

- `server/lib/image-store.ts`
- `server/lib/__tests__/image-store.test.ts`
