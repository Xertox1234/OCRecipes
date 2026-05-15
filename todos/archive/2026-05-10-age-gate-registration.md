---
title: "Age gate on registration (COPPA 13+)"
status: backlog
priority: high
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [compliance, privacy, auth, deferred]
github_issue:
---

# Age Gate on Registration

## Summary

Add a 13+ age confirmation step to the registration flow to comply with COPPA (US) and equivalent Canadian child privacy laws, which prohibit collecting personal data from children under 13 without verifiable parental consent.

## Background

OCRecipes collects health data (weight, height, allergies, health conditions, activity level) and runs AI coaching. COPPA (Children's Online Privacy Protection Act) requires that apps not directed at children but that may be used by them either: (a) restrict access to 13+ users, or (b) obtain verifiable parental consent before collecting any personal information from under-13 users. Option (a) — an age gate with a ToS acknowledgment — is the standard approach for nutrition/health apps. Without it, the app is exposed to FTC enforcement and App Store rejection. Apple's App Store guidelines (section 1.3) require child-safety compliance for apps that collect personal data.

## Acceptance Criteria

- [ ] Registration screen includes a checkbox or confirmation: "I confirm I am 13 years of age or older"
- [ ] The checkbox is unchecked by default and must be checked to enable the "Create Account" button
- [ ] Server-side: register route Zod schema includes `ageConfirmed: z.literal(true)` — registration fails with 400 if not present
- [ ] The `ageConfirmed: true` field is validated at the route level; it does not need to be persisted to the DB (it is a legal attestation at the time of registration, not ongoing state)
- [ ] Terms of Service text near the checkbox links to ToS URL: "By continuing, you agree to our Terms of Service and Privacy Policy" with tappable links
- [ ] Unit test: register request without `ageConfirmed: true` → 400

## Implementation Notes

- Server route: `server/routes/auth.ts` — add `ageConfirmed: z.literal(true)` to the register Zod schema
- Client: `client/screens/RegisterScreen.tsx` (or equivalent) — add checkbox above the submit button
- The checkbox should use a `TouchableOpacity` or accessible pressable; ensure `accessibilityRole="checkbox"` and `accessibilityState={{ checked }}`
- ToS and Privacy Policy URLs: hardcode as `https://ocrecipes.app/terms` and `https://ocrecipes.app/privacy` (or use `EXPO_PUBLIC_*` env vars)
- A date-of-birth picker is NOT required for the 13+ attestation model — a checkbox attestation is legally sufficient for most COPPA-compliant implementations
- Eligible for Copilot delegation (simple schema + UI change, no auth logic modification)

## Dependencies

- Privacy Policy and Terms of Service pages must exist at the linked URLs before shipping
- `server/routes/auth.ts` — register route Zod schema

## Risks

- Age attestation via checkbox is a "best effort" compliance approach. If the app is ever targeted at children (under-13 features, school integrations, etc.), full COPPA compliance with verifiable parental consent would be required instead
- Existing users are unaffected — this only applies to new registrations

## Updates

### 2026-05-10

- Created from compliance review (North America launch planning)
