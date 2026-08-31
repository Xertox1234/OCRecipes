import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";

interface MicronutrientData {
  nutrientName: string;
  amount: number;
  unit: string;
  percentDailyValue: number;
}

interface ItemMicronutrients {
  itemId: number;
  productName: string;
  micronutrients: MicronutrientData[];
}

interface DailyMicronutrients {
  date: string;
  micronutrients: MicronutrientData[];
}

export function useItemMicronutrients(itemId: number | null) {
  return useQuery<ItemMicronutrients>({
    queryKey: [`/api/micronutrients/item/${itemId}`],
    enabled: itemId != null,
  });
}

export function useDailyMicronutrients(date?: string) {
  // Day-bucket in the device timezone so micros match the macro endpoints.
  // Omitting the param when no date is given is now a simplification rather
  // than a workaround: the server used to parse a `yyyy-mm-dd` as a UTC-midnight
  // instant and bucket the previous local day for UTC-negative users, so
  // sending "today" was actively worse than sending nothing. That is fixed —
  // the route resolves the calendar date in the request's zone — but omitting
  // the param is still the fewer moving parts, so it stays.
  const tz = getDeviceTimezone();
  const url = date
    ? `/api/micronutrients/daily?date=${date}`
    : "/api/micronutrients/daily";
  return useQuery<DailyMicronutrients>({
    queryKey: [url, { tz }],
    queryFn: async () => {
      const res = await apiRequest("GET", url, undefined, {
        headers: { "X-Timezone": tz },
      });
      return res.json() as Promise<DailyMicronutrients>;
    },
  });
}

export function useMicronutrientReference() {
  return useQuery<Record<string, { unit: string; dailyValue: number }>>({
    queryKey: ["/api/micronutrients/reference"],
    staleTime: 24 * 60 * 60 * 1000, // Cache for 24 hours
  });
}

export type { MicronutrientData, ItemMicronutrients, DailyMicronutrients };
