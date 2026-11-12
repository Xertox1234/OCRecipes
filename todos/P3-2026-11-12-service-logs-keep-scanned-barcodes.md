---
title: "Service logs still keep scanned barcodes"
status: backlog
priority: low
created: 2026-11-12
updated: 2026-11-12
assignee:
labels: [deferred, privacy]
github_issue:
---

# Service logs still keep scanned barcodes

## Summary

The request log and Sentry no longer keep a scanned barcode (security audit 2026-11-12, L12),
but the service log lines written while a barcode is looked up still do. A barcode is a product
code, not a person, yet together with the request id on the same line it says what one user
scanned.

## Background

Found during the review of the L12 fix (security audit 2026-11-12). The fix covered the two
places that record every request: the access log (`server/lib/log-url.ts` `loggedPath`) and the
Sentry request URL (`server/lib/error-reporter.ts` `scrubbedRequestUrl`). These lines were left
as they are:

- `server/services/barcode-lookup.ts` — about a dozen `log.info` / `log.debug` / `log.error`
  lines with `{ barcode: code, … }` (for example lines 385, 455, 576, 677, 689, 715, 725, 737,
  754, 770, 816).
- `server/routes/verification.ts:201` — an info line with `{ barcode, divergentCount, … }` when
  a product's submissions disagree.

Some of these exist to debug a bad product record (a wrong match in Open Food Facts, a
discrepancy between two sources), where the barcode is the thing being debugged.

## Acceptance Criteria

- [ ] Decide per line: drop the barcode, keep it at `debug` only (production runs at `info`), or
      keep it because the line is about the product record and not the request.
- [ ] Lines that keep a barcode at `info` or above carry no request id or user id next to it, or
      the PR says why they must.
- [ ] A test for any helper that is added; no test needed for a field removed from a log call.

## Implementation Notes

- Check what `LOG_LEVEL` production runs at before choosing "debug only".
- The retention of Railway logs is short; this is about tidiness of what is recorded, not an
  exposure to anyone outside.

## Scope Contract

- **Mechanisms to use:** the existing pino service logger; no new log-scrubbing layer.
- **Files in scope:** `server/services/barcode-lookup.ts`, `server/routes/verification.ts`,
  their `__tests__/` files.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Dropping the barcode from a discrepancy line makes a bad product record harder to find.

## Updates

### 2026-11-12

- Initial creation (security audit 2026-11-12, review of finding L12)
