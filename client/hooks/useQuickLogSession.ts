import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useHaptics } from "@/hooks/useHaptics";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useParseFoodText, type ParsedFoodItem } from "@/hooks/useFoodParse";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";

export type { ParsedFoodItem };

export interface LogSummary {
  itemCount: number;
  totalCalories: number;
  firstName: string;
}

interface UseQuickLogSessionOptions {
  onLogSuccess?: (summary: LogSummary) => void;
  isOpen?: boolean;
}

interface PartialLogError extends Error {
  failedIndices?: number[];
}

export function useQuickLogSession({
  onLogSuccess,
  isOpen = false,
}: UseQuickLogSessionOptions = {}) {
  const queryClient = useQueryClient();
  const haptics = useHaptics();

  const onLogSuccessRef = useRef(onLogSuccess);
  useEffect(() => {
    onLogSuccessRef.current = onLogSuccess;
  }, [onLogSuccess]);

  const [inputText, setInputText] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedFoodItem[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Tracks the intended source for the next parse trigger
  const pendingSourceRef = useRef<"voice" | "text" | "chip">("text");

  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();

  const { mutate: parseFoodTextMutate, isPending: isParsing } =
    useParseFoodText();

  // Stream transcript into text input while listening
  useEffect(() => {
    if (isListening && transcript) {
      setInputText(transcript);
    }
  }, [isListening, transcript]);

  // Auto-trigger parse when recognition produces a final result
  useEffect(() => {
    if (isFinal && transcript && !isParsing) {
      setInputText(transcript);
      setParseError(null);
      parseFoodTextMutate(transcript, {
        onSuccess: (data) => {
          setParsedItems(
            data.items.map((item) => ({ ...item, sourceType: "voice" })),
          );
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        },
        onError: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          setParseError("Failed to parse food text. Please try again.");
        },
      });
    }
  }, [isFinal, transcript, isParsing, parseFoodTextMutate, haptics]);

  const handleTextSubmit = useCallback(() => {
    if (!inputText.trim() || isParsing) return;
    setParseError(null);
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    const source = pendingSourceRef.current;
    pendingSourceRef.current = "text";
    parseFoodTextMutate(inputText.trim(), {
      onSuccess: (data) => {
        setParsedItems(
          data.items.map((item) => ({ ...item, sourceType: source })),
        );
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      },
      onError: () => {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        setParseError("Failed to parse food text. Please try again.");
      },
    });
  }, [inputText, isParsing, haptics, parseFoodTextMutate]);

  const handleVoicePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening, haptics]);

  const removeItem = useCallback((index: number) => {
    setParsedItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleChipPress = useCallback(
    (text: string) => {
      pendingSourceRef.current = "chip";
      setInputText(text);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    },
    [haptics],
  );

  const logAllMutation = useMutation({
    mutationFn: async (items: ParsedFoodItem[]) => {
      const results = await Promise.allSettled(
        items.map(async (item) => {
          const res = await apiRequest("POST", "/api/scanned-items", {
            productName: `${item.quantity} ${item.unit} ${item.name}`,
            sourceType: item.sourceType ?? "voice",
            calories: item.calories?.toString(),
            protein: item.protein?.toString(),
            carbs: item.carbs?.toString(),
            fat: item.fat?.toString(),
            servingSize: item.servingSize,
          });
          return res.json();
        }),
      );
      const failedIndices = results
        .map((r, i) => (r.status === "rejected" ? i : -1))
        .filter((i) => i !== -1);
      if (failedIndices.length > 0) {
        // Surface the failed indices so onError can remove successfully-logged items
        const err: PartialLogError = new Error("Some items failed to log");
        err.failedIndices = failedIndices;
        throw err;
      }
      return results.map((r) => (r as PromiseFulfilledResult<unknown>).value);
    },
    onSuccess: (_data, items) => {
      const summary: LogSummary = {
        itemCount: items.length,
        totalCalories: items.reduce(
          (sum, item) => sum + (item.calories ?? 0),
          0,
        ),
        firstName: items[0]?.name ?? "Food",
      };
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.frequentItems });
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      setParsedItems([]);
      setInputText("");
      setSubmitError(null);
      onLogSuccessRef.current?.(summary);
    },
    onError: (error, items) => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      // Keep only the items that failed so a retry won't re-submit already-persisted ones.
      // Index stability holds because parsedItems is frozen while the mutation is in-flight.
      const failedIndices = (error as PartialLogError).failedIndices ?? [];
      if (failedIndices.length > 0) {
        const failedSet = new Set(failedIndices);
        setParsedItems((prev) => prev.filter((_, i) => failedSet.has(i)));
        if (failedIndices.length < items.length) {
          // Some items persisted — refresh stale queries
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.frequentItems });
        }
      }
      const allFailed =
        failedIndices.length === 0 || failedIndices.length === items.length;
      setSubmitError(
        allFailed
          ? "Failed to log items. Please try again."
          : "Some items failed to log. Please try again.",
      );
    },
  });

  const { data: frequentItems } = useQuery({
    queryKey: QUERY_KEYS.frequentItems,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/scanned-items/frequent?limit=5",
      );
      if (!res) return [];
      const data = (await res.json()) as { items: { productName: string }[] };
      return data.items ?? [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  const { mutate: logAllMutate } = logAllMutation;

  const submitLog = useCallback(() => {
    if (parsedItems.length === 0) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    logAllMutate(parsedItems);
  }, [parsedItems, haptics, logAllMutate]);

  const reset = useCallback(() => {
    setInputText("");
    setParsedItems([]);
    setParseError(null);
    setSubmitError(null);
  }, []);

  return {
    inputText,
    setInputText,
    isListening,
    volume,
    isParsing,
    parsedItems,
    parseError,
    submitError,
    isSubmitting: logAllMutation.isPending,
    speechError,
    handleTextSubmit,
    handleVoicePress,
    removeItem,
    handleChipPress,
    submitLog,
    reset,
    frequentItems,
  };
}
