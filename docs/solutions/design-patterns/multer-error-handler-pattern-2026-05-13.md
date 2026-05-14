---
title: "Multer error handler pattern (400 not 500)"
track: knowledge
category: design-patterns
tags: [security, multer, file-upload, error-handling, express]
module: server
applies_to: ["server/index.ts", "server/routes/**/*.ts"]
created: 2026-05-13
---

# Multer error handler pattern (400 not 500)

## When this applies

Add specific error handling for file upload validation to return 400 (not 500). Without this handler, multer validation errors bubble up as 500 Internal Server Error, which is misleading (the error is the client's fault).

## Examples

```typescript
import multer, { MulterError } from "multer";

// Multer config with fileFilter
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

// Error handler (add before createServer)
app.use(
  (
    err: Error,
    req: Request,
    res: Response,
    next: (err?: Error) => void,
  ): void => {
    if (err instanceof MulterError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    if (err.message?.includes("Invalid file type")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  },
);
```

## Why

Without this handler, multer validation errors bubble up as 500 Internal Server Error. Client errors (bad file type, file too large) should be 4xx; reserving 5xx for genuine server failures preserves alerting fidelity.

## See Also

- [Magic-byte validation for all file uploads](../conventions/magic-byte-validation-file-uploads-2026-05-13.md)
- [Generic error messages for 5xx responses](../conventions/generic-error-messages-5xx-2026-05-13.md)
