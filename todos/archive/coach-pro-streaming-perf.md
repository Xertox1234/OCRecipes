---
title: "Coach Pro streaming performance — hot path optimization"
status: in-progress
priority: medium
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [performance, coach-pro, audit-2026-04-12]
---

# Coach Pro Streaming Performance

## Summary

Optimize the streaming hot path in CoachChat to reduce JS thread load during SSE streaming. Fixes M4, M5, L6, L8 from the 2026-04-12 audit.

## Background

During Coach Pro streaming, every SSE chunk triggers: (1) a backtracking regex on the growing accumulated string, (2) duplicate `scrollToEnd` calls, (3) full re-render with Zod safeParse on all historical message blocks, and (4) CoachDashboard re-render with unmemorized array filters.

## Acceptance Criteria

- [x] **M4**: Replace `[\s\S]*?` backtracking regex with indexOf-based fence stripping; remove duplicate `scrollToEnd` (keep only the onChunk callback version, remove useEffect dependency on `streamingContent`)
- [x] **M5**: Memoize block validation — validate once during message hydration (e.g., `useMemo` on messages array) instead of on every render tick
- [x] **L6**: Considered switching from XHR to `ReadableStream` — rejected per LEARNINGS ("fetch ReadableStream Fails Inside RN Modal — Use XHR"). CoachChat renders in modal navigation context where ReadableStream is unreliable.
- [x] **L8**: Wrap `CoachDashboard` in `React.memo`; memoize notebook filter/slice with `useMemo`

## Implementation Notes

- For the regex, a simple approach: find `\`\`\`coach_blocks\n` index, find matching closing fence, and slice it out.
- The `streamingContent` dependency on the scrollToEnd useEffect is the root cause of the duplicate scroll — removing it still allows scrolling on new messages.

## Updates

### 2026-04-12

- Created from audit findings M4, M5, L6, L8
