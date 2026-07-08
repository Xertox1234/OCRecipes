---
title: 'Widening an allowlist root turns it into a hand-maintained denylist that fails open — protect it with a narrow drift-detection test, not more enumeration'
track: knowledge
category: best-practices
module: shared
tags: [process, security, allowlist, denylist, fail-open, drift-detection, ci, automerge]
applies_to: ['scripts/*.sh', 'scripts/__tests__/*.test.ts']
created: '2026-07-08'
---

# Widening an allowlist root turns it into a hand-maintained denylist that fails open — protect it with a narrow drift-detection test, not more enumeration

## When this applies

When widening a path-based allowlist (a merge gate, a CI-check-skip rule, any "these directories are safe, everything else needs review" mechanism) from narrow subdirectories to a whole root, and compensating by hand-naming the sensitive files inside that root in a companion denylist/override list.

## Smell patterns

- A comment like "server/services holds the IAP services, so add that file to the override" — i.e., the plan for keeping a widened root safe is "enumerate what's sensitive as you find it."
- A security-relevant file discovered and named in the override list is structurally similar to several other files nobody has looked at yet (a shared hook, a shared client-lib module, a `_`-prefixed shared-infra convention).
- A hunt for one instance of a pattern (e.g. "this file attaches a Bearer token") finds it in isolation, without also grepping the rest of the newly-opened root for the same pattern.
- A test explicitly asserts a file is "confirmed non-sensitive" based on a one-time audit, with no mechanism to re-verify that claim as the codebase grows.

## Why

Widening `path A` from an enumerated subdirectory list to `^A/` changes the failure mode for everything under `A/`: it used to fail closed (not on the list → HOLD), and now it fails open unless a *second* list (the override/denylist) catches it. A denylist can only exclude what someone has already found — it provides no guarantee about what's still undiscovered. This is the exact "denylists fail open" principle that usually rules out denylists at the top level; widening one root and hand-covering it with an override list smuggles the same structural problem back in at a smaller scope, and it doesn't announce itself as a denylist, so reviewers approve it without applying the same scrutiny.

In practice this doesn't fail once — it fails **repeatedly, at increasing scope**, because each hunt only ever looks where someone thought to look. A todo-automerge guard's `server/routes/` widening was covered for its "obviously auth-adjacent" files, then a review found the *actual* security logic (rate limiters, password schemas, upload validation) hiding in shared route infra with innocuous filenames. The root was reverted to HOLD-by-default. The *same session*, a hunt for the identical pattern in the roots that stayed open found two more instances immediately. A follow-up xhigh-effort review, re-running that exact hunt one more time, found eighteen more — including one file a prior test in the same PR had explicitly asserted was "confirmed non-sensitive." Four rounds of "find it, name it, move on" inside a single pull request, each one finding more.

The fix isn't a fifth round of enumeration — it's recognizing that hand-hunting doesn't converge and building a mechanism that re-runs the hunt automatically. A drift-detection test that greps the widened root(s) for the *security signature itself* (not a list of filenames) and asserts every match is covered turns "someone has to remember to look again" into "CI looks every time." The next matching file fails a test instead of silently auto-merging.

## Examples

The signature has to be **narrow enough that a match is always a genuine new chokepoint, never routine business logic** — this is the part that's easy to get wrong in the other direction. Two candidate signatures were tried for the same widened roots:

- **Bearer-token attachment** (`tokenStorage` import + `Authorization`/`Bearer` header construction co-occurring in a file): a mechanical, single-purpose operation. Every match across the whole `client/` and `server/services/` tree was a genuine chokepoint — the signature had zero false positives. Safe to automate as a CI-enforced drift test.
- **Health-PII field references** (`allergies`/`healthConditions` appearing anywhere in a file): far too broad for an app where dietary data is core product logic. The grep matched 10+ legitimate downstream consumers of already-captured profile data (a recipe-personalization screen, an AI coach's context builder, a carousel-recommendation service) — files doing normal feature work, not new security boundaries. Automating this signature would have meant ordinary product code failing a "security" test. Rejected; those specific capture/storage-site files were named individually instead, the same way a one-off finding (a PII-redaction allowlist, an anti-abuse rate limiter) gets named rather than generalized into a signature.

The dividing line: automate a signature when the *operation* it detects is inherently sensitive regardless of context (attaching an auth token, constructing a JWT, redacting a secret). Don't automate a signature built on a *domain noun* that legitimately appears throughout the app's real feature set (a health field, a user-facing "session," a "subscription" that might just be an RN `addEventListener` unsubscribe).

## Exceptions

For a root with no evidence of hidden security logic on genuine inspection (not just "no one has looked yet"), plain hand-naming without an automated drift test is proportionate — building a drift-detection mechanism for every override list is itself a "build a general security detector" overreach. The signal that a root needs the automated backstop is empirical: has hunting for the pattern once already found more than one instance? If a hunt turns up a genuinely isolated one-off, name it and move on; if it turns up a *family* of similarly-shaped files (a shared-infra naming convention, a repeated hook pattern), that's the signal the family will keep growing and the hunt needs to become a standing check.

## Related Files

- `scripts/todo-automerge-guard.sh` — `SAFE_ALLOWLIST`/`SENSITIVE_OVERRIDE`; the `server/routes/` revert and the `client/`/`server/services/` residual-risk model are documented in the script's own header comment
- `scripts/__tests__/todo-automerge-guard.test.ts` — the Bearer-token-attachment drift-detection test (`describe("... drift detection ...")`)
- `docs/todo-automation-runbook.md` — narrates both incidents (the routes revert, then the 18-file follow-up) for a human reader

## See Also

- `docs/LEARNINGS.md:1378` — "Denylists fail open when new columns are added to the schema; allowlists fail closed" — the top-level version of this principle; this lesson is what happens when the principle gets re-violated at a smaller scope inside an allowlist that's already doing the right thing at the top level
