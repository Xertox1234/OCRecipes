---
title: "multer `fields: 1` leaves no headroom — a second upload parameter from any client would 400 in production"
status: done
priority: low
created: 2026-09-24
updated: 2026-10-01
assignee:
labels: [deferred, server, client]
github_issue:
---

# Guard the `fields: 1` upload limit against a client adding a second parameter

## Summary

PR #1035 set `MULTIPART_LIMITS.fields: 1` in `server/routes/_upload.ts`, which fits every current
client exactly. A client that adds a second form field would fail every upload with 400
`LIMIT_FIELD_COUNT`, and nothing on the client side warns about it.

## Background

Raised by the security-auditor review of #1035 (no blocking findings). Client call sites that send
form fields: `client/lib/photo-upload.ts` lines 141 (`{ intent }`), 305-315 (optional `barcode`),
550 (`{ barcode }`).

## Acceptance Criteria

- [x] A client-side test asserts each upload helper in `client/lib/photo-upload.ts` sends at most
      one non-file field, naming `MULTIPART_LIMITS.fields` in a comment (the constant is not
      exported, so the test pins a literal `1` — it will not notice if the server value changes)
- [x] A one-line comment at each `parameters` site points to `MULTIPART_LIMITS` in
      `server/routes/_upload.ts`

## Implementation Notes

- Files: `client/lib/photo-upload.ts`, `client/lib/__tests__/` (new or existing photo-upload test).
- Do not raise the server limit here; changing it is a security decision.

## Scope Contract

- **Mechanisms to use:** a unit test and comments; nothing new on the server.
- **Files in scope:** `client/lib/photo-upload.ts` and its test.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-09-24

- Filed from the #1035 security-auditor review.

### 2026-10-01

- **Implemented.** No tight solution match, so the researcher ran. Added to `client/lib/__tests__/photo-upload.test.ts`: a table-driven budget test over the four `uploadAsync` helpers, each called with every optional argument supplied, asserting at most `MAX_NON_FILE_FIELDS` non-file fields (a literal `1`, commented as a pin of `MULTIPART_LIMITS.fields` in `server/routes/_upload.ts`); a control test pinning the exact fields each helper sends today, so the budget check cannot pass over an empty capture; and a denominator test that every exported `upload*` function has a table row (it pins the naming convention only; `uploadRecipeTextForAnalysis` is a JSON POST and is the one listed exception). `client/lib/photo-upload.ts` got a one-line `// Form-field limit: MULTIPART_LIMITS.fields (server/routes/_upload.ts)` comment above each of its three `parameters` sites (comments only, no behaviour change).
- RED came from mutation, not a pre-fix state, because the code already complied. A second field in each helper reddened exactly that helper's budget and control rows (and, for `uploadPhotoForAnalysis`, the one existing literal pin of `parameters: { intent: "log" }` in its success test). A field rename, and one extra field inside the budget, reddened only the control row. A new `upload*` export reddened only the denominator test. `photo-upload.ts` was restored byte-identical before the comments went in.
- Not changed: the server limit (a security decision). The other client uploaders (`useAvatarUpload`, `cookbook-cover-upload`, the FormData hooks) send no non-file fields today and are outside this todo's file scope.
- Review: `code-reviewer` alone (a test plus comments, no domain lens needed) returned no findings after re-running the mutation set on a scratch copy. One sentence of the test's table comment said "every optional argument" although `uploadPhotoForAnalysis`'s optional `AbortSignal` is not supplied; tightened in a follow-up commit. Full suite, whole-program types and lint were green (the 5 lint warnings are in files this change does not touch).
