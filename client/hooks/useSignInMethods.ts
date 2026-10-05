import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SignInMethods } from "@shared/types/auth";
import { apiRequest } from "@/lib/query-client";

const ME_KEY = ["/api/auth/me"] as const;

interface MeResponse {
  signInMethods?: SignInMethods;
}

/**
 * The signed-in account's sign-in methods (password / Google / Apple), from
 * /api/auth/me. `methods` is undefined while loading. Connect and disconnect
 * return the new methods, so callers hand them to `setMethods` instead of
 * refetching. (Not persisted: /api/auth/me is not in PERSISTED_QUERY_KEYS.)
 */
export function useSignInMethods(): {
  methods: SignInMethods | undefined;
  setMethods: (methods: SignInMethods) => void;
} {
  const queryClient = useQueryClient();
  const { data } = useQuery<MeResponse>({
    queryKey: ME_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/me");
      return (await res.json()) as MeResponse;
    },
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
  return { methods: data?.signInMethods, setMethods };
}
