---
title: 'Fix One Protocol Handler, Grep All Consumers'
track: bug
category: logic-errors
module: client
severity: high
tags: [code-review, sse, copy-paste, protocol-parsing, audit]
symptoms: [Two components implement the same wire protocol via copy-paste, Fixing the bug in one leaves an identical bug in the other, '`isStreaming` stuck `true` because server-sent error events are silently dropped']
applies_to: [client/components/CoachChat.tsx, client/components/CoachOverlayContent.tsx]
created: '2026-04-12'
---

# Fix One Protocol Handler, Grep All Consumers

## Problem

`CoachChat.tsx`'s SSE parsing loop silently ignored server-sent error events (`{ error: "Response timeout" }`), leaving `isStreaming` stuck `true`. The fix was applied to `CoachChat.tsx`. Code review caught that `CoachOverlayContent.tsx` had an identical copy-pasted SSE parsing loop with the same vulnerability. The original audit agents searched by file scope and module, not by protocol pattern, and missed the duplicate.

## Symptoms

- After a transient server error, the streaming indicator never clears
- Identical SSE parsing code in 2+ files; only one was patched
- The bug class repeats every time the protocol handler is touched

## Root Cause

Two client components independently implemented the same SSE-over-XHR protocol by copy-pasting the parsing logic rather than sharing a utility. When a bug exists in the protocol handler, every copy carries it. File-scoped audits don't catch protocol-level bugs because the audit checklist runs per-file, not per-pattern.

## Solution

Patch every copy. Then either extract a shared utility (preferred) or, if extraction is not practical because of differing component architectures, add a cross-reference comment so future fixes are applied to both:

```bash
# After fixing SSE error handling in one file, check all SSE consumers:
grep -rn "data.content" --include="*.tsx" --include="*.ts" | grep -i "chunk\|stream\|sse"
```

## Prevention

- When fixing a bug in a parsing or protocol handler, always grep for other instances of the same pattern before declaring the fix complete.
- If 2+ files implement the same protocol, extract a shared utility unless the divergence is intentional.
- If extraction is rejected, add a code comment in each copy pointing at the other: future code review at least sees the relationship.
- Audit by symbol/protocol pattern, not just by file path.

## Related Files

- `client/components/CoachChat.tsx` — fixed SSE error handling
- `client/components/CoachOverlayContent.tsx` — same fix applied via code-review catch

## See Also

- [Parallel filter paths drift](./parallel-filter-paths-drift-2026-05-13.md)
- [SSE abort controller cancel openai stream](../design-patterns/sse-abort-controller-cancel-openai-stream-2026-05-13.md)
