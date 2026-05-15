---
status: complete
priority: p1
issue_id: "001"
tags: [security, backend, photo-upload]
dependencies: []
---

# Add file type validation to multer upload

## Problem Statement

Missing MIME type and file extension validation on photo uploads. Attackers could upload malicious files disguised as images, potentially leading to server compromise or stored XSS attacks.

## Findings

- Location: `server/routes.ts`
- The multer configuration accepts any file type without validation
- Only `fileSize` limit is set, no `fileFilter`

## Proposed Solutions

### Option 1: Add fileFilter to multer config

- **Pros**: Simple, well-documented approach
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

```typescript
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP allowed."));
    }
  },
});
```

## Recommended Action

Implement Option 1 - add fileFilter with MIME type whitelist.

## Technical Details

- **Affected Files**: `server/routes.ts`
- **Related Components**: Photo analysis endpoints
- **Database Changes**: No

## Resources

- Original finding: Code review (security-sentinel)

## Acceptance Criteria

- [ ] Multer config includes fileFilter with MIME type validation
- [ ] Only image/jpeg, image/png, image/webp are accepted
- [ ] Invalid file types return appropriate error message
- [ ] Tests pass
- [ ] Code reviewed

## Work Log

### 2026-02-01 - Approved for Work

**By:** Claude Triage System
**Actions:**

- Issue approved during triage session
- Status: ready
- Ready to be picked up and worked on

**Learnings:**

- Security validation should happen at upload boundary

## Notes

Source: Triage session on 2026-02-01
