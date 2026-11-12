---
title: "Notebook extractor reads coach turns as well as user turns — decide whether model text may become a stored note"
status: backlog
priority: low
created: 2026-11-12
updated: 2026-11-12
assignee:
labels: [deferred, security]
github_issue:
---

# Notebook extractor reads coach turns as well as user turns

## Summary

The notebook extractor is given the coach's own replies along with the user's messages. Text the
model wrote (possibly steered by tool results) can then be saved as a notebook entry and fed back
into later prompts. Confirm whether this happens in practice and, if so, limit what coach turns
can contribute.

## Background

Found by the security audit of 2026-11-12 (finding L2, Low). The reviewer was unsure and nothing
was run, so the owner deferred it. The concern is a persistence loop: untrusted text reaches the
model through a tool result, the model repeats it, the extractor stores it as a "fact about the
user", and every later conversation reads it back.

## Acceptance Criteria

- [ ] Read `server/services/notebook-extraction.ts:150-165` and state which roles reach the
      extractor prompt.
- [ ] A test shows whether an instruction-like sentence in a coach turn can become a stored entry.
- [ ] If it can: either pass user turns only, or mark coach turns as context that must not be
      extracted from, with a test. If it cannot: close with the evidence.

## Implementation Notes

- Entries are already sanitised on the way into later prompts; this is about what gets stored.
- Notebook entries are user health data: no cheap-worker scripts on this todo.

## Scope Contract

- **Mechanisms to use:** the existing extractor prompt and its message filter.
- **Files in scope:** `server/services/notebook-extraction.ts`, its `__tests__/` file.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Dropping coach turns may lose context the extractor needs to understand a short user reply
  ("yes, that one").

## Updates

### 2026-11-12

- Initial creation (security audit 2026-11-12, finding L2)
