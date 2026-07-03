---
title: 'Keyboard dismiss on scroll — on-drag for forms, interactive for chat'
track: knowledge
category: conventions
module: client
tags: [react-native, keyboard, scroll, ux, forms, chat]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Keyboard dismiss on scroll — on-drag for forms, interactive for chat

## Rule

Add `keyboardDismissMode` to scrollable views on screens with text inputs. Use `"on-drag"` for forms and `"interactive"` for chat-style screens.

## Examples

```typescript
// Form screens — dismiss on drag
<ScrollView keyboardDismissMode="on-drag">

// Chat screens — interactive dismiss (keyboard follows finger)
<FlatList keyboardDismissMode="interactive" />
```

## Why

Users expect the keyboard to dismiss when scrolling. Without this, they must tap outside the input to dismiss. The `interactive` mode lets users pull the keyboard down with a drag gesture — appropriate when the chat history is long and users want fine control.

## See Also

- [Inline validation errors](inline-validation-errors-2026-05-13.md)
