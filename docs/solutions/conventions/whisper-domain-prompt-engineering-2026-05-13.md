---
title: Always set a domain prompt on Whisper transcription calls
track: knowledge
category: conventions
module: server
tags: [whisper, openai, transcription, voice, prompt-engineering, ai]
applies_to: [server/services/voice-transcription.ts]
created: '2026-02-24'
---

# Always set a domain prompt on Whisper transcription calls

## Rule

When calling `openai.audio.transcriptions.create`, pass a one-sentence `prompt` describing the topical domain. The prompt biases Whisper's language model toward in-domain vocabulary and dramatically reduces misrecognition of domain-specific terms.

## Examples

```typescript
const transcription = await openai.audio.transcriptions.create({
  file,
  model: "whisper-1",
  language: "en",
  prompt: "Food and nutrition logging. The user is describing what they ate.",
});
```

Effects observed for the food-logging domain:

- "quinoa" transcribed correctly instead of "keenwa"
- "acai" recognized as a food item rather than a phonetic guess
- Measurement words ("tablespoon," "ounces," "grams") preferred over phonetically similar non-food words
- Compound food words ("peanut butter," "greek yogurt") kept together

## Why

Whisper's `prompt` parameter shifts the language-model priors toward vocabulary that matches the prompt. A single sentence describing the domain is enough — the prompt does **not** need to be long, and must not contain the expected transcript itself (that biases the output unfairly).

## Exceptions

- Multi-domain audio (e.g., free-form chat) should use a more general prompt or omit it.
- For non-English transcription, write the prompt in the target language.

## Related Files

- `server/services/voice-transcription.ts`

## See Also

- [OpenAI Whisper prompting guide](https://platform.openai.com/docs/guides/speech-to-text/prompting)
