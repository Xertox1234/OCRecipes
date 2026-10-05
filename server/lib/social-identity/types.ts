import type { ProviderName } from "../../storage/identities";
export type { ProviderName };
export type SignInMethod = "password" | "google" | "apple";
export interface ProviderClaims {
  provider: ProviderName;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  hostedDomain: string | null;
  isPrivateRelay: boolean;
  nonce: string | null;
}
