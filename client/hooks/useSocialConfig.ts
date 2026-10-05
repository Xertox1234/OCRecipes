import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export interface SocialConfig {
  google: boolean;
  apple: boolean;
}

const OFF: SocialConfig = { google: false, apple: false };

/**
 * Which Google/Apple sign-in providers the server has configured. Both off
 * while loading or on any error, so the buttons simply don't appear.
 */
export function useSocialConfig(): SocialConfig {
  const { data } = useQuery<SocialConfig>({
    queryKey: ["/api/auth/social/config"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/social/config");
      return (await res.json()) as SocialConfig;
    },
    staleTime: 5 * 60_000,
  });
  return data ?? OFF;
}
