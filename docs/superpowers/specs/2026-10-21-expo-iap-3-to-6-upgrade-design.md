# expo-iap upgrade, 3.4.8 → 6.1.x

Date: 2026-10-21 · Status: spec-reviewed 2026-10-22 (approve-with-edits);
corrections and the owner's answer folded in and listed in §9.

Companion to `2026-10-21-expo-sdk-54-to-58-upgrade-design.md` (the SDK
spec). The owner ruled on 2026-10-21 that the in-app purchase library gets its
own plan rather than riding along with an SDK step (SDK spec §9 ruling 4).

## 1. Goal

Move `expo-iap` from 3.4.8 to the latest 6.1.x. Keep the purchase, restore and
server-validation behaviour exactly as it is today. This changes the
library underneath; it is not a paywall or pricing change.

Why:

- **SDK compatibility, not a store deadline.** 3.4.8 was built against
  `expo-modules-core ^2.4.0` (the SDK 53–54 era). It uses the legacy Gradle
  `kotlinOptions { jvmTarget }` block and defaults compileSdk to 34. No one
  has reported whether it builds on SDK 55–58. The maintainer develops 6.1.1
  against `expo ^57.0.12` / RN 0.86.2 and validated 5.1.0 on SDK 57.
- **Google Play doesn't force anything yet.** 3.4.8 already ships Play
  Billing Library (PBL) 8.3.0, which is allowed until 2027-08-31 (extension to
  2027-11-01). 6.x moves to PBL 9.1.0, which is allowed until 2028-08-31.
  Source: developer.android.com/google/play/billing/deprecation-faq.

## 2. What changed upstream (3.4.8 → 6.1.1)

expo-iap moved into the OpenIAP monorepo (`hyodotdev/openiap`,
`libraries/expo-iap`). Release notes and migration tables now live in the
OpenIAP docs (openiap.dev/docs/updates/releases and …/migration). The package
CHANGELOG is a stub. Peer dependencies are `expo/react/react-native: "*"` in
every version, so npm checks nothing. Facts below were read from the npm
tarballs and the OpenIAP doc sources on 2026-10-21.

| Major   | Released                    | What breaks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.0     | 2026-04-10                  | Additive JS changes only (`requestReceiptRefreshIOS`, `useIAP().reconnect`). It is a major because of the monorepo move and a new OnsideKit iOS module (config plugin plus an `EXPO_IAP_ONSIDE` Podfile env var). During 4.x the Android side moves from PBL 8.3 to **PBL 9.1** (by 4.7).                                                                                                                                                                                                                                                                                                 |
| **5.0** | 2026-07-30                  | The big cleanup. **Product fields `subscriptionInfoIOS`, `subscriptionOfferDetailsAndroid`, `discountsIOS` and the type `ProductSubscriptionAndroidOfferDetails` are removed**. Use `subscriptionOffers: SubscriptionOffer[]` instead. `Purchase.platform` becomes `Purchase.store` (products keep `platform`). `request.ios`/`request.android` are removed (`apple`/`google` stay). `validateReceipt*` and the Android alternative-billing trio are removed. Error codes `receipt-*` become `purchase-verification-*`. Android build defaults: compile/target SDK 35, minSdk 23, JVM 17. |
| 6.0     | 2026-10-09 (6.1.1 on 10-18) | `storeId` is now required on `Purchase` (this matters for hand-built fixtures). Android forwards the store provider's own error codes; new codes include `duplicate-purchase` and `service-timeout`. Android restore runs the provider's restore first, so restore handling must be idempotent. The redemption APIs merge into `openRedeemOfferCode()`. Android compile/target SDK 36. Apple 4.0 throws `CancellationError` when the calling task is cancelled.                                                                                                                           |

**Unchanged in 6.1.1, all of which we use** (re-checked in the 3.4.8 and 6.1.1
`src/types.ts` on 2026-10-22): `useIAP({ onPurchaseSuccess, onPurchaseError })`
and its `connected`/`subscriptions`/`fetchProducts`/`finishTransaction` members,
`fetchProducts({ skus, type: "subs" })`, `requestPurchase({ type: "subs", request: { apple, google } })`
(including `google.subscriptionOffers: [{ sku, offerToken }]`), `Purchase.purchaseState`
(`'pending' | 'purchased' | 'unknown'`),
`finishTransaction({ purchase, isConsumable })`, `getAvailablePurchases`,
`restorePurchases`, `isEligibleForIntroOfferIOS`, and `Purchase.purchaseToken`.
The 6.1.1 types still document `purchaseToken` as "Unified purchase token (iOS
JWS, Android purchaseToken)", and `transactionId` is still there.

**Already in 3.4.8:** `subscriptionOffers` (on iOS and Android products) and
`subscriptionGroupIdIOS`. The `SubscriptionOffer` shape is the same in 3.4.8
and 6.1.1, except that 6.1.1 adds `installmentPlanDetailsAndroid`. So the
mapping move off the fields that 5.0 removes can happen before the version
bump (§3.1).

## 3. What it touches in this app

All expo-iap use is behind one adapter: `client/lib/iap/expo-iap-adapter.ts`
(runtime) and `client/lib/iap/product-mapping.ts` (type-only imports, pure
functions). Nothing else in `client/` imports `expo-iap`. `purchase-utils.ts`
doesn't import it either, but it holds expo-iap's error-code strings as
literals, so it is part of the contract. `app.json` lists the
plugin as plain `"expo-iap"` with no options, so none of the config-key
renames apply.

| Where                                                         | Today (3.4.8)                                                                                    | After (6.1.x)                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product-mapping.ts` `toIAPProductIOS`                        | Reads `subscriptionInfoIOS.introductoryOffer` (period unit and count, payment mode)              | Finds the offer in `subscriptionOffers` where `type === "introductory"` and `paymentMode === "free-trial"`, and reads `period: { unit, value }` and `periodCount`/`numberOfPeriodsIOS`. Check exactly how one free-trial offer looks against the 6.1.x `types.ts`, and pin that shape in a test fixture before changing code. |
| `product-mapping.ts` `toIAPProductAndroid`                    | Reads `subscriptionOfferDetailsAndroid` (offer token, pricing phases)                            | Reads `subscriptionOffers`, using `offerTokenAndroid`, `pricingPhasesAndroid` and `basePlanIdAndroid`. The rule that picks which offer to use must stay the same.                                                                                                                                                             |
| `expo-iap-adapter.ts` `resolveProduct`                        | Takes `subscriptionGroupId` from `subscriptionInfoIOS` for the intro-offer eligibility call      | Takes it from `subscriptionGroupIdIOS` on the product. Keep the fail-closed rule: if eligibility is unknown, show no free trial.                                                                                                                                                                                              |
| `expo-iap-adapter.ts` `onPurchaseError` / `purchase-utils.ts` | Maps `user-cancelled`, `network-error`, `already-owned`, `pending` and the store-unavailable set | Same codes, plus decide where `duplicate-purchase` (probably next to `already-owned`) and `service-timeout` (probably next to `network-error`) go. Write the test first.                                                                                                                                                      |
| `expo-iap-adapter.ts` `restorePurchases`                      | The unclaimed purchase first, then store restore, then the newest of `getAvailablePurchases`     | Unchanged. It already works if called twice (it only reads).                                                                                                                                                                                                                                                                  |
| `client/lib/iap/__tests__/*` fixtures                         | 3.4.8 shapes                                                                                     | Rebuild them from 6.1.x types, with `storeId` on purchases. The fixtures are the contract, so they change first (TDD).                                                                                                                                                                                                        |
| `server/services/receipt-validation.ts`                       | Validates the iOS JWS (`signedTransactionInfo`) and the Google `subscriptionsv2` token           | **No change expected.** One real sandbox purchase must prove it end to end (§5).                                                                                                                                                                                                                                              |

The app's own `IAPPurchaseResult.platform` field (in `purchase-utils.ts` and
`usePurchase.ts`) is ours, not expo-iap's, and doesn't change. The
`subscription.platform === "android"` check in `resolveProduct` reads a
_product's_ `platform`, which 5.0 keeps.

### 3.1 Reviewer's proposal: two slices instead of one

The two `product-mapping.ts` rows and the `resolveProduct` row above can ship
first, on 3.4.8, as a JavaScript-only PR that reaches the owner's phone over
the air. It would move the reads to `subscriptionOffers`/`subscriptionGroupIdIOS`
and keep the selection rule and the fail-closed eligibility rule, with fixtures
from the shared shape. The 6.1.x PR then holds the version bump, the
`storeId` fixtures and the two new error codes. One thing is **unverified**:
whether 3.4.8's native side fills in `subscriptionOffers` on iOS at runtime.
The types say it does. If it doesn't, the trial text disappears, which is
the safe direction, but that can only be seen on a Release build with
products loading (§5). The implementation plan decides whether to take this
split.

## 4. Where it lands in the SDK sequence

**Plan: its own PR, merged right after SDK step 3 (SDK 57), before step 3's
EAS preview build is cut.** SDK 57 is the combination the maintainer develops
and validates 5.x/6.x against. Landing it there means:

- the owner's ruling of builds after steps 1, 3 and 4 still holds, because
  this rides in step 3's build with no extra build;
- step 3's `runtimeVersion` bump already covers it, since no binary on that
  runtime exists until the build is cut. **If step 3's build has already
  been cut when this merges, the PR bumps `runtimeVersion` again;**
- it has about a week of daily use before SDK 58 (step 4) arrives.

**Fallback:** if 3.4.8 fails to build at SDK step 1 or 2, this upgrade moves
forward to that step, as a separate PR merged before the SDK step's PR. It
then runs on a less-validated combination (6.1.x on SDK 55/56), so the
sandbox checks in §5 matter even more there.

## 5. Checks

The usual CI gate, plus the following.

**App Store Connect gate (owner, 2026-10-22: it should be set up).** The
sandbox checks in item 2 are required. Run them before this PR merges.
Item 2 needs three things: an active Paid Apps agreement, the
`com.ocrecipes.premium.annual` subscription with its 3-day free intro offer,
and a sandbox tester account. As of 2026-10-04 none of them existed, and none
of them can be confirmed from the repo. So the first device check comes
before anything else: on a Release build of the **current** 3.4.8 app, does
the paywall show a real price? If it shows "Price unavailable", App Store
Connect isn't serving the product. Stop and finish the setup (owner task)
before starting this upgrade. That way, a missing product never gets
mistaken for an upgrade bug.

1. **A Release build, not a dev client.** `client/lib/iap/index.ts` swaps in
   `mock-iap` whenever `__DEV__` is true, so `npx expo run:ios` in debug
   never touches expo-iap at all. Every IAP check below runs on a Release
   build (`npx expo run:ios --configuration Release` on the device, or the
   step 3 EAS preview build) with an App Store sandbox account.
2. iOS sandbox, in this order:
   - The paywall shows the annual price and the right free-trial text, for
     an account that is eligible for the intro offer and for one that isn't.
   - A purchase completes. The server validates the JWS, premium unlocks,
     and the transaction is finished (no redelivery on the next launch).
   - Cancelling in the payment sheet shows the cancelled state, with no
     error toast.
   - Restore on a fresh install restores premium.
   - Killing the app between purchase and server confirmation means the
     redelivered purchase is claimed on the next restore (the `unclaimed`
     path).
3. **Android cannot be checked on a device** (the owner has no Android
   device). The Android mapping is covered only by unit tests built from
   6.1.x shapes, plus a successful EAS Android build. An emulator with a
   Google Play system image and a licence-tester account could run a real
   test purchase. That is optional, and only possible once the app is on a
   Play testing track.
4. A `security-auditor` review of the PR. IAP receipt validation is on
   CLAUDE.md's exclusion list for cheap workers, and payment code gets a
   human-level review.

## 6. Risks

| Risk                                                                                                        | Mitigation                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| The intro-offer mapping changes and the paywall shows the wrong trial text, or a trial the store won't give | Test fixtures from real 6.1.x shapes come first. Eligibility stays fail-closed. Sandbox check 2a covers both accounts.                 |
| The iOS `purchaseToken` stops being the JWS                                                                 | Sandbox check 2b goes through the real server. If it fails, read the JWS from whichever field 6.1.x uses and keep the server as it is. |
| The Android offer token is picked from the wrong offer                                                      | Unit tests keep today's selection rule. Not device-verified (§5.3).                                                                    |
| New Android error codes fall through to a generic error                                                     | Map them explicitly, with tests.                                                                                                       |
| expo-iap 6.x on SDK 58 / RN 0.88 is unvalidated upstream                                                    | Step 4 of the SDK spec runs the §5 sandbox checks again. If it breaks, stay on SDK 57 until a fix ships.                               |
| `EXPO_IAP_*` env flags are deprecated in 6.x and removed in 7.0                                             | We set none. Nothing to do now.                                                                                                        |

## 7. Out of scope

- Paywall UI, prices, products, or new store features (billing-issue
  listener, offer-code redemption, Amazon/Horizon stores).
- Server receipt-validation changes, and `@apple/app-store-server-library`
  2 → 3, which is its own todo.

## 8. Sources

- npm tarballs `expo-iap@3.4.8`, `4.0.0`, `5.0.0` and `6.1.1`: `src/types.ts`,
  `build/*.d.ts`, `android/build.gradle`, `openiap-versions.json`.
- OpenIAP docs sources: `packages/docs/src/pages/docs/updates/releases.tsx`
  and `migration.tsx` (raw.githubusercontent.com/hyodotdev/openiap/main).
- The Play Billing deprecation FAQ (developer.android.com).
- openiap.dev and the GitHub release pages couldn't be reached from this
  environment. The sources above are what renders them.

## 9. Spec review, 2026-10-22

Verdict: **approve-with-edits**. The owner said on 2026-10-22 that App Store
Connect should be set up, so the sandbox checks stay required. The design is
unchanged. These are folded in above:

- **The sandbox checks depend on App Store Connect setup (§5).** That setup
  was missing as of 2026-10-04, so the first device check confirms that the
  current 3.4.8 build loads a real price before the upgrade starts.
- **The "unchanged" list was incomplete (§2).** It now covers the hook's
  `connected`/`subscriptions`, the Android offer-token request shape and
  `purchaseState`. All of them were checked in both versions' types.
- **3.4.8 already exposes the replacement fields (§2, §3.1).** That makes a
  JavaScript-first mapping slice possible. It's proposed, and the plan
  decides.
- **`purchase-utils.ts` is part of the contract (§3)** through its error-code
  literals, even though it doesn't import expo-iap.
