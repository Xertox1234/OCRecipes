# OCRecipes Roadmap

Last updated: 2026-03-20

## Shipped

### Smart Scan (Phase 1) — PR #14

Auto-classification replaces manual intent selection. Users take a photo, Vision API classifies what it is (meal, label, menu, receipt, barcode), and auto-routes to the correct screen. PhotoIntentScreen kept as fallback for low-confidence results.

### Verified Product Data Collection (Phase 2a) — PRs #15-20

Barcode verification pipeline. Users scan barcodes then verify nutrition by scanning labels. 3 independent matching verifications (5% tolerance on calories/protein/carbs/fat) mark a product as "verified." Community-shared data stored permanently in `barcodeVerifications` + `verificationHistory` tables.

Includes:

- Verification comparison service with consensus model
- `POST /api/verification/submit` + `GET /api/verification/:barcode` endpoints
- VerificationBadge component on NutritionDetailScreen
- LabelAnalysisScreen verification mode
- ProfileScreen: real verification count, streak tracking, badge tiers (Newcomer → Platinum)
- Security: cache poisoning prevention, magic-byte validation, label session caps

### Security Fixes — PR #14

- Cache poisoning: `cacheNutritionIfAbsent` prevents overwriting existing entries
- Magic-byte validation on all photo upload endpoints
- Label session store bounded capacity (per-user + global caps)

---

## Next Up

### 1. Front-of-Package Label Scanning

**Priority:** High — enriches verified product data, making the API more valuable
**Effort:** Medium (new service + schema + screen)
**Status:** Not yet planned

**What it does:**

- User scans the front of a product package
- Vision API extracts: brand name, net weight/volume, dietary claims (organic, gluten-free), allergen statements, storage notes
- Data stored alongside barcode verification data
- Enriches the verified product record beyond just nutrition numbers

**Why before the API:**
API customers will pay more for rich product profiles (brand, allergens, claims) than just verified macros. Building front-label scanning now means the data is already flowing when the API launches.

**Open questions:**

- Should front-label data count toward the 3-verification consensus?
- Store photos for API consumers to access?
- Extract ingredient lists (for allergen cross-referencing)?

**Brainstorm reference:** `docs/brainstorms/2026-03-19-verified-product-api-brainstorm.md`

---

### 2. Public Verified Product API (Phase 2b)

**Priority:** High — the revenue product
**Effort:** Large (new auth system, tiered responses, rate limiting, docs)
**Status:** Not yet planned — waiting for data volume

**What it does:**

- External developers query verified product data by barcode
- API key authentication (separate from JWT user auth)
- Tiered responses:
  - **Free:** Basic verified nutrition (calories, protein, carbs, fat, serving size)
  - **Paid:** Full profile (brand, net weight, allergens, claims, verification metadata, confidence score, verification count, last verified date)
- Rate limiting per API key
- Developer portal with docs

**Prerequisites:**

- Meaningful data volume (target: 1,000+ verified products before soft launch?)
- Front-of-package scanning (for rich "paid tier" data)

**Open questions:**

- Pricing model (per-request, monthly subscription, usage tiers)?
- Expose unverified (database-sourced) data or only verified?
- Regional product variants (same barcode, different formulation)?
- GDPR: anonymize userIds in verification data exposed via API?
- Minimum data volume threshold for launch?

**Brainstorm reference:** `docs/brainstorms/2026-03-19-verified-product-api-brainstorm.md`

---

## Backlog

These are lower-priority items that can be tackled when relevant:

| Feature                                     | Notes                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Restaurant receipt → food logging (Phase 3) | Receipt type bifurcation in auto-classification. Deferred from Smart Scan plan. |
| Server-side barcode detection (zxing-wasm)  | Only needed if Vision API barcode hints prove unreliable in production          |
| Verification photo storage                  | Store label/front-label photos for API consumers. Needs object storage (S3/R2). |
| Verification streak rewards                 | Beyond display — actual premium feature unlocks for high verifiers?             |
| Product reformulation detection             | Reset verified status when new scans consistently disagree with consensus       |

---

## How to Use This Doc

When starting a new session:

1. Check this roadmap for what's next
2. Run `/workflows:brainstorm` on the next item if it hasn't been brainstormed
3. Run `/workflows:plan` to create an implementation plan
4. Run `/workflows:work` to implement

Always review PRs before merging.
