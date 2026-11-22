# expo-iap 3.4.8 → 6.x Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `expo-iap` from 3.4.8 to the latest 6.x with purchase, restore, trial display and server validation behaving exactly as today.

**Architecture:** One PR. All expo-iap contact stays behind `client/lib/iap/expo-iap-adapter.ts` (runtime) and `client/lib/iap/product-mapping.ts` (pure, type-only imports); `purchase-utils.ts` holds the error-code literals. The existing tests' names are the behaviour contract: fixtures are rebuilt in 6.x shapes first, then the code changes until the same tests pass.

**Tech Stack:** expo-iap 6.x (OpenIAP apple/google 4.0.x native libs), StoreKit 2, Play Billing 9.1, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-expo-iap-3-to-6-upgrade-design.md` (§2, §3, §4, §5, §6, §9)

## Global Constraints

- Lands as its own PR right after SDK step 3 (SDK 57) merges and before step 3's EAS build. If 3.4.8 fails to build at SDK step 1 or 2, it moves forward to that step instead.
- Use the **latest 6.x** at the time of work (6.1.1 when written); if it moved, redo Task 1's discovery against that version.
- Behaviour unchanged: same trial-selection rule, eligibility stays **fail-closed** (unknown → no free trial), receipt = `purchase.purchaseToken` (iOS JWS), restore order (unclaimed → store restore → newest of `getAvailablePurchases`).
- No server change (`server/services/receipt-validation.ts`).
- No cheap-worker (kimi) on any of these files — IAP receipt validation is an absolute exclusion.
- `runtimeVersion`: covered by SDK step 3's `4.0.0` if step 3's build has not been cut; if it has, bump to `4.1.0` in this PR.
- Review: `security-auditor` + `code-reviewer` (spec §5.4).

## Review Focus

1. Store returns an iOS product whose free-trial offer has `periodCount` unset but `numberOfPeriodsIOS` set (or the reverse) → the trial length is still `period.value × count`, never 0 or NaN. Test in Task 3.
2. iOS product with an intro offer but no `subscriptionGroupIdIOS` → no eligibility call, no trial shown. Test in Task 4.
3. Android product listing only offers (no base plan) or only a base plan → selection rule picks the same offer it does today; offer token comes from that offer. Tests in Task 3 (existing names).
4. Android restore runs twice (6.x runs the provider restore first) → second call returns the same result, no error. Test in Task 4.
5. Android `duplicate-purchase` / `service-timeout` → user sees the "already own" / network message, not a generic error. Test in Task 5.

---

### Task 0: Gate — App Store Connect serves the product (owner, device)

- [ ] **Step 1 (owner):** On a Release build of the **current** 3.4.8 app (`npx expo run:ios --device --configuration Release`), open the paywall with a sandbox tester signed in.
- [ ] **Step 2:** Expected: a real annual price and the 3-day free trial text. If it shows "Price unavailable", stop: App Store Connect setup (Paid Apps agreement, `com.ocrecipes.premium.annual` + 3-day intro offer, sandbox tester) is unfinished — an owner task, not this plan.

### Task 1: Discovery — what 6.x changes in our files

**Files:** none committed (throwaway worktree).

- [ ] **Step 1:** In a throwaway worktree: `npm install expo-iap@^6` then `npx tsc --noEmit 2>&1 | grep "client/lib/iap"`. Save the output to the scratchpad. Expected: errors on `subscriptionInfoIOS`, `subscriptionOfferDetailsAndroid`, `ProductSubscriptionAndroidOfferDetails`, and `storeId` in test fixtures — anything else is new and goes in the PR body.
- [ ] **Step 2:** Read how a Google base plan appears in `subscriptionOffers`: the OpenIAP google library at the version in `node_modules/expo-iap/openiap-versions.json` (`google`), its conversion from `ProductDetails.SubscriptionOfferDetails` to `SubscriptionOffer` (github.com/hyodotdev/openiap, `packages/google`). Record: what `id` holds for a base plan with no `offerId`, and whether `basePlanIdAndroid` is set on offers. This decides `isBasePlanOffer` in Task 3.
- [ ] **Step 3:** Same for Apple (`packages/apple`): which of `periodCount` / `numberOfPeriodsIOS` the intro offer fills, and `paymentMode` / `type` values for a free trial.

### Task 2: Capture a real iOS product and purchase (owner at device)

**Files:**

- Create: `client/lib/iap/__tests__/fixtures/expo-iap-6-ios.ts`

- [ ] **Step 1:** In the throwaway worktree with 6.x installed, add a temporary `logger.info(JSON.stringify(subscription))` in `resolveProduct` and `JSON.stringify(purchase)` in `onPurchaseSuccess`; Release build on the device; open the paywall and make one sandbox purchase; read the lines from Console.app. **Do not commit the logging.**
- [ ] **Step 2:** Write the captured product and purchase into the fixture file as typed constants (`ProductSubscriptionIOS`, `PurchaseIOS` from 6.x), with `purchaseToken` and `transactionId` replaced by placeholder strings. These are the shapes Task 3's iOS fixtures copy.

### Task 3: Mapping onto `subscriptionOffers`

**Files:**

- Modify: `client/lib/iap/product-mapping.ts` (`toIAPProductIOS`, `toIAPProductAndroid`, header comments at `:41-47` and `:99-104`)
- Test: `client/lib/iap/__tests__/product-mapping.test.ts`
- Modify: `package.json` / `package-lock.json` (`expo-iap` → `^6.<latest>`)

**Interfaces:**

- Consumes: Task 1's finding on base plans; Task 2's fixture shapes.
- Produces (unchanged signatures): `toIAPProductIOS(product: ProductSubscriptionIOS, eligibleForIntroOffer: boolean): IAPProduct`; `toIAPProductAndroid(product: ProductSubscriptionAndroid): IAPProduct | null`. New private helpers: `freeTrialOfferIOS(product: ProductSubscriptionIOS): SubscriptionOffer | null` (exported for `resolveProduct`), `isBasePlanOffer(offer: SubscriptionOffer): boolean`.

- [ ] **Step 1:** Bump `expo-iap` in the real worktree.
- [ ] **Step 2: Rebuild the fixtures** in 6.x shapes, keeping every existing test name and assertion:
  - `iosSubscription()` drops `subscriptionInfoIOS`, adds `subscriptionPeriodUnitIOS: "year"`, `subscriptionPeriodNumberIOS: "1"`, `subscriptionGroupIdIOS: "group-1"`, `subscriptionOffers: []`.
  - `THREE_DAY_TRIAL_IOS` is replaced by `THREE_DAY_TRIAL_OFFER`, a `SubscriptionOffer` with `type: "introductory"`, `paymentMode: "free-trial"`, `period: { unit: "day", value: 3 }`, and the count field Task 1 step 3 found.
  - `androidOffer(phases, offerId, token)` builds a `SubscriptionOffer` with `offerTokenAndroid: token`, `pricingPhasesAndroid`, `basePlanIdAndroid`, and `id` per Task 1 step 2.
  - Purchase fixtures add `storeId`.
- [ ] **Step 3: Add the two Review-Focus tests**

```ts
it("reads the trial count from numberOfPeriodsIOS when periodCount is missing", () => {
  const offer = {
    ...THREE_DAY_TRIAL_OFFER,
    periodCount: null,
    numberOfPeriodsIOS: 2,
  };
  const product = toIAPProductIOS(
    iosSubscription({ subscriptionOffers: [offer] }),
    true,
  );
  expect(product.introOffer).toEqual({
    kind: "free-trial",
    length: { count: 6, unit: "day" },
  });
});

it("shows no trial when the offer has no usable count", () => {
  const offer = {
    ...THREE_DAY_TRIAL_OFFER,
    periodCount: null,
    numberOfPeriodsIOS: null,
  };
  const product = toIAPProductIOS(
    iosSubscription({ subscriptionOffers: [offer] }),
    true,
  );
  expect(product.introOffer).toBeNull();
});
```

- [ ] **Step 4:** `npx vitest run client/lib/iap/__tests__/product-mapping.test.ts` → FAIL (type and value errors).
- [ ] **Step 5: Implement.** iOS: period from the flat `subscriptionPeriodUnitIOS`/`NumberIOS` fields only; trial = the first offer with `type === "introductory"` and `paymentMode === "free-trial"`, length `period.value × (periodCount ?? numberOfPeriodsIOS)`, both > 0, only when `eligibleForIntroOffer`. Android: same rule as today on `subscriptionOffers` — two phases with a free first phase wins, else `isBasePlanOffer`, else the first; price/period from the last phase of `pricingPhasesAndroid.pricingPhaseList`; token = `offerTokenAndroid ?? null` (a null token is fine: the adapter already buys by `skus` alone when `androidOfferToken` is null); return `null` only when the list is empty or the chosen offer has no recurring phase.
- [ ] **Step 6:** `npx vitest run client/lib/iap/__tests__/product-mapping.test.ts` → PASS (all old names + 2 new).
- [ ] **Step 7:** Commit — "expo-iap 6: map products from subscriptionOffers".

### Task 4: `resolveProduct` and restore

**Files:**

- Modify: `client/lib/iap/expo-iap-adapter.ts:51-66` (`resolveProduct`)
- Test: `client/lib/iap/__tests__/expo-iap-adapter.test.ts`

**Interfaces:**

- Consumes: `freeTrialOfferIOS` from Task 3.

- [ ] **Step 1: Write the failing tests**
  - "skips the eligibility call and shows no trial when the product has no group id": product with a trial offer and `subscriptionGroupIdIOS: null` → `isEligibleForIntroOfferIOS` not called; `products[0].introOffer` is `null`.
  - "asks eligibility with the product's subscriptionGroupIdIOS": called with `"group-1"`.
  - "restoring twice returns the same purchase": two `restorePurchases()` calls with the same `getAvailablePurchases` mock → equal results, no throw.
  - Update existing fixtures to 6.x shapes (with `storeId`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `resolveProduct`: eligibility only when `freeTrialOfferIOS(subscription)` is non-null **and** `subscriptionGroupIdIOS` is a non-empty string; keep the try/catch → `false`.
- [ ] **Step 4:** Run `npx vitest run client/lib/iap` → PASS.
- [ ] **Step 5:** Commit — "expo-iap 6: eligibility from subscriptionGroupIdIOS".

### Task 5: New Android error codes

**Files:**

- Modify: `client/lib/iap/purchase-utils.ts:45-75`
- Test: `client/lib/iap/__tests__/purchase-utils.test.ts`

- [ ] **Step 1: Write the failing tests:** `{ code: "duplicate-purchase" }` maps to the same `PurchaseError` as `already-owned` (message "You already own this subscription."); `{ code: "service-timeout" }` maps to the same as `network-error`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add both codes beside their twins.
- [ ] **Step 4:** Run `npx vitest run client/lib/iap` → PASS. `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5:** Commit — "expo-iap 6: map duplicate-purchase and service-timeout".

### Task 6: Review, device checks, merge

- [ ] **Step 1:** PR via MCP; reviewers `security-auditor` + `code-reviewer` (one pass). Body: Task 1's `tsc` diff, Task 1's base-plan finding with its source link, `npm audit --omit=dev` counts.
- [ ] **Step 2 (owner, Release build, sandbox tester)** — spec §5.2 in order: paywall price + trial text for an eligible and an ineligible account · purchase → server validates the JWS, premium unlocks, no redelivery on next launch · cancel in the payment sheet → cancelled state, no error toast · restore on a fresh install → premium · kill the app between purchase and server confirmation → claimed on the next restore.
- [ ] **Step 3:** EAS Android build (part of SDK step 3's build) succeeds; Android behaviour rests on the unit tests (spec §5.3).
- [ ] **Step 4:** Merge, then return to SDK runbook Task 3 Step 7.
