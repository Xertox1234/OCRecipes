---
title: 'Multi-photo GPT-4o vision calls: send all images in a single request'
track: knowledge
category: design-patterns
module: server
tags: [ai, openai, gpt-4o, vision, receipt, menu]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Multi-photo GPT-4o vision calls: send all images in a single request

## When this applies

When analyzing multi-page documents (receipts, menus), send all photos as separate `image_url` entries in a single API call rather than making multiple calls.

## Why

A single call gives the model cross-image context (e.g., store name on page 1, items on page 2), is faster than sequential calls, and uses fewer API requests.

## Examples

```typescript
// server/services/receipt-analysis.ts
const imageContent = imagesBase64.map((base64) => ({
  type: "image_url" as const,
  image_url: {
    url: `data:image/jpeg;base64,${base64}`,
    detail: "high" as const,
  },
}));

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  max_completion_tokens: 4096,
  temperature: 0.2, // Low temperature for structured extraction
  messages: [
    { role: "system", content: RECEIPT_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: "Extract all food items from this receipt:" },
        ...imageContent,
      ],
    },
  ],
  response_format: { type: "json_object" },
});
```

## When to use

Analyzing multi-page/multi-photo documents where context spans images (receipts, multi-page menus).

## Exceptions

Independent single-photo analyses where results don't depend on each other.

## Related Files

- `server/services/receipt-analysis.ts`

## See Also

- [AI input sanitization boundary](ai-input-sanitization-boundary-2026-05-13.md)
