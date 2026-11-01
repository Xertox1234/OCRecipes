#!/usr/bin/env bash
# Seed the E2E test account both e2e-regression.yml jobs need (identical
# logic, previously duplicated verbatim in the iOS and Android jobs — see
# todos/archive/P3-2026-08-30-e2e-suite-dedup-and-maintainability-followups.md).
#
# helpers/login.yaml's ${USERNAME}/${PASSWORD} need this account to actually
# exist — nothing else in the job creates it. Register's `|| true`-equivalent
# (REG_BODY capture below) only covers an idempotent re-run within the same
# job; each workflow run gets a fresh Postgres instance.
#
# Contract: exit 0 iff the account exists, is logged-in-able, and has
# onboardingCompleted=true. Fail LOUD on both failure modes so a broken seed
# never presents as a mysterious flow failure downstream.
set -uo pipefail

USERNAME="${USERNAME:-testuser}"
PASSWORD="${PASSWORD:-ocr-e2e-maestro-Kq7v2x}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"

# Fail LOUD: this script runs under `set -uo pipefail` (no `-e`), so a
# transport failure on the curl below does NOT abort the script — it falls
# through, TOKEN below resolves empty, and the `[ -z "$TOKEN" ]` check a few
# lines down is what actually catches it and exits 1 with a clear message.
# Register may 409 on an already-seeded rerun — only a failed login is fatal.
REG_BODY=$(curl -s -X POST "$BACKEND_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\",\"email\":\"${USERNAME}@example.com\",\"ageConfirmed\":true}") \
  || REG_BODY="(register curl itself failed)"

# Mark onboarding complete so a session that persists across a Maestro flow's
# app relaunch lands on the known, testable Main app instead of the
# onboarding wizard (flows reach a logged-out state via the UI Sign Out in
# e2e/helpers/ensure-logged-out.yaml — launchApp/clearState is banned in this
# suite, see e2e/README.md). login.yaml's idempotency handles the "already
# authenticated, Sign In never appears" case this produces.
TOKEN=$(curl -s -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  | jq -r '.token // empty')
if [ -z "$TOKEN" ]; then
  echo "::error::Seed login for $USERNAME failed — the suite cannot run without this account. Register response (token stripped):"
  echo "$REG_BODY" | jq -c 'del(.token)' 2>/dev/null || echo "$REG_BODY"
  exit 1
fi

PROF_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BACKEND_URL/api/auth/profile" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"onboardingCompleted":true}')
if [ "$PROF_CODE" != "200" ]; then
  echo "::error::Seed profile update returned HTTP $PROF_CODE — $USERNAME would land in the onboarding wizard"
  exit 1
fi

# PREMIUM=1: also make the account premium. The nightly receipt-upload flow signs in as a
# second account seeded this way (e2epremium; harness diagnosis N6): the receipt scanner is a
# premium feature, and the shared test account must stay free, because premium changes the
# Coach tab's first screen (client/navigation/coachInitialRoute.ts) that other flows assert.
# No expiry = active (shared/types/premium.ts resolveEffectiveTier). Straight to the run's own
# throwaway Postgres: there is no API that grants premium without a store receipt. The row is
# read back so a silent no-op fails here.
TIER_NOTE=""
if [ "${PREMIUM:-}" = "1" ]; then
  TIER=$(psql "${DATABASE_URL:?DATABASE_URL is required to grant premium}" -tAc \
    "UPDATE users SET subscription_tier = 'premium', subscription_expires_at = NULL WHERE username = '$USERNAME' RETURNING subscription_tier;" 2>&1)
  if [ "$(printf '%s' "$TIER" | head -1)" != "premium" ]; then
    echo "::error::Seed premium grant for $USERNAME did not take effect: $TIER"
    exit 1
  fi
  TIER_NOTE=", premium"
fi

echo "seeded $USERNAME (onboardingCompleted=true$TIER_NOTE)"
