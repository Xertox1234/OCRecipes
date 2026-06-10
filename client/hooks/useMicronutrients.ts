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
  // When no date is given, OMIT the param — the server buckets the
  // now-instant in tz, which is correct in every timezone. Sending a UTC
  // calendar date for "today" buckets the previous local day for UTC-negative
  // users (the date string parses as a UTC-midnight instant server-side).
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
