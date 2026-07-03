---
title: 'Documenting Deferred Security Work: Risk-Based Decisions'
track: knowledge
category: best-practices
module: server
tags: [security, decision-making, todo, deferral, receipt-validation, jws]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Documenting Deferred Security Work: Risk-Based Decisions

## When this applies

A security measure is complex to implement, has reasonable compensating
controls, and blocking the feature on it is worse than shipping with a
documented gap. The canonical example: Apple App Store JWS signature
verification against the Apple Root CA — G3 certificate chain.

## Why

A bare `// TODO: verify signature` will be forgotten. The decision to defer is
legitimate only if the next developer can:

1. Find the deferred work without re-discovering it.
2. Understand the precise gap (what's missing, not just "security").
3. See the compensating controls that make the deferral acceptable today.
4. Implement the fix without re-researching the problem from scratch.

Without those four properties, "deferred" is indistinguishable from
"forgotten."

## Examples

### Context: Apple receipt validation

The Apple receipt validation decodes JWS (JSON Web Signature) payloads from
App Store Server API v2. Full security requires verifying the JWS signature
against Apple's root certificate chain (Apple Root CA — G3), which involves
x5c certificate chain validation.

### Decision rationale

The team deferred cryptographic signature verification with a documented
SECURITY TODO rather than blocking the feature or shipping a partial solution:

1. **Complexity.** Apple JWS verification requires downloading Apple's root
   certificate, parsing the x5c header, building the certificate chain, and
   verifying each step. Non-trivial cryptographic work.
2. **Compensating control.** Server-side transaction lookups via the App Store
   Server API provide an alternative verification path for high-value
   purchases.
3. **Risk assessment.** Forging a valid-looking JWS payload requires knowledge
   of the expected schema and bundle ID. The attack surface is limited.
4. **Pragmatism.** Shipping real receipt validation for Google plus basic
   Apple validation was better than blocking the whole feature.

### What a deferral TODO must include

```typescript
// SECURITY TODO: Verify the JWS signature against Apple Root CA - G3
//
// Missing: x5c chain validation against Apple's root certificate.
// Why it matters: Without this, a crafted JWS payload with valid schema and
//   bundle ID could be accepted as a legitimate receipt.
// Current mitigation: Server-side transaction lookups via App Store Server
//   API are used for high-value purchase verification (see
//   `verifyTransactionWithApple()` below).
// Implementation reference:
//   https://developer.apple.com/documentation/appstoreserverapi/...
```

The four required fields:

- **Missing** — the exact technical gap.
- **Why it matters** — the threat the gap leaves open.
- **Current mitigation** — what's protecting users today.
- **Implementation reference** — the doc the next developer needs.

## Exceptions

Do **not** defer security work when:

- The feature itself is the security boundary (auth, signing, key handling).
- No compensating control exists.
- The threat model includes attackers who can craft requests trivially.

In those cases, block the feature until the security work ships.

## Related Files

- `server/services/receipt-validation.ts` — see `decodeAppleJWS` for the
  documented SECURITY TODO.

## See Also

- [stub-service-production-safety-gate](../conventions/stub-service-production-safety-gate-2026-05-13.md) —
  pair deferred security with fail-safe behavior in production.
