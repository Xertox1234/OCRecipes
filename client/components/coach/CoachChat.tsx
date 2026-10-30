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
  type ScrollView,
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
import { useTheme } from "@/hooks/useTheme";
import {
  useChatMessages,
  useDeleteChatMessageForRetry,
  useSaveRecipeFromChat,
  type ChatMessage,
  type StreamingRecipe,
} from "@/hooks/useChat";
import { RecipeCard as GeneratedRecipeCard } from "@/components/recipe-chat/RecipeCard";
import {
  finderItemNavParams,
  lockedFinderButtons,
} from "@/components/recipe-finder/recipe-finder-utils";
import type { AdjustChoicesStore } from "@/components/recipe-finder/recipe-offer-utils";
import { recipeChatMetadataSchema } from "@shared/schemas/recipe-chat";
import {
  isFinderBlockType,
  type FinderAction,
  type FinderItem,
} from "@shared/schemas/recipe-finder";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useMakeSuggestionFlow } from "@/hooks/useMakeSuggestionFlow";
import { useToast } from "@/context/ToastContext";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { streamBlockEntranceHoldMs } from "@/constants/animations";
import { SAVED_ITEMS_FULL_MESSAGE } from "@/lib/saved-items-full";
import {
  useAddFavouriteRecipe,
  useFavouriteRecipeIds,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import { savedRecipeIdFromMetadata } from "@/components/recipe-chat/saved-recipe-utils";
import { useQueryClient } from "@tanstack/react-query";
import { Spacing } from "@/constants/theme";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import {
  parsePlanDays,
  filterValidBlocks,
} from "@/components/coach/coach-chat-utils";
import { useCoachStream } from "@/hooks/useCoachStream";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import StreamingBubble from "@/components/coach/StreamingBubble";
import { apiRequest } from "@/lib/query-client";
import { ErrorCode } from "@shared/constants/error-codes";
import type { useCoachWarmUp } from "@/hooks/useCoachWarmUp";
import type {
  ChatStackParamList,
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

/** FlatList's native scroll ref is typed as a View or a ScrollView. */
function isScrollView(ref: unknown): ref is ScrollView {
  return (
    typeof ref === "object" &&
    ref !== null &&
    typeof (ref as { scrollToEnd?: unknown }).scrollToEnd === "function"
  );
}

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
  // The finder's "Get ideas for you" is premium-gated server-side on the
  // "catalogSave" feature — lock it here too so a free user gets the upgrade
  // path instead of a failed turn.
  const canSearchOnline = usePremiumFeature("catalogSave");
  const queryClient = useQueryClient();
  const toast = useToast();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  // Destructure rather than depend on the mutation objects themselves —
  // useMutation returns a new object identity every render, which would
  // make every useCallback below that depends on it re-create every render.
  const { mutateAsync: deleteChatMessage } = useDeleteChatMessageForRetry();
  const { make: makeFinderItem, makingId: makingFinderItemId } =
    useMakeSuggestionFlow();
  // Flows whose idea cards came back expired (410).
  const [expiredFinderFlowIds, setExpiredFinderFlowIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const canGenerateRecipes = usePremiumFeature("recipeGeneration");
  const finderLocks = useMemo(
    () =>
      lockedFinderButtons({
        canSearchOnline,
        canGenerate: canGenerateRecipes,
      }),
    [canSearchOnline, canGenerateRecipes],
  );
  const { mutateAsync: saveRecipeFromChat } = useSaveRecipeFromChat();
  // messageId → the community recipe id it was saved as (this session).
  const savedRecipeIdsRef = useRef<Map<number, number>>(new Map());
  const { data: favouriteIds } = useFavouriteRecipeIds();
  const { mutate: toggleFavourite } = useToggleFavouriteRecipe();
  const addFavourite = useAddFavouriteRecipe();
  const [savingRecipeMessageId, setSavingRecipeMessageId] = useState<
    number | null
  >(null);

  const [inputText, setInputTextState] = useState("");
  // Latest-value mirror of `inputText`. handleSend reads this ref instead of
  // `inputText` so its identity doesn't change on every keystroke — see H3
  // (2026-09-23 audit): handleSend depending on inputText cascaded into
  // handleRetry/handleBlockAction/handleQuickReply/renderItem all getting new
  // identities per keystroke, forcing every visible FlatList row to re-render.
  // The ref is written together with the state in this setter, NOT in the
  // render body: a render-phase `ref.current =` write is a React Compiler
  // CompileError ("Cannot access refs during render"), and writing here also
  // keeps the ref current before the re-render. (This file is compiler-exempt
  // anyway — handleSaveGeneratedRecipe's try/`finally` opts the component
  // out — so this avoids adding a second bailout, it doesn't restore
  // coverage.)
  // Every write to inputText must go through setInputText (the raw state
  // setter is not used elsewhere).
  const inputTextRef = useRef(inputText);
  const setInputText = useCallback((text: string) => {
    inputTextRef.current = text;
    setInputTextState(text);
  }, []);
  const [streamBlocks, setStreamBlocks] = useState<CoachBlock[]>([]);
  // The latest assistant message id when the footer took the finished
  // reply's blocks. A newer saved message carrying blocks replaces them.
  const [streamBlocksBaseline, setStreamBlocksBaseline] = useState<
    number | null
  >(null);
  // True while the footer blocks' entrance is still playing.
  const [streamBlocksEntering, setStreamBlocksEntering] = useState(false);
  const lastAssistantIdRef = useRef<number | null>(null);
  // Newest saved row id, read at send time (see `optimisticAfter`).
  const lastSavedIdRef = useRef<number | null>(null);
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [isAtDailyLimit, setIsAtDailyLimit] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(
    null,
  );
  // The newest saved row when the question was sent. A user row newer than
  // it is the question's saved copy (a new conversation's first fetch lands
  // mid-reply), so the optimistic copy steps aside instead of doubling it.
  const [optimisticAfter, setOptimisticAfter] = useState<number | null>(null);
  // A finished turn stays on screen (question + streamed text) until the
  // refetch brings in a reply newer than `after`; dropping both on `done`
  // showed the pre-turn conversation for that round trip.
  const [pendingSave, setPendingSave] = useState<{
    after: number | null;
  } | null>(null);
  // Bumped on every send, so a late refetch cannot clear a newer question.
  const turnEpochRef = useRef(0);

  const listRef = useRef<FlatList<ChatListItem>>(null);
  const prevStreamingRef = useRef(false);
  const lastAnnouncedIndexRef = useRef(0);
  const activeConvIdRef = useRef<number | null>(null);
  const usedQuickRepliesRef = useRef<Set<string>>(new Set());
  const [quickReplyVersion, setQuickReplyVersion] = useState(0);
  const acceptedCommitmentsRef = useRef<Set<number | string>>(new Set());
  const [commitmentVersion, setCommitmentVersion] = useState(0);
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
    error: speechError,
  } = useSpeechToText();

  // Without this a denied mic permission left the tap with no response.
  // The toast brings its own error haptic and announcement.
  useEffect(() => {
    if (speechError) {
      toast.error(speechError);
    }
  }, [speechError, toast]);

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
      // Finder blocks render from the refetched message (with the right
      // active state); keeping them in the footer too would show two lists.
      const liveBlocks = (blocks ?? []).filter(
        (b) => !isFinderBlockType(b.type),
      );
      if (liveBlocks.length > 0) {
        setStreamBlocksBaseline(lastAssistantIdRef.current);
        setStreamBlocks(liveBlocks);
        setStreamBlocksEntering(true);
      }
      const convId = activeConvIdRef.current;
      if (convId === null) {
        setOptimisticMessage(null);
        return;
      }
      const after = lastAssistantIdRef.current;
      const epoch = turnEpochRef.current;
      setPendingSave({ after });
      const queryKey = [`/api/chat/conversations/${convId}/messages`];
      void queryClient.invalidateQueries({ queryKey }).finally(() => {
        if (turnEpochRef.current !== epoch) return;
        // A saved reply is handed over by `turnSaved` in the render that
        // shows it. Nothing saved (refund, failed refetch): clear now.
        const rows = queryClient.getQueryData<ChatMessage[]>(queryKey);
        const last = rows?.[rows.length - 1];
        if (last?.role !== "assistant" || last.id === after) {
          setPendingSave(null);
          setOptimisticMessage(null);
        }
      });
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
      // The server may already have saved this turn (the chat route persists
      // the user message before streaming; an interrupt/timeout can land after
      // it, or even after the reply). Clearing the optimistic copy without a refetch hid a
      // saved question and invited a duplicate retry (R23) — reconcile.
      const convId = activeConvIdRef.current;
      if (convId !== null) {
        void queryClient.invalidateQueries({
          queryKey: [`/api/chat/conversations/${convId}/messages`],
        });
      }
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

  const lastAssistantMessageId = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    const last = messages[messages.length - 1];
    return last.role === "assistant" ? last.id : null;
  }, [messages]);

  const turnSaved =
    pendingSave !== null &&
    lastAssistantMessageId !== null &&
    lastAssistantMessageId !== pendingSave.after;
  const showLiveReply = isStreaming || (pendingSave !== null && !turnSaved);

  useEffect(() => {
    if (!turnSaved) return;
    setPendingSave(null);
    setOptimisticMessage(null);
  }, [turnSaved]);

  const chatItems = useMemo<ChatListItem[]>(() => {
    const items: ChatListItem[] = (messages ?? []).map((message) => ({
      type: "message",
      id: `message-${message.id}`,
      message,
    }));
    const last = messages?.[messages.length - 1];
    const questionSaved =
      last?.role === "user" &&
      (optimisticAfter === null || last.id > optimisticAfter);
    if (optimisticMessage && !turnSaved && !questionSaved) {
      items.push({
        type: "optimistic",
        id: "optimistic",
        content: optimisticMessage,
      });
    }
    return items;
  }, [messages, optimisticMessage, optimisticAfter, turnSaved]);

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

  // A Coach message generated by the recipe finder carries RecipeChef's
  // top-level recipe metadata (R5), image included (#1158) — render
  // RecipeChef's card, not the recipe_card block (which needs a recipeId and
  // macros).
  const generatedRecipes = useMemo(() => {
    const map = new Map<
      number,
      { recipe: StreamingRecipe; allergenWarning: string | null }
    >();
    for (const msg of messages ?? []) {
      if (msg.role !== "assistant") continue;
      const parsed = recipeChatMetadataSchema.safeParse(msg.metadata);
      if (parsed.success) {
        map.set(msg.id, {
          recipe: { ...parsed.data.recipe, imageUrl: parsed.data.imageUrl },
          allergenWarning: parsed.data.allergenWarning,
        });
      }
    }
    return map;
  }, [messages]);

  useEffect(() => {
    lastAssistantIdRef.current = lastAssistantMessageId;
  }, [lastAssistantMessageId]);

  useEffect(() => {
    lastSavedIdRef.current = messages?.[messages.length - 1]?.id ?? null;
  }, [messages]);

  // The server saves a reply's blocks into its message metadata, so once
  // the refetched message renders them the footer copy would be a second
  // set (two rows of quick replies, two cards) until the next send. Until
  // the footer copy goes, that saved reply holds back its own copy.
  const heldReplyId =
    streamBlocks.length > 0 &&
    lastAssistantMessageId !== null &&
    lastAssistantMessageId !== streamBlocksBaseline &&
    messageBlocks.has(lastAssistantMessageId)
      ? lastAssistantMessageId
      : null;

  // A fast refetch used to swap in the saved copy, which never animates,
  // before the footer copy's entrance played, so the blocks just appeared.
  useEffect(() => {
    if (!streamBlocksEntering) return;
    const timer = setTimeout(
      () => setStreamBlocksEntering(false),
      streamBlockEntranceHoldMs,
    );
    return () => clearTimeout(timer);
  }, [streamBlocksEntering, streamBlocks]);

  useEffect(() => {
    if (heldReplyId !== null && (reducedMotion || !streamBlocksEntering)) {
      setStreamBlocks([]);
    }
  }, [heldReplyId, reducedMotion, streamBlocksEntering]);

  // Show interim transcript in input field while listening
  useEffect(() => {
    if (isListening && transcript) {
      setInputText(transcript);
      // Send warm-up for interim transcript
      if (isCoachPro) {
        warmUpHook.sendWarmUp(transcript);
      }
    }
  }, [isListening, transcript, isCoachPro, warmUpHook, setInputText]);

  // Auto-send when speech finalizes
  useEffect(() => {
    if (isFinal && transcript) {
      void handleSend(transcript);
    }
  }, [isFinal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (text?: string) => {
      // onPress/onSubmitEditing invoke this with an event object, not a string — only trust an explicit string arg (quick replies, voice).
      const content = (
        typeof text === "string" ? text : inputTextRef.current
      ).trim();
      if (!content || isStreaming) return;

      // Only a tap or the return key buzzes. String callers (voice, quick
      // replies, retry, suggestion hand-off) get feedback from their trigger.
      if (typeof text !== "string") {
        haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      }
      setInputText("");
      turnEpochRef.current += 1;
      setPendingSave(null);
      setOptimisticAfter(lastSavedIdRef.current);
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
          // The input was already cleared and the optimistic bubble was
          // already shown above — a bare catch here left the user with no
          // feedback and their typed message gone. Restore what they typed
          // so they can retry without retyping, and surface the failure via
          // the same InlineError surface used for stream/retry failures.
          setOptimisticMessage(null);
          setInputText(content);
          setStreamingError(
            "Couldn't start the conversation. Please try again.",
          );
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
      // inputText intentionally excluded — handleSend reads the latest value
      // from inputTextRef instead so its identity (and every callback that
      // transitively depends on it: handleRetry, handleBlockAction,
      // handleQuickReply, renderItem) stays stable across keystrokes.
      isStreaming,
      conversationId,
      onCreateConversation,
      warmUpHook,
      isCoachPro,
      ttsStop,
      startStream,
      onMessageSent,
      setInputText,
      haptics,
    ],
  );

  const handleRetry = useCallback(async () => {
    if (!messages || messages.length < 2 || showLiveReply) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const msgQueryKey = [`/api/chat/conversations/${conversationId}/messages`];
    const snapshot = queryClient.getQueryData<ChatMessage[]>(msgQueryKey);
    // Both rows go: the question is resent as a new turn, and a cached copy
    // left here would show it twice while the reply regenerates.
    queryClient.setQueryData<ChatMessage[]>(
      msgQueryKey,
      (old) =>
        old?.filter((m) => m.id !== lastMsg.id && m.id !== lastUserMsg.id) ??
        [],
    );

    try {
      // Delete assistant then user message (in order — each was "most recent" at time of delete)
      await deleteChatMessage(lastMsg.id);
      await deleteChatMessage(lastUserMsg.id);
    } catch {
      queryClient.setQueryData(msgQueryKey, snapshot);
      setStreamingError("Retry failed. Check your connection and try again.");
      return;
    }
    void handleSend(lastUserMsg.content);
  }, [
    messages,
    showLiveReply,
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
          // The "*Modal" cases are the AI's screen names (NAVIGABLE_SCREENS,
          // also stored in past messages), not route names: they open the
          // Coach-stack copies, whose list/cookbook links resolve (a root-
          // modal copy dropped them).
          case "RecipeBrowserModal":
            navigation.navigate(
              "RecipeBrowser",
              params as ChatStackParamList["RecipeBrowser"],
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
            navigation.navigate("GroceryLists");
            break;
          case "PantryModal":
            navigation.navigate("Pantry");
            break;
          case "CookbookListModal":
            navigation.navigate("CookbookList");
            break;
        }
      } else if (action.type === "add_meal_plan") {
        // Pass the AI-generated meal plan data through to the recipe browser
        const planDays = parsePlanDays(action.plan);
        navigation.navigate("RecipeBrowser", { planDays });
      } else if (action.type === "add_grocery_list") {
        navigation.navigate("GroceryLists");
      } else if (action.type === "set_goal") {
        navigation.navigate("GoalSetup");
      }
    },
    [handleSend, navigation],
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

  // A finder tap sends its visible label as the message, with the action.
  const handleFinderAction = useCallback(
    (action: FinderAction, label: string) => {
      if (isStreaming || !conversationId) return;
      // Same tap feedback as RecipeChef's finder handler.
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      turnEpochRef.current += 1;
      setPendingSave(null);
      setOptimisticAfter(lastSavedIdRef.current);
      setOptimisticMessage(label);
      setStreamBlocks([]);
      setStreamingError(null);
      setIsAtDailyLimit(false);
      ttsStop();
      activeConvIdRef.current = conversationId;
      startStream(conversationId, label, { finderAction: action });
      onMessageSent?.();
    },
    [isStreaming, conversationId, haptics, ttsStop, startStream, onMessageSent],
  );

  // The adjust card's choices by flowId, so a card row that remounts (the
  // list virtualizes rows scrolled out of view) keeps what the user picked.
  const [adjustChoices] = useState<AdjustChoicesStore>(() => new Map());

  const handleOpenFinderItem = useCallback(
    (item: FinderItem) => {
      // Ideas have no detail screen — they are made ("Make this mine").
      const params = finderItemNavParams(item);
      if (!params) return;
      navigation.navigate("FeaturedRecipeDetail", params);
    },
    [navigation],
  );

  // "Make this mine" on an idea card; a 410 retires this list's cards.
  const handleMakeFinderItem = useCallback(
    (item: FinderItem, flowId: string) =>
      makeFinderItem(item.id, () =>
        setExpiredFinderFlowIds((prev) => new Set(prev).add(flowId)),
      ),
    [makeFinderItem],
  );

  const openUpgrade = useCallback(() => setShowUpgrade(true), []);

  /** Resolves the saved community recipe id, or null if nothing was saved. */
  const handleSaveGeneratedRecipe = useCallback(
    async (messageId: number): Promise<number | null> => {
      const known = savedRecipeIdsRef.current.get(messageId);
      if (known !== undefined) return known;
      if (!conversationId || savingRecipeMessageId !== null) return null;
      setSavingRecipeMessageId(messageId);
      try {
        const saved = await saveRecipeFromChat({ conversationId, messageId });
        savedRecipeIdsRef.current = new Map([
          ...savedRecipeIdsRef.current,
          [messageId, saved.id],
        ]);
        if (saved.savedItemStatus === "limit_reached") {
          // info toasts are silent — the save still succeeded.
          haptics.notification(Haptics.NotificationFeedbackType.Success);
          toast.info(SAVED_ITEMS_FULL_MESSAGE);
        } else {
          toast.success("Recipe saved");
        }
        return saved.id;
      } catch {
        // useSaveRecipeFromChat has no silentError: the global net toasts it.
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        return null;
      } finally {
        setSavingRecipeMessageId(null);
      }
    },
    [conversationId, savingRecipeMessageId, saveRecipeFromChat, haptics, toast],
  );

  // The card's heart (ruling 2026-09-29): toggles the saved copy; on an
  // unsaved recipe it saves first, then favourites without ever toggling off.
  const handleFavouriteGeneratedRecipe = useCallback(
    async (messageId: number, savedRecipeId: number | null) => {
      if (savedRecipeId !== null) {
        toggleFavourite({ recipeId: savedRecipeId, recipeType: "community" });
        return;
      }
      const id = await handleSaveGeneratedRecipe(messageId);
      if (id === null) return;
      try {
        await addFavourite({ recipeId: id, recipeType: "community" });
      } catch {
        // useToggleFavouriteRecipe surfaces its own failures; the save stands.
      }
    },
    [toggleFavourite, handleSaveGeneratedRecipe, addFavourite],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.type === "message") {
        const msg = item.message;
        const isAssistant = msg.role === "assistant";
        const savedBlocks = messageBlocks.get(msg.id);
        // A finder message's text is the old-client fallback; the block replaces it.
        const hasFinderBlock =
          savedBlocks?.some((b) => isFinderBlockType(b.type)) ?? false;
        // The footer still shows this reply's other blocks (finder blocks
        // never go there), so the saved copy and Regenerate wait.
        const isHeld = msg.id === heldReplyId;
        const blocksForMsg = isHeld
          ? savedBlocks?.filter((b) => isFinderBlockType(b.type))
          : savedBlocks;
        // No Regenerate under a finder message: handleRetry re-sends the
        // last user text without its finderAction, so a "Get ideas for you"
        // tap would come back as a community search for that label. The
        // finder message's own buttons are the next step.
        const isRetryTarget =
          !showLiveReply &&
          isAssistant &&
          !hasFinderBlock &&
          !isHeld &&
          msg.id === lastAssistantMessageId;
        const generated = generatedRecipes.get(msg.id);
        const savedRecipeId =
          savedRecipeIdsRef.current.get(msg.id) ??
          savedRecipeIdFromMetadata(msg.metadata);
        return (
          <View>
            {!hasFinderBlock && (
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
            )}
            {blocksForMsg?.map((block, i) => {
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
                  isActive={!showLiveReply && msg.id === lastAssistantMessageId}
                  lockedFinderButtons={finderLocks}
                  onFinderAction={handleFinderAction}
                  onLockedFinderButton={openUpgrade}
                  onOpenFinderItem={handleOpenFinderItem}
                  onMakeFinderItem={handleMakeFinderItem}
                  makingFinderItemId={makingFinderItemId}
                  expiredFinderFlowIds={expiredFinderFlowIds}
                  messageContent={msg.content}
                  adjustChoices={adjustChoices}
                />
              );
            })}
            {generated ? (
              <GeneratedRecipeCard
                recipe={generated.recipe}
                allergenWarning={generated.allergenWarning}
                isSaved={savedRecipeId !== null}
                isSaving={savingRecipeMessageId === msg.id}
                onSave={() => void handleSaveGeneratedRecipe(msg.id)}
                isFavourited={
                  savedRecipeId !== null &&
                  !!favouriteIds?.ids.some(
                    (f) =>
                      f.recipeId === savedRecipeId &&
                      f.recipeType === "community",
                  )
                }
                onFavourite={() =>
                  void handleFavouriteGeneratedRecipe(msg.id, savedRecipeId)
                }
              />
            ) : null}
            {isRetryTarget && (
              <Pressable
                onPress={handleRetry}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && { opacity: 0.7 },
                ]}
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
        return <ChatBubble role="user" content={item.content} animateEntry />;
      }

      return null;
    },
    [
      handleBlockAction,
      handleCommitmentAccept,
      handleQuickReply,
      handleRetry,
      showLiveReply,
      isSpeaking,
      speakingMessageId,
      ttsSpeak,
      lastAssistantMessageId,
      messageBlocks,
      heldReplyId,
      theme.textSecondary,
      finderLocks,
      handleFinderAction,
      openUpgrade,
      handleOpenFinderItem,
      handleMakeFinderItem,
      makingFinderItemId,
      expiredFinderFlowIds,
      adjustChoices,
      generatedRecipes,
      savingRecipeMessageId,
      handleSaveGeneratedRecipe,
      handleFavouriteGeneratedRecipe,
      favouriteIds,
    ],
  );

  const streamingFooter = useMemo(
    () =>
      showLiveReply || streamBlocks.length > 0 ? (
        <StreamingBubble
          streamingContent={streamingContent}
          statusText={statusText}
          isStreaming={showLiveReply}
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
      showLiveReply,
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
            style={({ pressed }) => [
              styles.historyRetryButton,
              pressed && { opacity: 0.7 },
            ]}
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

  // The native ScrollView's scrollToEnd, not the FlatList's: the FlatList
  // works the end out from cached cell and footer sizes, and a commit that
  // grows the last cell while dropping the footer (a reply's live blocks
  // handing over to the saved copy) lands here before they catch up, so the
  // list stopped short with Regenerate hidden under the input bar.
  const handleContentSizeChange = useCallback(() => {
    const scrollView = listRef.current?.getNativeScrollRef();
    if (isScrollView(scrollView)) scrollView.scrollToEnd({ animated: false });
  }, []);

  useEffect(() => {
    return () => {
      abortStream();
      // Unmounting mid-answer makes the server settle the turn after we're
      // gone (refund or partial reply, H6) — mark the conversation stale so
      // the next view refetches it instead of serving the pre-settle cache.
      // `refetchType: "none"` avoids racing the server's write.
      const convId = activeConvIdRef.current;
      if (convId !== null) {
        void queryClient.invalidateQueries({
          queryKey: [`/api/chat/conversations/${convId}/messages`],
          refetchType: "none",
        });
        void queryClient.invalidateQueries({
          queryKey: ["/api/chat/conversations"],
          refetchType: "none",
        });
      }
    };
  }, [abortStream, queryClient]);

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
    [isCoachPro, warmUpHook, setInputText],
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
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
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
      // Multiline like RecipeChef and the Coach overlay: iOS offered no Paste
      // in the single-line input's long-press menu (user report 2026-09-30).
      // Return still sends.
      multilineInput
      submitOnReturn
      inputBarAlign="flex-end"
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
