import { useState, useCallback, useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  onlineManager,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useHaptics } from "@/hooks/useHaptics";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useParseFoodText, type ParsedFoodItem } from "@/hooks/useFoodParse";
import { apiRequest } from "@/lib/query-client";
import { enqueue } from "@/lib/offline-queue";
import { QUERY_KEYS } from "@/lib/query-keys";
import type { ScannedItem } from "@shared/schema";

type ScannedItemResponse = ScannedItem;

export type { ParsedFoodItem };

export const MAX_LOG_ITEMS = 10;

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
  const [capWarning, setCapWarning] = useState<string | null>(null);

  // Tracks the intended source for the next parse trigger
  const pendingSourceRef = useRef<"voice" | "text" | "chip">("text");

  // Guards the auto-parse effect against re-firing for a transcript it already
  // consumed. isFinal/transcript stay set until the next startListening(), so
  // without this the effect re-parses on every mutation settle (isParsing toggle).
  const autoParsedTranscriptRef = useRef<string | null>(null);

  // Bumped on reset() to invalidate any parse still in flight. A parse that
  // resolves after the session was cleared must not repopulate dismissed items
  // or fire a haptic for an abandoned session (TanStack v5 has no mutation cancel).
  const sessionEpochRef = useRef(0);

  // Mirror of logAllMutation.isPending so the zero-dep removeItem callback can
  // freeze the list during a submit — onError computes failedIndices against the
  // submitted array, so removing an item mid-flight corrupts the partial-retry set.
  const isSubmittingRef = useRef(false);

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
    if (!isFinal) {
      // A new (or interim) recognition pass — let the upcoming final result parse
      autoParsedTranscriptRef.current = null;
      return;
    }
    if (
      transcript &&
      !isParsing &&
      autoParsedTranscriptRef.current !== transcript
    ) {
      autoParsedTranscriptRef.current = transcript;
      setInputText(transcript);
      setParseError(null);
      const epoch = sessionEpochRef.current;
      parseFoodTextMutate(transcript, {
        onSuccess: (data) => {
          if (sessionEpochRef.current !== epoch) return;
          setParsedItems(
            data.items.map((item) => ({ ...item, sourceType: "voice" })),
          );
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        },
        onError: () => {
          if (sessionEpochRef.current !== epoch) return;
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
    const epoch = sessionEpochRef.current;
    parseFoodTextMutate(inputText.trim(), {
      onSuccess: (data) => {
        if (sessionEpochRef.current !== epoch) return;
        setParsedItems(
          data.items.map((item) => ({ ...item, sourceType: source })),
        );
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      },
      onError: () => {
        if (sessionEpochRef.current !== epoch) return;
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        setParseError("Failed to parse food text. Please try again.");
      },
    });
  }, [inputText, isParsing, haptics, parseFoodTextMutate]);

  const handleVoicePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      void stopListening();
    } else {
      void startListening();
    }
  }, [isListening, startListening, stopListening, haptics]);

  const removeItem = useCallback((index: number) => {
    // Frozen while a log submit is in flight (see isSubmittingRef) so the
    // onError partial-retry handler's index math stays valid.
    if (isSubmittingRef.current) return;
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

  const logAllMutation = useMutation<
    ScannedItemResponse[] | undefined,
    PartialLogError,
    ParsedFoodItem[]
  >({
    mutationFn: async (items: ParsedFoodItem[]) => {
      setCapWarning(null);

      if (!onlineManager.isOnline()) {
        // Enqueue each item individually so they replay in savedAt order on reconnect
        const capped = items.slice(0, MAX_LOG_ITEMS);
        if (items.length > MAX_LOG_ITEMS) {
          setCapWarning(
            `Only the first ${MAX_LOG_ITEMS} items were logged. Please log the rest separately.`,
          );
        }
        for (const item of capped) {
          await enqueue({
            endpoint: "/api/scanned-items",
            method: "POST",
            body: {
              productName: `${item.quantity} ${item.unit} ${item.name}`,
              sourceType: item.sourceType ?? "voice",
              calories: item.calories?.toString(),
              protein: item.protein?.toString(),
              carbs: item.carbs?.toString(),
              fat: item.fat?.toString(),
              servingSize: item.servingSize,
            },
          });
        }
        return undefined; // queued — server confirmation deferred
      }

      const capped = items.slice(0, MAX_LOG_ITEMS);
      if (items.length > MAX_LOG_ITEMS) {
        setCapWarning(
          `Only the first ${MAX_LOG_ITEMS} items were logged. Please log the rest separately.`,
        );
      }
      const results = await Promise.allSettled(
        capped.map(async (item) => {
          const res = await apiRequest("POST", "/api/scanned-items", {
            productName: `${item.quantity} ${item.unit} ${item.name}`,
            sourceType: item.sourceType ?? "voice",
            calories: item.calories?.toString(),
            protein: item.protein?.toString(),
            carbs: item.carbs?.toString(),
            fat: item.fat?.toString(),
            servingSize: item.servingSize,
          });
          return res.json() as Promise<ScannedItemResponse>;
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
      return results.map(
        (r) => (r as PromiseFulfilledResult<ScannedItemResponse>).value,
      );
    },
    onSuccess: (data, items) => {
      const loggedItems = items.slice(0, MAX_LOG_ITEMS);
      const summary: LogSummary = {
        itemCount: loggedItems.length,
        totalCalories: loggedItems.reduce(
          (sum, item) => sum + (item.calories ?? 0),
          0,
        ),
        firstName: loggedItems[0]?.name ?? "Food",
      };
      if (data !== undefined) {
        // Online success — invalidate so the UI refreshes with server data
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.dailySummary,
        });
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.scannedItems,
        });
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.frequentItems,
        });
      }
      // Offline path: drain will invalidate after replay — no invalidation here
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
      const failedIndices = error.failedIndices ?? [];
      if (failedIndices.length > 0) {
        const failedSet = new Set(failedIndices);
        setParsedItems((prev) => prev.filter((_, i) => failedSet.has(i)));
        if (failedIndices.length < items.length) {
          // Some items persisted — refresh stale queries
          void queryClient.invalidateQueries({
            queryKey: QUERY_KEYS.dailySummary,
          });
          void queryClient.invalidateQueries({
            queryKey: QUERY_KEYS.scannedItems,
          });
          void queryClient.invalidateQueries({
            queryKey: QUERY_KEYS.frequentItems,
          });
        }
      }
      const cappedCount = Math.min(items.length, MAX_LOG_ITEMS);
      const allFailed =
        failedIndices.length === 0 || failedIndices.length === cappedCount;
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

  // DO NOT replace with `useEffect(() => { isSubmittingRef.current = ... }, [...])`.
  // useEffect runs post-paint, leaving a one-frame window where the removeItem
  // guard sees the stale value just as a submit starts — corrupting onError's
  // failedIndices vs the submitted array. Assigning at render time is the
  // React-sanctioned "store latest value" pattern (idempotent, deterministic,
  // Strict-mode-safe). See docs/rules/hooks.md exception.
  isSubmittingRef.current = logAllMutation.isPending;

  const submitLog = useCallback(() => {
    if (parsedItems.length === 0) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    logAllMutate(parsedItems);
  }, [parsedItems, haptics, logAllMutate]);

  const reset = useCallback(() => {
    if (isListening) stopListening();
    sessionEpochRef.current += 1;
    setInputText("");
    setParsedItems([]);
    setParseError(null);
    setSubmitError(null);
    setCapWarning(null);
  }, [isListening, stopListening]);

  return {
    inputText,
    setInputText,
    isListening,
    volume,
    isParsing,
    parsedItems,
    parseError,
    submitError,
    capWarning,
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
