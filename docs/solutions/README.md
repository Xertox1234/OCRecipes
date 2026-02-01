# Solutions Documentation

This directory contains documented solutions to problems encountered during development. Each solution captures the problem, root cause, fix, and prevention strategies so the team can quickly resolve similar issues in the future.

## Categories

### [logic-errors/](./logic-errors/)

Issues where code runs but produces incorrect behavior.

- **[stale-closure-callback-refs.md](./logic-errors/stale-closure-callback-refs.md)** - Using refs instead of state for synchronous checks in callbacks
- **[useeffect-cleanup-memory-leak.md](./logic-errors/useeffect-cleanup-memory-leak.md)** - Cleaning up timers and subscriptions on unmount

### [runtime-errors/](./runtime-errors/)

Issues that cause crashes or exceptions at runtime.

- **[unsafe-type-cast-zod-validation.md](./runtime-errors/unsafe-type-cast-zod-validation.md)** - Validating external data with Zod instead of `as` casts

### [code-quality/](./code-quality/)

Issues that affect maintainability, DX, or type safety.

- **[react-native-style-typing.md](./code-quality/react-native-style-typing.md)** - Using proper React Native style types

## Finding Solutions

### By Symptom

| Symptom                                             | Solution                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Duplicate callbacks firing                          | [stale-closure-callback-refs.md](./logic-errors/stale-closure-callback-refs.md)           |
| "Can't perform state update on unmounted component" | [useeffect-cleanup-memory-leak.md](./logic-errors/useeffect-cleanup-memory-leak.md)       |
| Runtime type errors from database                   | [unsafe-type-cast-zod-validation.md](./runtime-errors/unsafe-type-cast-zod-validation.md) |
| No style autocomplete                               | [react-native-style-typing.md](./code-quality/react-native-style-typing.md)               |

### By Tag

- **react**: stale-closure-callback-refs, useeffect-cleanup-memory-leak
- **hooks**: stale-closure-callback-refs, useeffect-cleanup-memory-leak
- **typescript**: unsafe-type-cast-zod-validation, react-native-style-typing
- **zod**: unsafe-type-cast-zod-validation

## YAML Frontmatter Schema

Each solution file uses YAML frontmatter for searchability:

```yaml
---
title: "Human-readable title"
category: logic-errors | runtime-errors | code-quality | performance-issues | ...
tags: [tag1, tag2, tag3]
module: camera | server | client | shared
symptoms:
  - "Symptom 1"
  - "Symptom 2"
created: YYYY-MM-DD
severity: low | medium | high | critical
---
```

## Contributing

When documenting a new solution:

1. Choose the appropriate category directory
2. Use the filename format: `brief-description-of-problem.md`
3. Include YAML frontmatter with tags and symptoms
4. Document: Problem, Symptoms, Root Cause, Solution, Prevention
5. Link to related files and external resources
6. Update this README with the new solution

## Related Documentation

- [PATTERNS.md](../PATTERNS.md) - Established patterns to follow
- [LEARNINGS.md](../LEARNINGS.md) - Lessons learned from the codebase
