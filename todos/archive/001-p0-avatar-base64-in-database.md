---
title: "Move avatar images out of PostgreSQL"
status: done
priority: critical
created: 2026-02-27
updated: 2026-02-27
assignee: claude
labels: [performance, database, storage, security]
---

# Move Avatar Images Out of PostgreSQL

## Summary

Avatars are stored as raw base64 data URLs (~1 MB each) directly in the `avatarUrl` text column of the `users` table. This bloats DB rows, degrades query performance, inflates every `GET /api/me` response, and increases backup sizes. Images should be stored on disk or object storage with only a URL reference in the database.

## Background

In `server/routes/auth.ts` (lines 200-240), the avatar upload endpoint converts the uploaded file to a base64 data URL and saves it directly into the `avatarUrl` column. Every subsequent `GET /api/me` call returns the full base64 blob in the JSON response, even when the client already has the image cached.

This is a well-known anti-pattern for relational databases:
- PostgreSQL row size bloat (TOAST storage overhead for large values)
- Every query touching the `users` table pays the cost of loading/skipping the large column
- JSON serialization of 1 MB+ strings on every auth check
- Database backups grow linearly with user count * average avatar size

## Acceptance Criteria

- [ ] Avatar images stored on disk (e.g., `uploads/avatars/`) or object storage (S3-compatible)
- [ ] `avatarUrl` column contains a URL/path reference, not the image data
- [ ] New `GET /api/avatars/:filename` endpoint serves avatar files with proper caching headers (`Cache-Control`, `ETag`)
- [ ] Upload endpoint validates image MIME type and enforces max dimensions (e.g., 512x512)
- [ ] Existing base64 avatars migrated to file storage (migration script)
- [ ] Old base64 data cleared from database after migration
- [ ] `GET /api/me` response size reduced to < 5 KB (excluding avatar blob)
- [ ] All existing tests pass

## Implementation Notes

### Recommended Approach: Local File Storage

1. **Upload handler** (`server/routes/auth.ts`):
   - Accept multipart upload (already using Multer)
   - Resize/compress to max 512x512 using `sharp` or similar
   - Save to `uploads/avatars/{userId}-{timestamp}.webp`
   - Store relative path in `avatarUrl` column
   - Delete old avatar file when user uploads a new one

2. **Serving endpoint**:
   - `GET /api/avatars/:filename` — serve static files from `uploads/avatars/`
   - Add `Cache-Control: public, max-age=86400` and `ETag` headers
   - Consider using Express `express.static()` middleware

3. **Migration script** (`server/scripts/migrate-avatars.ts`):
   - Query all users with base64 `avatarUrl` (starts with `data:image/`)
   - Decode base64, save to file, update column with file path
   - Run in batches to avoid memory spikes

4. **Client update**:
   - Client currently renders `avatarUrl` directly in `<Image source={{ uri: avatarUrl }}>`
   - After migration, `avatarUrl` will be a relative path — prepend `EXPO_PUBLIC_DOMAIN` to form the full URL

### Future: Object Storage

For horizontal scaling, replace local file storage with S3-compatible storage (e.g., MinIO, Cloudflare R2). The URL-in-database pattern makes this a drop-in replacement later.

## Dependencies

- None — self-contained change

## Risks

- Migration must handle users with no avatar (null `avatarUrl`) gracefully
- Need to handle race condition: user uploads new avatar during migration
- Disk storage requires ensuring `uploads/` directory exists and is in `.gitignore`
- Need to set reasonable file size limits on the serving endpoint to prevent abuse

## Updates

### 2026-02-27
- Initial creation from codebase audit
