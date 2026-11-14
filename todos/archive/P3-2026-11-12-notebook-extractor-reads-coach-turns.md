---
title: "Notebook extractor reads coach turns as well as user turns — decide whether model text may become a stored note"
status: done
priority: low
created: 2026-11-12
updated: 2026-11-14
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

- [x] Read `server/services/notebook-extraction.ts:150-165` and state which roles reach the
      extractor prompt.
- [ ] A test shows whether an instruction-like sentence in a coach turn can become a stored entry.
- [x] If it can: either pass user turns only, or mark coach turns as context that must not be
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

### 2026-11-14

- Roles: user and coach turns both reach the extractor, as a JSON array of `{speaker, text}`;
  system turns are filtered out. The prompt had no rule limiting entries to user turns.
- Owner decision (2026-11-14): keep coach turns as context, forbid extracting from them.
- Done: two prompt rules plus tests for the wording and for coach turns still being sent.
- Second criterion NOT met as written: no test ran against a real model, so whether an
  instruction-like coach sentence became a stored entry before, or still can, is unmeasured. The
  mocked tests prove what is sent, not what the model does. The rule narrows the loop; it does
  not close it.
