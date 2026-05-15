---
title: "cacheAffectingFields Must Stay in Sync with calculateProfileHash"
track: bug
category: logic-errors
tags:
  [
    cache-invalidation,
    dietary-profile,
    ai-suggestions,
    two-lists-drift,
    data-integrity,
  ]
module: server
applies_to: ["server/routes/profile.ts", "server/utils/profile-hash.ts"]
symptoms:
  - "User updates dietary profile but continues to see stale AI suggestions"
  - "Eager cache invalidation does not fire for some profile field updates"
  - "Two field lists exist in different files and have drifted out of sync"
created: 2026-04-09
severity: high
---

# cacheAffectingFields Must Stay in Sync with calculateProfileHash

## Problem

When a user updated `foodDislikes` or `cuisinePreferences` in the dietary profile, the suggestion cache was not eagerly invalidated. The user kept seeing stale AI-generated suggestions that did not reflect their new preferences until the cache TTL expired (30 days).

## Symptoms

- Profile UI confirms save, but recommended suggestions ignore the change
- Other profile fields invalidate correctly; only `foodDislikes` / `cuisinePreferences` are stale
- Cache hash and cache-invalidation triggers disagree on which fields matter

## Root Cause

Two separate lists define "which profile fields affect AI suggestions":

1. `cacheAffectingFields` in `server/routes/profile.ts` — used at write time to decide whether to invalidate the suggestion cache when the profile is updated.
2. The field list inside `calculateProfileHash()` in `server/utils/profile-hash.ts` — used at read time to generate a hash key for cache lookups.

When `foodDislikes` and `cuisinePreferences` were added to `calculateProfileHash()` so that new cache entries would be keyed correctly, `cacheAffectingFields` was not updated to match. Profile updates that only changed dislikes or cuisine preferences did not trigger eager invalidation, and the old cache key kept being hit by reads (which now used the new hash function only for new entries).

## Solution

Added `foodDislikes` and `cuisinePreferences` to `cacheAffectingFields`. Both lists now contain the same 6 fields: `allergies`, `dietType`, `cookingSkillLevel`, `cookingTimeAvailable`, `foodDislikes`, `cuisinePreferences`.

## Prevention

When two lists must stay in sync, choose one:

1. **Extract a single source of truth** — define the field list once and import it in both places. Preferred.
2. **Add a test** — assert that `cacheAffectingFields` contains exactly the fields used in `calculateProfileHash()`.

In this project, option 1 was deferred because `cacheAffectingFields` is checked against request-body keys (strings), while `calculateProfileHash` accesses `profile?.fieldName` (typed object access). A shared constant would need to bridge both usages. The drift-detection test is the pragmatic minimum.

## Related Files

- `server/routes/profile.ts:13-20` — `cacheAffectingFields` array
- `server/utils/profile-hash.ts` — `calculateProfileHash()` field list

## See Also

- [Content hash invalidation pattern](../design-patterns/content-hash-invalidation-pattern-2026-05-13.md)
- [Drift detection test for empirical constants](../design-patterns/drift-detection-test-empirical-constants-2026-05-13.md)
