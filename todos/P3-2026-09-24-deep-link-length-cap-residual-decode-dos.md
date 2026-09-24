---
title: "Cap deep-link length before getStateFromPath — decode-uri-component 0.5.0 is still quadratic on distinct malformed runs"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, react-native]
github_issue:
---

# Cap deep-link length before getStateFromPath

## Summary

PR #1054 bumped `decode-uri-component` to 0.5.0 (GHSA-vcc3-ghjq-m6fr), which closes the advisory's repeated-`%C0` shape. But 0.5.0 is still super-linear on many _distinct_ partially-decodable percent runs. A deep link of roughly 100–200 KB can still stall the JS thread for a second or more.

## Background

Found by the security review of #1054 and reproduced independently. In upstream `customDecodeURIComponent`, each distinct malformed run adds one `replaceMap` entry, and then the code runs `input.replace(new RegExp(key,'g'))` over the whole input once per entry. That is O(entries × length).

The measurement used patched `query-string.parse("token=" + v)` under Node v24.20.0 (V8 JIT; Hermes will be slower). Each input is `n` runs shaped `"%C0%" + hex(a) + "%" + hex(b) + "%" + hex(c) + "x"`, with distinct a/b/c. The control is the same length but repeats a single run:

| n     | length  | distinct | control |
| ----- | ------- | -------- | ------- |
| 4000  | 52,000  | 95 ms    | 26 ms   |
| 8000  | 104,000 | 277 ms   | 51 ms   |
| 16000 | 208,000 | 1492 ms  | 100 ms  |

The flaw is upstream and outside #1054's scope. It was deferred as low severity because it needs an unusually large link, only affects the device that opens it, and exposes no data.

## Acceptance Criteria

- [ ] Deep links whose path+query exceed a cap (for example 8 KB) are rejected before `getStateFromPath` decodes them: the app stays on its current screen and does not stall.
- [ ] A test in `client/navigation/__tests__/linking.test.ts` feeds the distinct-run payload (n=16000) through the linking entry point and asserts it returns quickly. It must fail without the cap.
- [ ] Normal deep links (`recipe/:id`, `verify-email?token=…`, `scan?mode=…`) still parse; the existing linking tests stay green.

## Implementation Notes

- Add a `getStateFromPath` to the `linking` config in `client/navigation/linking.ts`. It returns `undefined` when `path.length` exceeds the cap and otherwise delegates to `getStateFromPath` from `@react-navigation/native`.
- Check the size of real links (for example the verify-email token) so the cap cannot reject a legitimate link.
- Optionally report the O(entries × length) replace loop upstream to `SamVerschueren/decode-uri-component`.

## Scope Contract

- **Mechanisms to use:** React Navigation's `linking.getStateFromPath` option — nothing new.
- **Files in scope:** `client/navigation/linking.ts`, `client/navigation/__tests__/linking.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- #1054 merged (the 0.5.0 bump).

## Risks

- A cap set too low would silently drop legitimate long links. Measure the real link sizes first.

## Updates

### 2026-09-24

- Initial creation from the #1054 security review (the residual was reproduced).
