import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmailCodeSent, SignInMethods } from "@shared/types/auth";
import { apiRequest } from "@/lib/query-client";

const ME_KEY = ["/api/auth/me"] as const;

interface MeResponse {
  signInMethods?: SignInMethods;
  /** Two-step verification is on (password proofs need the code too). */
  mfaEnabled?: boolean;
}

async function fetchMe(): Promise<MeResponse> {
  const res = await apiRequest("GET", "/api/auth/me");
  return (await res.json()) as MeResponse;
}

/**
 * The signed-in account's sign-in methods (password / Google / Apple), from
 * /api/auth/me. `methods` is undefined while loading. Connect and disconnect
 * return the new methods, so callers hand them to `setMethods` instead of
 * refetching. (Not persisted: /api/auth/me is not in PERSISTED_QUERY_KEYS.)
 */
export function useSignInMethods(): {
  methods: SignInMethods | undefined;
  /** Two-step verification is on; false while loading. */
  mfaEnabled: boolean;
  /** The load failed (after retries); `methods` stays undefined. */
  isError: boolean;
  refetch: () => void;
  setMethods: (methods: SignInMethods) => void;
} {
  const queryClient = useQueryClient();
  const { data, isError, refetch } = useQuery<MeResponse>({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: 0,
  });
  const setMethods = useCallback(
    (methods: SignInMethods) => {
      queryClient.setQueryData<MeResponse>(ME_KEY, (old) => ({
        ...old,
        signInMethods: methods,
      }));
    },
    [queryClient],
  );
  return {
    methods: data?.signInMethods,
    mfaEnabled: data?.mfaEnabled === true,
    isError,
    refetch: () => {
      void refetch();
    },
    setMethods,
  };
}

/** Where a code field gets an emailed code from ("Email me a code"). */
export interface EmailCodeSource {
  send: () => Promise<EmailCodeSent>;
  /** The first code already went out (the sign-in screen): start counting down. */
  alreadySent?: boolean;
}

async function sendSignedInCode(): Promise<EmailCodeSent> {
  const res = await apiRequest("POST", "/api/auth/mfa/email/send");
  return (await res.json()) as EmailCodeSent;
}

const SIGNED_IN_EMAIL_CODE: EmailCodeSource = { send: sendSignedInCode };

/**
 * For a signed-in code field ("Email me a code"). Every two-step account gets
 * its codes by email, and the field shows only once the server asked for one.
 */
export function useSignedInEmailCode(): EmailCodeSource {
  return SIGNED_IN_EMAIL_CODE;
}
