---
title: Text-to-Speech (TTS) hook with sentence streaming and cleanup
track: knowledge
category: design-patterns
module: client
tags: [react-native, expo-speech, tts, hooks, cleanup, accessibility]
applies_to: [client/hooks/useTTS.ts, client/components/**/*.tsx]
created: '2026-05-13'
---

# Text-to-Speech (TTS) hook with sentence streaming and cleanup

## When this applies

Use `expo-speech` for on-device TTS. Always split prose into sentences before speaking, strip markdown/block fences, and stop the engine on unmount.

## Examples

```typescript
import { useState, useCallback, useRef, useEffect } from "react";
import * as Speech from "expo-speech";

// Split on sentence-ending punctuation followed by whitespace
export function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map((s) => s.trim()).filter(Boolean);
}

export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const sentenceQueueRef = useRef<string[]>([]);
  const activeRef = useRef(false);

  const stop = useCallback(() => {
    activeRef.current = false;
    sentenceQueueRef.current = [];
    Speech.stop().catch(() => {});
    setIsSpeaking(false);
  }, []);

  // CRITICAL: stop the native engine when the component unmounts.
  // expo-speech keeps speaking after unmount without this cleanup.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      sentenceQueueRef.current = [];
      Speech.stop().catch(() => {});
    };
  }, []);

  const speakNextSentence = useCallback(() => {
    if (!activeRef.current || sentenceQueueRef.current.length === 0) {
      setIsSpeaking(false);
      return;
    }
    const sentence = sentenceQueueRef.current.shift()!;
    Speech.speak(sentence, {
      language: "en-US",
      onDone: () => {
        if (activeRef.current) speakNextSentence();
      },
      onStopped: () => {
        activeRef.current = false;
        setIsSpeaking(false);
      },
      onError: () => {
        activeRef.current = false;
        setIsSpeaking(false);
      },
    });
  }, []);

  const speak = useCallback(
    (text: string) => {
      // Strip markdown + coach_blocks before splitting
      const cleaned = stripMarkdown(stripCoachBlocks(text));
      const sentences = splitSentences(cleaned);
      if (sentences.length === 0) return;
      if (activeRef.current) Speech.stop().catch(() => {});
      sentenceQueueRef.current = sentences;
      activeRef.current = true;
      setIsSpeaking(true);
      speakNextSentence();
    },
    [stop, speakNextSentence],
  );

  return { isSpeaking, speak, stop };
}
```

## Why

**Key rules:**

1. **Order: bold before italic** in `stripMarkdown` — `\*\*bold\*\*` must be stripped before `\*italic\*` or the italic regex consumes one asterisk from a bold span.
2. **Strip `coach_blocks` fences** before speaking so JSON block content is never read aloud.
3. **`activeRef` not state** for the active flag — state reads inside `onDone` callbacks see stale values; refs don't.
4. **Toggle pattern** — call `speak(id, text)` again on the same message to stop; compare `currentMessageIdRef.current === messageId`.
5. **Stop on new send** — call `ttsStop()` at the top of `handleSend` to prevent audio collision when the user sends a new message.

## Exceptions

When to use: Any feature that reads AI-generated or structured text aloud (coach responses, recipe instructions, notifications).

When NOT to use: Real-time streaming text — wait for the full utterance to arrive before speaking.

**Accessibility:** The speaker `Pressable` button should use `accessibilityRole="button"` and a dynamic `accessibilityLabel` (`"Read aloud"` / `"Stop reading aloud"`). `expo-speech` respects system silent/vibrate mode on both iOS and Android automatically.

## Related Files

- `client/hooks/useTTS.ts`
- `client/components/ChatBubble.tsx` (speaker button)
- `client/components/coach/CoachChat.tsx` (integration)

## See Also

- [Use useRef for synchronous checks in callbacks](../conventions/useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
