---
title: "Investigate verification_history FK insert ordering in submitVerification"
status: backlog
priority: medium
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, database]
github_issue:
---

# Investigate verification_history FK insert ordering in submitVerification

## Summary

`submitVerification` (`server/storage/verification.ts`) appears to insert into `verification_history` _before_ upserting the parent `barcode_verifications` row, which on paper would violate a non-deferrable foreign key on a barcode's first-ever verification. It has run in production since 2026-03-19 with no reported breakage — so either the live DB lacks the constraint (schema drift) or the ordering is not what it appears. Confirm which.

## Background

Surfaced as an out-of-scope observation during the 2026-05-16 full audit (data-integrity domain). `server/storage/verification.ts` was not in that audit's changed-file scope, so it was not investigated — only flagged. See `docs/audits/2026-05-16-full.md` → Post-Audit Notes.

`verification_history.barcode` has `.references(() => barcodeVerifications.barcode, { onDelete: "cascade" })` (`shared/schema.ts`), a non-deferrable FK. The referenced column `barcode_verifications.barcode` is `.unique()`. If `verification_history` is inserted before the parent `barcode_verifications` row exists, PostgreSQL's IMMEDIATE constraint check fires at statement end and the insert should fail.

## Acceptance Criteria

- [ ] Determine the actual insert order in `submitVerification` (read the function end-to-end, including any transaction wrapping)
- [ ] Confirm whether the FK constraint exists in the live/dev database (`\d verification_history` via psql)
- [ ] If the ordering is genuinely parent-after-child: reorder so `barcode_verifications` is upserted first, or wrap in a transaction with the parent insert first
- [ ] If the constraint is missing from the live DB (schema drift): run `db:push` to apply it, after confirming no orphan `verification_history` rows exist
- [ ] Add a storage test covering a first-ever verification of a brand-new barcode

## Implementation Notes

- Primary file: `server/storage/verification.ts` — `submitVerification`
- Schema: `shared/schema.ts` — `barcodeVerifications`, `verificationHistory`
- This is a verification-scoped concern; consider folding it into the next verification-domain audit rather than a standalone fix if convenient.

## Dependencies

- None.

## Risks

- If the live DB is missing the FK constraint, applying it could fail if orphan history rows already exist — check before `db:push`.
