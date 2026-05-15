---
title: "Coach: Voice output (text-to-speech for responses)"
status: done
priority: low
created: 2026-04-29
updated: 2026-04-29
assignee:
labels: [coach, voice, accessibility]
---

# Coach: Voice output (text-to-speech for responses)

## Summary

Allow the Coach to read responses aloud using text-to-speech, completing the voice loop for users who interact hands-free.

## Background

The Coach already supports voice input via `expo-speech-recognition` (STT). TTS output would complete a fully voice-driven interaction — useful while cooking, exercising, or when the phone is not in hand. Explicitly skipped in the 2026-04-29 coach improvement pass to keep scope focused.

## Acceptance Criteria

- [x] Coach Pro responses can be read aloud via a speaker icon on the assistant bubble
- [x] Streaming TTS begins as soon as the first sentence completes (sentence-boundary detection)
- [x] Playback can be paused/stopped mid-response
- [x] Respects system silent/vibrate mode
- [x] Works on both iOS and Android

## Implementation Notes

- `expo-speech` provides basic on-device TTS (no streaming, limited voice quality)
- For higher quality, consider ElevenLabs or OpenAI TTS API — stream audio chunks alongside text
- Sentence boundary detection: split on `.`, `!`, `?` followed by whitespace; buffer until first sentence completes before starting playback
- Consider auto-play toggle in settings vs manual per-message opt-in
- Blocks (ActionCards, QuickReplies, etc.) should not be read aloud — only the prose content

## Dependencies

- Decision on TTS provider (on-device vs API)
- If API: cost modelling (TTS tokens are separate from chat tokens)

## Risks

- Streaming TTS adds latency complexity
- On-device voices vary in quality across iOS/Android versions
- Users may not want auto-play in public settings

## Updates

### 2026-04-29

- Out of scope for initial coach improvement pass (user chose to skip C3)
