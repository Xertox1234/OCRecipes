import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EmailCodeSent,
  SignInMethods,
  TwoStepMethod,
} from "@shared/types/auth";
import { apiRequest } from "@/lib/query-client";

const ME_KEY = ["/api/auth/me"] as const;

interface MeResponse {
  signInMethods?: SignInMethods;
  /** Two-step verification is on (password proofs need the code too). */
  mfaEnabled?: boolean;
  /** How the code arrives; null when two-step is off. */
  mfaMethod?: TwoStepMethod | null;
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
  /** How the code arrives; null when off or still loading. */
  mfaMethod: TwoStepMethod | null;
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
    mfaMethod: data?.mfaEnabled === true ? (data.mfaMethod ?? "totp") : null,
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

/**
 * For a signed-in code field: a code source when the account's two-step is
 * by email, else undefined. Reads the account the screen behind already
 * loaded — never fetches it — so it is safe inside any modal.
 */
export function useSignedInEmailCode(): EmailCodeSource | undefined {
  const { data } = useQuery<MeResponse>({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    enabled: false,
  });
  return data?.mfaEnabled === true && data.mfaMethod === "email"
    ? { send: sendSignedInCode }
    : undefined;
}
