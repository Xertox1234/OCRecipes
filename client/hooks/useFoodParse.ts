import { useMutation } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";

export interface ParsedFoodItem {
  name: string;
  quantity: number;
  unit: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  servingSize: string | null;
}

export function useParseFoodText() {
  return useMutation({
    mutationFn: async (text: string): Promise<{ items: ParsedFoodItem[] }> => {
      const res = await apiRequest("POST", "/api/food/parse-text", { text });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
      return res.json();
    },
  });
}

export function useTranscribeFood() {
  return useMutation({
    mutationFn: async (
      audioUri: string,
    ): Promise<{
      transcription: string;
      items: ParsedFoodItem[];
    }> => {
      const token = await tokenStorage.get();
      const formData = new FormData();
      formData.append("audio", {
        uri: audioUri,
        name: "recording.m4a",
        type: "audio/m4a",
      } as unknown as Blob);

      const res = await fetch(`${getApiUrl()}/api/food/transcribe`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }

      return res.json();
    },
  });
}
