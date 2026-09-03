import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Platform,
  Pressable,
  AccessibilityInfo,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import * as Haptics from "expo-haptics";

import { ChatBubble } from "@/components/ChatBubble";
import { InlineError } from "@/components/InlineError";
import { useTTS } from "@/hooks/useTTS";
import BlockRenderer from "@/components/coach/blocks";
import CoachMicButton from "@/components/coach/CoachMicButton";
import { CoachChatBase } from "@/components/coach/CoachChatBase";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PlanSlotPickerSheet } from "@/components/coach/PlanSlotPickerSheet";
import {
  buildPlanSlotDays,
  toPlannedDateSet,
} from "@/components/coach/plan-slot-picker-utils";
import { useTheme } from "@/hooks/useTheme";
import {
  useChatMessages,
  useDeleteChatMessageForRetry,
  type ChatMessage,
} from "@/hooks/useChat";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useSaveCatalogRecipe } from "@/hooks/useMealPlanRecipes";
import { useAddMealPlanItem, useMealPlanItems } from "@/hooks/useMealPlan";
import { useToast } from "@/context/ToastContext";
import { useHaptics } from "@/hooks/useHaptics";
import type { MealType } from "@/screens/meal-plan/meal-plan-utils";
import { useQueryClient } from "@tanstack/react-query";
import { Spacing } from "@/constants/theme";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import {
  parsePlanDays,
  filterValidBlocks,
  describePlanSaveFailure,
  formatPlanSaveSuccess,
} from "@/components/coach/coach-chat-utils";
import { useCoachStream } from "@/hooks/useCoachStream";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import StreamingBubble from "@/components/coach/StreamingBubble";
import { apiRequest } from "@/lib/query-client";
import { ErrorCode } from "@shared/constants/error-codes";
import type { useCoachWarmUp } from "@/hooks/useCoachWarmUp";
import type {
  CoachChatNavigationProp,
  RootStackParamList,
} from "@/types/navigation";

interface CoachChatProps {
  conversationId: number | null;
  onCreateConversation: () => Promise<number>;
  isCoachPro: boolean;
  warmUpHook: ReturnType<typeof useCoachWarmUp>;
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
  /** Called once a message send has actually committed (after startStream). */
  onMessageSent?: () => void;
  inputBarStyle?: StyleProp<ViewStyle>;
}

type ChatListItem =
  | { type: "message"; id: string; message: ChatMessage }
  | { type: "optimistic"; id: string; content: string };

export default function CoachChat({
  conversationId,
  onCreateConversation,
  isCoachPro,
  warmUpHook,
  initialMessage,
  onInitialMessageSent,
  onMessageSent,
  inputBarStyle,
}: CoachChatProps) {
  const { theme } = useTheme();
  const navigation = useNavigation<CoachChatNavigationProp>();
  const hasVoice = usePremiumFeature("coachPro");
  // Catalog save is premium-gated server-side (checkPremiumFeature
  // "catalogSave" on POST /api/meal-plan/catalog/:id/save) — gate here too so
  // a free user gets the upgrade path instead of a failed request.
  const canSaveCatalog = usePremiumFeature("catalogSave");
  const deleteChatMessage = useDeleteChatMessageForRetry();
  const queryClient = useQueryClient();
  const toast = useToast();
  const haptics = useHaptics();
  // Destructure rather than depend on the mutation objects themselves —
  // useMutation returns a new object identity every render, which would
  // make every useCallback below that depends on it re-create every render.
  const { mutateAsync: saveCatalogRecipe, isPending: isSavingCatalog } =
    useSaveCatalogRecipe();
  const { mutateAsync: addMealPlanItem, isPending: isAddingPlanItem } =
    useAddMealPlanItem();

  const [inputText, setInputText] = useState("");
  const [streamBlocks, setStreamBlocks] = useState<CoachBlock[]>([]);
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [isAtDailyLimit, setIsAtDailyLimit] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(
    null,
  );
  const [planTarget, setPlanTarget] = useState<{
    recipeId: number;
    recipeTitle: string;
  } | null>(null);
  // Recompute trigger for the meal-plan items window below (see the
  // planWeek effect for why this must be an effect trigger, not a useMemo
  // dep). Derived boolean, not `planTarget` itself, so a *different* recipe
  // opened while the sheet is already up does not re-trigger the fetch.
  const isPlanSheetOpen = planTarget !== null;

  const listRef = useRef<FlatList<ChatListItem>>(null);
  const prevStreamingRef = useRef(false);
  const lastAnnouncedIndexRef = useRef(0);
  const activeConvIdRef = useRef<number | null>(null);
  const usedQuickRepliesRef = useRef<Set<string>>(new Set());
  const [quickReplyVersion, setQuickReplyVersion] = useState(0);
  const acceptedCommitmentsRef = useRef<Set<number | string>>(new Set());
  const [commitmentVersion, setCommitmentVersion] = useState(0);
  // Ref-based (not prop-based) double-submit guard: PlanSlotPickerSheet's own
  // `isSubmitting`-prop guard reads the CURRENT render's props, which lags a
  // rapid double-tap on Confirm — two synchronous taps can both fire
  // onConfirm before React re-renders with the mutation's in-flight state.
  // This ref is set synchronously at the top of handleConfirmPlanSlot (before
  // any await), so a second synchronous call sees it immediately and bails —
  // a prop can never do that. Mirrors the isActioning.current pattern in
  // AddItemMenuSheet.tsx, adapted to release in `finally` (not on next open)
  // so a retry after a failed save is never permanently blocked.
  const isSavingPlanRef = useRef(false);

  // This CANNOT be `useMemo(() => buildPlanSlotDays(new Date()), [isPlanSheetOpen])`:
  // React Compiler (app.json `experiments.reactCompiler`, wired for all
  // client code via babel-preset-expo) ELIMINATES a useMemo call entirely
  // and re-derives its own reactivity from what the callback body actually
  // READS — `buildPlanSlotDays(new Date())` reads no reactive value, so the
  // compiler discards the manual `[isPlanSheetOpen]` dependency and
  // compiles it to a compute-once-forever cache, silently reintroducing the
  // "pinned at mount" bug this todo exists to fix (confirmed by compiling
  // this exact shape IN ISOLATION with the project's pinned
  // babel-plugin-react-compiler; Vitest doesn't run that plugin, so a naive
  // test would pass while a compiler-covered build stays broken).
  //
  // CORRECTION 2026-09-03: THIS FILE is not compiler-covered. Compiling the
  // real CoachChat.tsx emits `(BuildHIR::lowerStatement) Handle TryStatement
  // with a finalizer ('finally') clause` and produces no transformation —
  // handleConfirmPlanSlot's pre-existing `finally` opts the WHOLE component
  // out. So a naive useMemo would in fact have worked here, because real
  // React honours the literal array whenever the compiler never runs. The
  // shape below is still the right thing to write (correct with or without
  // coverage), but do not read this comment as evidence the compiler was
  // observed discarding the dep in THIS file. Corollary worth knowing: every
  // other manual useMemo/useCallback in this file is load-bearing today, not
  // compiler-backstopped. Full write-up in the solution doc referenced below.
  //
  // A `useEffect` call is different: the compiler
  // PRESERVES it with its own real, separately-tracked deps array (real
  // React then does the runtime comparison), so `[isPlanSheetOpen]` here is
  // actually honored regardless of what the body reads — mirrors
  // PlanSlotPickerSheet's own false->true `visible` recompute
  // (prevVisibleRef effect). The body still reads `isPlanSheetOpen` because
  // the transition logic below needs its value, not because that's what
  // makes the effect re-fire.
  const [planWeek, setPlanWeek] = useState(() => buildPlanSlotDays(new Date()));
  const prevPlanSheetOpenRef = useRef(isPlanSheetOpen);
  useEffect(() => {
    const opened = isPlanSheetOpen && !prevPlanSheetOpenRef.current;
    prevPlanSheetOpenRef.current = isPlanSheetOpen;
    if (opened) {
      setPlanWeek(buildPlanSlotDays(new Date()));
    }
  }, [isPlanSheetOpen]);
  const { data: planItems } = useMealPlanItems(
    planWeek[0].iso,
    planWeek[planWeek.length - 1].iso,
    // The slot picker sheet (and this dot data) is only reachable when
    // canSaveCatalog is true — see the handleBlockAction gate below. Free
    // users never see the sheet, so the request should never fire for them.
    canSaveCatalog,
  );
  const datesWithItems = useMemo(
    () => toPlannedDateSet(planItems),
    [planItems],
  );
  // extraData must be treated immutably (FlatList is a PureComponent and
  // React Compiler does not protect its internal class-component compare) —
  // an inline array literal would re-render every visible cell per keystroke.
  const listExtraData = useMemo(
    () => [quickReplyVersion, commitmentVersion],
    [quickReplyVersion, commitmentVersion],
  );

  const {
    isListening,
    transcript,
    isFinal,
    volume,
    startListening,
    stopListening,
  } = useSpeechToText();

  const {
    isSpeaking,
    speakingMessageId,
    speak: ttsSpeak,
    stop: ttsStop,
  } = useTTS();

  const {
    startStream,
    abortStream,
    streamingContent,
    statusText,
    isStreaming,
  } = useCoachStream({
    onDone: (_fullText, blocks) => {
      setOptimisticMessage(null);
      if (blocks && blocks.length > 0) setStreamBlocks(blocks);
      if (activeConvIdRef.current !== null) {
        void queryClient.invalidateQueries({
          queryKey: [
            `/api/chat/conversations/${activeConvIdRef.current}/messages`,
          ],
        });
      }
    },
    onError: (_message, code) => {
      // Branch on the machine-readable code, not a `message.startsWith("429")`
      // prefix (the raw "<status>: <body>" wire format). Never render the raw
      // message — it leaks the server response body into the UI / VoiceOver.
      if (code === ErrorCode.DAILY_LIMIT_REACHED) {
        setIsAtDailyLimit(true);
      } else {
        setStreamingError("Something went wrong. Please try again.");
      }
      setOptimisticMessage(null);
    },
  });

  // Accessibility announcements for streaming state
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (isStreaming && !wasStreaming) {
      // Streaming just started
      lastAnnouncedIndexRef.current = 0;
      AccessibilityInfo.announceForAccessibility("Coach is thinking...");
    } else if (!isStreaming && wasStreaming) {
      // Streaming just finished
      AccessibilityInfo.announceForAccessibility("Coach responded");
    }
  }, [isStreaming]);

  // Announce streaming sentences progressively as they arrive (iOS VoiceOver only)
  useEffect(() => {
    if (!isStreaming || !streamingContent) return;

    const text = streamingContent;
    const startIdx = lastAnnouncedIndexRef.current;
    const remaining = text.slice(startIdx);

    const boundaryMatch = remaining.match(/[.?!]\s/);
    if (!boundaryMatch || boundaryMatch.index === undefined) return;

    const endIdx = startIdx + boundaryMatch.index + 1;
    const sentence = text.slice(lastAnnouncedIndexRef.current, endIdx).trim();

    if (sentence.length > 0) {
      lastAnnouncedIndexRef.current = endIdx;
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(sentence);
      }
    }
  }, [streamingContent, isStreaming]);

  // `silentError` opts this query out of the global QueryCache toast net — the
  // blank-thread error below is the contextual surface for a failed history load,
  // so the global toast would double-report. Other useChatMessages consumers
  // keep the global toast (they have no inline history-error UI yet).
  const {
    data: messages,
    isError: isHistoryError,
    refetch: refetchMessages,
  } = useChatMessages(conversationId, { silentError: true });

  // Distinguish a failed history fetch (show error + retry) from a genuinely
  // empty conversation (render nothing): only surface the error when the query
  // failed AND there are no messages to show. The `length === 0` guard is also
  // deliberate for stale-while-revalidate — if a background refetch fails but
  // we still hold cached messages, keep showing them rather than replacing a
  // populated thread with an error screen.
  const showHistoryError = isHistoryError && (messages?.length ?? 0) === 0;

  const chatItems = useMemo<ChatListItem[]>(() => {
    const items: ChatListItem[] = (messages ?? []).map((message) => ({
      type: "message",
      id: `message-${message.id}`,
      message,
    }));
    if (optimisticMessage) {
      items.push({
        type: "optimistic",
        id: "optimistic",
        content: optimisticMessage,
      });
    }
    return items;
  }, [messages, optimisticMessage]);

  // Validate blocks once per messages change, not on every render tick
  const messageBlocks = useMemo(() => {
    if (!messages) return new Map<number, CoachBlock[]>();
    const map = new Map<number, CoachBlock[]>();
    for (const msg of messages) {
      const meta = msg.metadata as Record<string, unknown> | null | undefined;
      const rawBlocks = meta?.blocks;
      if (Array.isArray(rawBlocks)) {
        const valid = filterValidBlocks(rawBlocks);
        if (valid.length > 0) map.set(msg.id, valid);
      }
    }
    return map;
  }, [messages]);

  const lastAssistantMessageId = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    const last = messages[messages.length - 1];
    return last.role === "assistant" ? last.id : null;
  }, [messages]);

  // Show interim transcript in input field while listening
  useEffect(() => {
    if (isListening && transcript) {
      setInputText(transcript);
      // Send warm-up for interim transcript
      if (isCoachPro) {
        warmUpHook.sendWarmUp(transcript);
      }
    }
  }, [isListening, transcript, isCoachPro, warmUpHook]);

  // Auto-send when speech finalizes
  useEffect(() => {
    if (isFinal && transcript) {
      void handleSend(transcript);
    }
  }, [isFinal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (text?: string) => {
      // onPress/onSubmitEditing invoke this with an event object, not a string — only trust an explicit string arg (quick replies, voice).
      const content = (typeof text === "string" ? text : inputText).trim();
      if (!content || isStreaming) return;

      setInputText("");
      setOptimisticMessage(content);
      setStreamBlocks([]);
      setStreamingError(null);
      setIsAtDailyLimit(false);
      ttsStop();

      let convId = conversationId;
      if (!convId) {
        try {
          convId = await onCreateConversation();
        } catch {
          setOptimisticMessage(null);
          return;
        }
      }

      activeConvIdRef.current = convId;
      const currentWarmUpId = isCoachPro ? warmUpHook.getWarmUpId() : null;
      startStream(convId, content, { warmUpId: currentWarmUpId });
      warmUpHook.reset();
      onMessageSent?.();
    },
    [
      inputText,
      isStreaming,
      conversationId,
      onCreateConversation,
      warmUpHook,
      isCoachPro,
      ttsStop,
      startStream,
      onMessageSent,
    ],
  );

  const handleRetry = useCallback(async () => {
    if (!messages || messages.length < 2 || isStreaming) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const msgQueryKey = [`/api/chat/conversations/${conversationId}/messages`];
    const snapshot = queryClient.getQueryData<ChatMessage[]>(msgQueryKey);
    queryClient.setQueryData<ChatMessage[]>(
      msgQueryKey,
      (old) => old?.filter((m) => m.id !== lastMsg.id) ?? [],
    );

    try {
      // Delete assistant then user message (in order — each was "most recent" at time of delete)
      await deleteChatMessage.mutateAsync(lastMsg.id);
      await deleteChatMessage.mutateAsync(lastUserMsg.id);
    } catch {
      queryClient.setQueryData(msgQueryKey, snapshot);
      setStreamingError("Retry failed. Check your connection and try again.");
      return;
    }
    void handleSend(lastUserMsg.content);
  }, [
    messages,
    isStreaming,
    conversationId,
    deleteChatMessage,
    queryClient,
    handleSend,
  ]);

  // Auto-send suggestion chip messages
  useEffect(() => {
    if (initialMessage) {
      void handleSend(initialMessage);
      onInitialMessageSent?.();
    }
  }, [initialMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBlockAction = useCallback(
    (action: Record<string, unknown>) => {
      if (action.type === "log_food") {
        void handleSend(`Please log: ${action.description as string}`);
      } else if (action.type === "add_recipe_to_plan") {
        // Client-local action — never enters blockActionSchema, so the AI
        // gains no new capability. Only RecipeCard's "spoonacular" branch
        // emits this.
        if (!canSaveCatalog) {
          setShowUpgrade(true);
          return;
        }
        setPlanTarget({
          recipeId: action.recipeId as number,
          recipeTitle: action.recipeTitle as string,
        });
      } else if (action.type === "navigate") {
        const screen = action.screen as string;
        const params = action.params as Record<string, unknown> | undefined;
        // Typed screen-specific branches — each call uses a literal screen name
        // so TypeScript verifies params against RootStackParamList per screen.
        // Params are Zod-validated upstream via NAVIGABLE_SCREENS enum.
        switch (screen) {
          case "NutritionDetail":
            // This `as` cast remains necessary: `params` is typed
            // Record<string, unknown> | undefined, and TypeScript cannot
            // statically narrow that to a discriminated-union arm no matter
            // what a runtime check proves. What changed (P3-2026-08-16):
            // shared/schemas/coach-blocks.ts's validateNavigateParams now
            // reassigns val.params to the parsed/stripped result, so an
            // illegal `{ itemId, barcode }` pair is stripped down to
            // `{ barcode }` before this action ever reaches here — the
            // runtime shape is now trustworthy, only the TYPE-level
            // narrowing still needs this boundary cast.
            navigation.navigate(
              "NutritionDetail",
              params as RootStackParamList["NutritionDetail"],
            );
            break;
          case "FeaturedRecipeDetail":
            navigation.navigate(
              "FeaturedRecipeDetail",
              params as RootStackParamList["FeaturedRecipeDetail"],
            );
            break;
          case "RecipeChat":
            navigation.navigate(
              "RecipeChat",
              params as RootStackParamList["RecipeChat"],
            );
            break;
          case "Scan":
            navigation.navigate("Scan", params as RootStackParamList["Scan"]);
            break;
          case "RecipeBrowserModal":
            navigation.navigate(
              "RecipeBrowserModal",
              params as RootStackParamList["RecipeBrowserModal"],
            );
            break;
          case "QuickLog":
            navigation.navigate("QuickLog");
            break;
          case "DailyNutritionDetail":
            navigation.navigate("DailyNutritionDetail");
            break;
          case "GoalSetup":
            navigation.navigate("GoalSetup");
            break;
          case "GroceryListsModal":
            navigation.navigate("GroceryListsModal");
            break;
          case "PantryModal":
            navigation.navigate("PantryModal");
            break;
          case "CookbookListModal":
            navigation.navigate("CookbookListModal");
            break;
        }
      } else if (action.type === "add_meal_plan") {
        // Pass the AI-generated meal plan data through to the recipe browser
        const planDays = parsePlanDays(action.plan);
        navigation.navigate("RecipeBrowserModal", { planDays });
      } else if (action.type === "add_grocery_list") {
        navigation.navigate("GroceryListsModal");
      } else if (action.type === "set_goal") {
        navigation.navigate("GoalSetup");
      }
    },
    [handleSend, navigation, canSaveCatalog],
  );

  // Reachable today, not hypothetical: PlanSlotPickerSheet's dismissal paths
  // (backdrop tap, Close button, onRequestClose) are all unconditional — none
  // of them check isSubmitting — so a user can dismiss the sheet while
  // saveCatalogRecipe (a slow server-side Spoonacular fetch) is still
  // in-flight for a prior confirm. Without this reset, reopening the sheet
  // and tapping Confirm again would silently no-op: isSavingPlanRef is still
  // true from the still-running earlier call, handleConfirmPlanSlot's guard
  // returns immediately, and the sheet has already fired its "Add to Plan"
  // haptic — tactile feedback for a tap that did nothing. Resetting on every
  // null->non-null planTarget transition (a fresh "Add to Plan" tap) closes
  // that gap.
  useEffect(() => {
    if (planTarget) {
      isSavingPlanRef.current = false;
    }
  }, [planTarget]);

  const handleConfirmPlanSlot = useCallback(
    async (plannedDate: string, mealType: MealType, dayLabel: string) => {
      if (!planTarget || isSavingPlanRef.current) return;
      isSavingPlanRef.current = true;
      try {
        // Two steps are required: /api/meal-plan/items enforces IDOR ownership
        // and takes only a user-owned recipe id, while a coach card carries a
        // Spoonacular catalog id. The save is idempotent — it returns the
        // existing row when the recipe was saved before.
        const saved = await saveCatalogRecipe(planTarget.recipeId);
        await addMealPlanItem({
          recipeId: saved.id,
          plannedDate,
          mealType,
        });
        haptics.notification(Haptics.NotificationFeedbackType.Success);
        toast.success(formatPlanSaveSuccess(dayLabel, mealType));
        setPlanTarget(null);
      } catch (error) {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        const failure = describePlanSaveFailure(error);
        toast.error(failure.message);
        // Terminal failures (402 quota, 422 unusable recipe, 404 catalog
        // miss) reproduce identically on every retry — close the sheet
        // instead of leaving it open for a retry that can only fail again.
        // Anything else is presumed transient: keep the sheet open so the
        // user can retry.
        if (failure.terminal) {
          setPlanTarget(null);
        }
      } finally {
        isSavingPlanRef.current = false;
      }
    },
    [planTarget, saveCatalogRecipe, addMealPlanItem, haptics, toast],
  );

  const handleCommitmentAccept = useCallback(
    async (
      notebookEntryId: number | undefined,
      title: string,
      followUpDate: string,
    ) => {
      // Use notebookEntryId if available, otherwise a string key for local tracking
      const key: number | string =
        notebookEntryId ?? `${title}::${followUpDate}`;
      acceptedCommitmentsRef.current = new Set([
        ...acceptedCommitmentsRef.current,
        key,
      ]);
      setCommitmentVersion((v) => v + 1);
      if (!notebookEntryId) return;
      try {
        await apiRequest(
          "POST",
          `/api/chat/commitments/${notebookEntryId}/accept`,
        );
      } catch {
        // Non-fatal — local state already updated
      }
    },
    [],
  );

  const handleQuickReply = useCallback(
    (message: string, blockKey?: string) => {
      if (blockKey) {
        usedQuickRepliesRef.current = new Set([
          ...usedQuickRepliesRef.current,
          blockKey,
        ]);
        setQuickReplyVersion((v) => v + 1);
      }
      void handleSend(message);
    },
    [handleSend],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.type === "message") {
        const msg = item.message;
        const isRetryTarget =
          !isStreaming &&
          msg.role === "assistant" &&
          msg.id === lastAssistantMessageId;
        const isAssistant = msg.role === "assistant";
        return (
          <View>
            <ChatBubble
              role={msg.role as "user" | "assistant"}
              content={msg.content}
              onSpeak={
                isAssistant ? () => ttsSpeak(msg.id, msg.content) : undefined
              }
              isSpeaking={
                isAssistant && speakingMessageId === msg.id && isSpeaking
              }
            />
            {messageBlocks.get(msg.id)?.map((block, i) => {
              const bKey = `${msg.id}-${i}`;
              return (
                <BlockRenderer
                  key={`${msg.id}-block-${i}`}
                  block={block}
                  onAction={handleBlockAction}
                  onQuickReply={handleQuickReply}
                  blockKey={bKey}
                  onCommitmentAccept={handleCommitmentAccept}
                  isUsed={usedQuickRepliesRef.current.has(bKey)}
                  isCommitmentAccepted={
                    block.type === "commitment_card"
                      ? acceptedCommitmentsRef.current.has(
                          block.notebookEntryId ??
                            `${block.title}::${block.followUpDate}`,
                        )
                      : undefined
                  }
                />
              );
            })}
            {isRetryTarget && (
              <Pressable
                onPress={handleRetry}
                style={styles.retryButton}
                accessibilityRole="button"
                accessibilityLabel="Regenerate response"
              >
                <Text
                  style={[styles.retryText, { color: theme.textSecondary }]}
                >
                  ↺ Regenerate
                </Text>
              </Pressable>
            )}
          </View>
        );
      }

      if (item.type === "optimistic") {
        return <ChatBubble role="user" content={item.content} />;
      }

      return null;
    },
    [
      handleBlockAction,
      handleCommitmentAccept,
      handleQuickReply,
      handleRetry,
      isStreaming,
      isSpeaking,
      speakingMessageId,
      ttsSpeak,
      lastAssistantMessageId,
      messageBlocks,
      theme.textSecondary,
    ],
  );

  const streamingFooter = useMemo(
    () =>
      isStreaming || streamBlocks.length > 0 ? (
        <StreamingBubble
          streamingContent={streamingContent}
          statusText={statusText}
          isStreaming={isStreaming}
          streamBlocks={streamBlocks}
          onBlockAction={handleBlockAction}
          onQuickReply={handleQuickReply}
          onCommitmentAccept={handleCommitmentAccept}
          ttsSpeak={ttsSpeak}
          isSpeaking={isSpeaking}
          speakingMessageId={speakingMessageId}
        />
      ) : null,
    [
      isStreaming,
      streamingContent,
      statusText,
      streamBlocks,
      handleBlockAction,
      handleQuickReply,
      handleCommitmentAccept,
      ttsSpeak,
      isSpeaking,
      speakingMessageId,
    ],
  );

  // Shown in place of an empty thread when the history fetch failed, so a load
  // failure reads as a recoverable error rather than a wiped conversation.
  const historyErrorEmpty = useMemo(
    () =>
      showHistoryError ? (
        <View style={styles.historyError}>
          <InlineError message="Couldn’t load this conversation." />
          <Pressable
            onPress={() => void refetchMessages()}
            style={styles.historyRetryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading conversation"
            hitSlop={8}
          >
            <Text style={[styles.historyRetryText, { color: theme.link }]}>
              ↺ Retry
            </Text>
          </Pressable>
        </View>
      ) : null,
    [showHistoryError, refetchMessages, theme.link],
  );

  const handleContentSizeChange = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: false });
  }, []);

  useEffect(() => {
    return () => {
      abortStream();
    };
  }, [abortStream]);

  const handleMicPress = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      void startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleChangeText = useCallback(
    (text: string) => {
      setInputText(text);
      if (isCoachPro) warmUpHook.sendTextWarmUp(text);
    },
    [isCoachPro, warmUpHook],
  );

  const micAdornment = useMemo(
    () =>
      hasVoice ? (
        <CoachMicButton
          isListening={isListening}
          volume={volume}
          onPress={handleMicPress}
        />
      ) : null,
    [hasVoice, isListening, volume, handleMicPress],
  );

  const prevIsAtDailyLimitRef = useRef(false);
  useEffect(() => {
    if (isAtDailyLimit && !prevIsAtDailyLimitRef.current) {
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(
          "Daily coaching limit reached",
        );
      }
    }
    prevIsAtDailyLimitRef.current = isAtDailyLimit;
  }, [isAtDailyLimit]);

  const limitBanner = useMemo(
    () =>
      isAtDailyLimit ? (
        <View style={styles.limitBanner} accessibilityLiveRegion="assertive">
          <Text style={[styles.limitText, { color: theme.textSecondary }]}>
            {"You’ve reached today’s coaching limit."}
          </Text>
          <Pressable
            onPress={() => setShowUpgrade(true)}
            accessibilityRole="button"
            accessibilityLabel="Upgrade to Coach Pro"
            hitSlop={16}
          >
            <Text style={[styles.limitCta, { color: theme.link }]}>
              Upgrade to Coach Pro
            </Text>
          </Pressable>
        </View>
      ) : null,
    [isAtDailyLimit, theme.textSecondary, theme.link],
  );

  return (
    <CoachChatBase
      inputText={inputText}
      onChangeText={handleChangeText}
      onSend={handleSend}
      isStreaming={isStreaming}
      inputAdornment={micAdornment}
      keyboardVerticalOffset={90}
      streamingError={streamingError}
      inlineBanner={limitBanner}
      inputBarStyle={inputBarStyle}
    >
      <FlatList
        {...FLATLIST_DEFAULTS}
        ref={listRef}
        data={chatItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={listExtraData}
        ListFooterComponent={streamingFooter}
        ListEmptyComponent={historyErrorEmpty}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={handleContentSizeChange}
      />
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        onUpgrade={() => setIsAtDailyLimit(false)}
      />
      <PlanSlotPickerSheet
        visible={planTarget !== null}
        recipeTitle={planTarget?.recipeTitle ?? ""}
        datesWithItems={datesWithItems}
        isSubmitting={isSavingCatalog || isAddingPlanItem}
        onConfirm={handleConfirmPlanSlot}
        onDismiss={() => setPlanTarget(null)}
      />
    </CoachChatBase>
  );
}

const styles = StyleSheet.create({
  messageList: { flex: 1 },
  messageContent: { padding: Spacing.md, paddingBottom: Spacing.lg },
  retryButton: {
    alignSelf: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: Spacing.sm,
    marginTop: 2,
    // WCAG 2.5.5 AAA: lift the tap target to ≥44pt. alignSelf: flex-start keeps
    // the width hugging the label; minHeight raises height only.
    minHeight: 44,
    justifyContent: "center",
  },
  retryText: { fontSize: 12 },
  historyError: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  historyRetryButton: {
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
  },
  historyRetryText: { fontSize: 14, fontWeight: "600" as const },
  limitBanner: {
    padding: Spacing.md,
    alignItems: "center" as const,
    gap: 4,
  },
  limitText: { fontSize: 14, textAlign: "center" as const },
  limitCta: { fontSize: 14, fontWeight: "600" as const },
});
