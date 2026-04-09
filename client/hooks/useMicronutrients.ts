import { useQuery } from "@tanstack/react-query";
import { toDateString } from "@shared/lib/date";

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
  const dateParam = date || toDateString(new Date());
  return useQuery<DailyMicronutrients>({
    queryKey: [`/api/micronutrients/daily?date=${dateParam}`],
  });
}

export function useMicronutrientReference() {
  return useQuery<Record<string, { unit: string; dailyValue: number }>>({
    queryKey: ["/api/micronutrients/reference"],
    staleTime: 24 * 60 * 60 * 1000, // Cache for 24 hours
  });
}

export type { MicronutrientData, ItemMicronutrients, DailyMicronutrients };
