import { useNetworkStatus } from "@/hooks/useNetworkStatus";

export function useOfflineGuard() {
  const { isOffline } = useNetworkStatus();
  const offlineLabel = (label: string) =>
    isOffline ? `${label} (offline — will sync)` : label;
  return { isOffline, offlineLabel };
}
