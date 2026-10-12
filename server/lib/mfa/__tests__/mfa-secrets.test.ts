import { it, expect } from "vitest";
import {
  newChallengeToken,
  hashChallengeToken,
  newTrustKey,
  hashTrustKey,
} from "../mfa-secrets";

it("challenge tokens are 43-char base64url and hash deterministically", () => {
  const t = newChallengeToken();
  expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashChallengeToken(t)).toBe(hashChallengeToken(t));
  expect(hashChallengeToken(t)).toMatch(/^[0-9a-f]{64}$/);
});

it("trust keys are 43-char base64url; hashes are labelled per purpose", () => {
  const k = newTrustKey();
  expect(k).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashTrustKey(k)).toMatch(/^[0-9a-f]{64}$/);
  // Same input, different purpose → different hash (domain separation).
  expect(hashTrustKey(k)).not.toBe(hashChallengeToken(k));
});
