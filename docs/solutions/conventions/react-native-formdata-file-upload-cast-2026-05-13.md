---
title: React Native `FormData` file upload cast — `as unknown as Blob`
track: knowledge
category: conventions
module: client
tags: [react-native, formdata, file-upload, typescript, multipart]
applies_to: [client/**/*.ts, client/**/*.tsx]
created: '2026-05-13'
---

# React Native `FormData` file upload cast — `as unknown as Blob`

## Rule

React Native's `FormData.append()` for file uploads requires an object with `uri`/`type`/`name` fields, but TypeScript types it as `Blob`. Use `as unknown as Blob` with a comment.

## Examples

```typescript
// React Native FormData accepts object with uri/type/name (differs from web Blob API)
formData.append("photos", {
  uri: compressed.uri,
  type: "image/jpeg",
  name: `receipt_${index}.jpg`,
} as unknown as Blob);
```

## When this applies

Any `FormData` file upload in React Native.

## Why

React Native's network layer serializes `{ uri, type, name }` objects as multipart file parts, but TypeScript expects `Blob | string`. The cast is unavoidable — the comment explains why.
