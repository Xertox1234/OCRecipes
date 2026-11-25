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
import type { AllergenId } from "@shared/constants/allergens";

import * as Haptics from "expo-haptics";

import { ChatBubble } from "@/components/ChatBubble";
import { InlineError } from "@/components/InlineError";
import { useTTS } from "@/hooks/useTTS";
import CoachMicButton from "@/components/coach/CoachMicButton";
import CoachCameraButton from "@/components/coach/CoachCameraButton";
import { useCoachPhotoSend } from "@/hooks/useCoachPhotoSend";
import {
  COACH_BARCODE_USER_TEXT,
  COACH_PHOTO_USER_TEXT,
} from "@shared/lib/coach-photo";
import { CoachChatBase } from "@/components/coach/CoachChatBase";
import OpeningBrief from "@/components/coach/OpeningBrief";
import { QUERY_KEY as PENDING_REMINDERS_KEY } from "@/hooks/usePendingReminders";
import { COACH_BRIEF_KEY } from "@/hooks/useCoachBrief";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useTheme } from "@/hooks/useTheme";
import {
  useChatMessages,
  useDeleteChatMessageForRetry,
  useSaveRecipeFromChat,
  type ChatMessage,
  type StreamingRecipe,
} from "@/hooks/useChat";
import {
  finderItemNavParams,
  finderActionNeedsPlan,
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
import { usePlanCheck } from "@/hooks/usePlanCheck";
import { useMakeSuggestionFlow } from "@/hooks/useMakeSuggestionFlow";
import { useToast } from "@/context/ToastContext";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { blockEntranceTotalMs } from "@/components/coach/blocks/block-entrance";
import { SAVED_ITEMS_FULL_MESSAGE } from "@/lib/saved-items-full";
import {
  useAddFavouriteRecipe,
  useFavouriteRecipeIds,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import { useQueryClient } from "@tanstack/react-query";
import { Spacing } from "@/constants/theme";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import type { WriteCardEdits } from "@shared/schemas/coach-write-cards";
import type { BriefForm, RenderedBrief } from "@shared/lib/opening-brief";
import {
  parsePlanDays,
  filterValidBlocks,
  announcedOffset,
  getStreamFinishAnnouncement,
  latestLiveWriteCard,
  lockOlderWriteCards,
  deriveMessageView,
  isPhotoTurnText,
  turnStartBlocked,
  draftToRestore,
} from "@/components/coach/coach-chat-utils";
import { CoachMessageRow } from "@/components/coach/CoachMessageRow";
import { useCoachStream } from "@/hooks/useCoachStream";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import StreamingBubble from "@/components/coach/StreamingBubble";
import { JumpToLatestButton } from "@/components/coach/JumpToLatestButton";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { apiRequest } from "@/lib/query-client";
import { chatMessagesKey } from "@/lib/query-keys";
import { ErrorCode } from "@shared/constants/error-codes";
import { chatRequestErrorCopy } from "@/lib/chat-error-copy";
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
  /**
   * The coach's opening brief for a new chat. Shown above an empty chat; the
   * conversation-creating send tells the server which form was shown, and
   * the server saves its own copy (the client never sends assistant text).
   */
  openingBrief?: {
    brief: RenderedBrief;
    form: BriefForm;
    onShown?: () => void;
  } | null;
  /**
   * The brief's reminder was answered without a message (its Log button
   * opens Quick Log), so the host clears the reminder as a send would.
   */
  onReminderHandled?: () => void;
  /** A reply finished streaming (the host looks for new notebook saves). */
  onReplyDone?: () => void;
  /**
   * True while a turn is on its way: the first send is creating the
   * conversation, a reply is streaming, a photo is uploading, or Regenerate
   * is deleting the last exchange. The host holds its thread controls
   * meanwhile: this component is mounted once for every thread, so a switch
   * would show the live reply in another one.
   */
  onTurnBusyChange?: (busy: boolean) => void;
  /** The brief's "Not today": the host clears just that reminder type. */
  onDismissReminder?: (type: "meal-log") => void;
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
  openingBrief,
  onReminderHandled,
  onReplyDone,
  onTurnBusyChange,
  onDismissReminder,
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
  // Unknown plan (loading/failed): no finder locks; a premium finder tap
  // re-checks the plan instead (owner ruling 2026-11-02).
  const { planUnknown, recheckPlan } = usePlanCheck();
  const finderLocks = useMemo(
    () =>
      lockedFinderButtons({
        canSearchOnline,
        canGenerate: canGenerateRecipes,
        planUnknown,
      }),
    [canSearchOnline, canGenerateRecipes, planUnknown],
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
  // Coach write cards (spec 2026-11-09): the user's edits per card, owned
  // here so the next message can carry the live card's edits to Coach.
  const [writeCardEdits, setWriteCardEdits] = useState<
    Record<string, WriteCardEdits>
  >({});
  const handleWriteCardEdit = useCallback(
    (cardId: string, edits: WriteCardEdits) =>
      setWriteCardEdits((prev) => ({ ...prev, [cardId]: edits })),
    [],
  );
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
  // The turn on its way, for onError: the typed text (null for a photo or a
  // finder button) and the newest saved id when it started.
  const sentTurnRef = useRef<{
    text: string | null;
    lastSavedId: number | null;
  } | null>(null);
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
  // The native ScrollView, not the FlatList: the FlatList works the end out
  // from cached cell and footer sizes, and a commit that grows the last cell
  // while dropping the footer (a reply's live blocks handing over to the
  // saved copy) lands before they catch up, so its scrollToEnd stopped short
  // with Regenerate hidden under the input bar.
  const stickToBottom = useStickToBottom(
    () => {
      const scrollView = listRef.current?.getNativeScrollRef();
      return isScrollView(scrollView) ? scrollView : null;
    },
    { reducedMotion },
  );
  const { followLatest } = stickToBottom;
  // A different conversation opens at its newest message, whatever the
  // scroll position was in the last one.
  useEffect(() => {
    followLatest();
  }, [conversationId, followLatest]);
  const prevStreamingRef = useRef(false);
  // Set by onDone when the turn produced something to read. An error or a
  // user stop also ends the stream, without a reply: no "Coach responded".
  const replyArrivedRef = useRef(false);
  // The prefix of the streaming reply already read out on iOS (see
  // announcedOffset: a safety override replaces it and restarts at 0).
  const announcedTextRef = useRef("");
  // The finished reply's display text, so the finish announcement can speak
  // the last sentence (the per-sentence announcer never reaches it).
  const finishedTextRef = useRef("");
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

  // A brief send's reminders are cleared by the server; once its turn ends,
  // refresh the tab dot and the brief so neither shows a cleared reminder.
  const briefSendRef = useRef(false);
  const refreshAfterBriefSend = () => {
    if (!briefSendRef.current) return;
    briefSendRef.current = false;
    void queryClient.invalidateQueries({ queryKey: PENDING_REMINDERS_KEY });
    void queryClient.invalidateQueries({ queryKey: COACH_BRIEF_KEY });
  };

  const {
    startStream,
    abortStream,
    streamingContent,
    statusText,
    isStreaming,
  } = useCoachStream({
    onDone: (fullText, blocks) => {
      refreshAfterBriefSend();
      onReplyDone?.();
      // A dead-socket abort also lands here, with whatever partial text came.
      replyArrivedRef.current =
        fullText.trim().length > 0 || (blocks?.length ?? 0) > 0;
      finishedTextRef.current = fullText;
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
      const queryKey = chatMessagesKey(convId);
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
      refreshAfterBriefSend();
      // Branch on the machine-readable code, not a `message.startsWith("429")`
      // prefix (the raw "<status>: <body>" wire format). Never render the raw
      // message — it leaks the server response body into the UI / VoiceOver.
      if (code === ErrorCode.DAILY_LIMIT_REACHED) {
        setIsAtDailyLimit(true);
      } else {
        // Static copy picked by the code (AI off, too fast, still
        // answering); anything else gets the generic line.
        setStreamingError(chatRequestErrorCopy(code));
      }
      setOptimisticMessage(null);
      // The server may already have saved this turn (the chat route persists
      // the user message before streaming; an interrupt/timeout can land after
      // it, or even after the reply). Clearing the optimistic copy without a refetch hid a
      // saved question and invited a duplicate retry (R23) — reconcile.
      const convId = activeConvIdRef.current;
      const epoch = turnEpochRef.current;
      const sent = sentTurnRef.current;
      const reread =
        convId !== null
          ? queryClient
              .invalidateQueries({ queryKey: chatMessagesKey(convId) })
              .catch(() => undefined)
          : Promise.resolve();
      // If the re-read shows the server never saved the question (offline,
      // refused, or handed back), it goes back into the input: it would
      // otherwise be gone from the screen and the user would retype it.
      void reread.then(() => {
        if (turnEpochRef.current !== epoch) return;
        const draft = draftToRestore({
          sentText: sent?.text ?? null,
          lastSavedIdAtSend: sent?.lastSavedId ?? null,
          messages:
            convId !== null
              ? (queryClient.getQueryData<ChatMessage[]>(
                  chatMessagesKey(convId),
                ) ?? [])
              : [],
          currentInput: inputTextRef.current,
        });
        if (draft !== null) setInputText(draft);
      });
    },
  });

  // Accessibility announcements for streaming state
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (isStreaming && !wasStreaming) {
      // Streaming just started
      announcedTextRef.current = "";
      replyArrivedRef.current = false;
      finishedTextRef.current = "";
      AccessibilityInfo.announceForAccessibility("Coach is thinking...");
    } else if (!isStreaming && wasStreaming && replyArrivedRef.current) {
      // Streaming just finished with a reply. onDone runs in the same tick
      // that clears isStreaming, so the ref is already set when this runs.
      replyArrivedRef.current = false;
      AccessibilityInfo.announceForAccessibility(
        getStreamFinishAnnouncement(
          finishedTextRef.current,
          announcedTextRef.current,
          Platform.OS,
        ),
      );
    }
  }, [isStreaming]);

  // Announce streaming sentences progressively as they arrive (iOS VoiceOver only)
  useEffect(() => {
    if (!isStreaming || !streamingContent) return;

    const text = streamingContent;
    const startIdx = announcedOffset(text, announcedTextRef.current);
    const remaining = text.slice(startIdx);

    const boundaryMatch = remaining.match(/[.?!]\s/);
    if (!boundaryMatch || boundaryMatch.index === undefined) return;

    const endIdx = startIdx + boundaryMatch.index + 1;
    const sentence = text.slice(startIdx, endIdx).trim();

    if (sentence.length > 0) {
      announcedTextRef.current = text.slice(0, endIdx);
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

  const lastUserText = useMemo(
    () =>
      [...(messages ?? [])].reverse().find((m) => m.role === "user")?.content ??
      null,
    [messages],
  );
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

  // The saved reply has arrived: drop the live turn in this same render. It
  // is derived-state cleanup, so it runs during render (not in an effect);
  // clearing pendingSave makes turnSaved false, which ends the re-render.
  if (turnSaved) {
    setPendingSave(null);
    setOptimisticMessage(null);
  }

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

  // A newer write card locks the older ones (the server already has; this
  // shows it before the refetch). The footer's blocks count as newest.
  const { lockedMessageBlocks, lockedStreamBlocks, writeCardLists } =
    useMemo(() => {
      const ids = (messages ?? [])
        .map((m) => m.id)
        .filter((id) => messageBlocks.has(id));
      const lists = lockOlderWriteCards([
        ...ids.map((id) => messageBlocks.get(id) ?? []),
        streamBlocks,
      ]);
      return {
        lockedMessageBlocks: new Map(ids.map((id, i) => [id, lists[i]])),
        lockedStreamBlocks: lists[lists.length - 1],
        writeCardLists: lists,
      };
    }, [messages, messageBlocks, streamBlocks]);

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
      blockEntranceTotalMs(streamBlocks),
    );
    return () => clearTimeout(timer);
  }, [streamBlocksEntering, streamBlocks]);

  // Hand the blocks over to the saved copy during render (derived-state
  // cleanup, not an effect); emptying streamBlocks makes heldReplyId null,
  // which ends the re-render.
  if (heldReplyId !== null && (reducedMotion || !streamBlocksEntering)) {
    setStreamBlocks([]);
  }

  // Show interim transcript in input field while listening
  useEffect(() => {
    if (isListening && transcript) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs the speech recognizer's interim transcript into the field and its ref mirror, alongside the warm-up network call; this file is already compiler-exempt (try/finally)
      setInputText(transcript);
      // Send warm-up for interim transcript
      if (isCoachPro) {
        warmUpHook.sendWarmUp(transcript);
      }
    }
  }, [isListening, transcript, isCoachPro, warmUpHook, setInputText]);

  // A meal photo sent from the message box (Coach roadmap S1). The server
  // stores the turn and its reply (a food card) in one request, so there is
  // no stream: show the user's turn, upload, then refetch.
  // True while a typed send is still creating its conversation: no rendered
  // state shows that yet, and a photo started then would create a second one.
  const startingTurnRef = useRef(false);
  // The same fact as state, for the host: it holds its thread controls while
  // the first send is still creating the conversation (and while Regenerate
  // is deleting the last exchange), not only once the reply streams.
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const setStartingTurn = useCallback((starting: boolean) => {
    startingTurnRef.current = starting;
    setIsStartingTurn(starting);
  }, []);
  // The pending "Looking at your photo" announcement, so a send that never
  // starts (the conversation could not be created) or an unmount cancels it.
  const photoAnnounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const cancelPhotoAnnouncement = useCallback(() => {
    if (photoAnnounceTimerRef.current) {
      clearTimeout(photoAnnounceTimerRef.current);
      photoAnnounceTimerRef.current = null;
    }
  }, []);
  useEffect(() => cancelPhotoAnnouncement, [cancelPhotoAnnouncement]);
  // Whether the turn on its way is a scanned barcode (else a photo).
  const [sendingBarcode, setSendingBarcode] = useState(false);
  const { openPhotoChooser, isSendingPhoto, isPhotoBusy } = useCoachPhotoSend({
    disabled: isStreaming || isListening,
    canStart: () => !startingTurnRef.current,
    openingBriefForm:
      !conversationId && openingBrief ? openingBrief.form : undefined,
    onPickFailure: (message) => toast.error(message),
    openScanner: () => navigation.navigate("CoachBarcodeScan"),
    onStart: (kind) => {
      const isBarcode = kind === "barcode";
      setSendingBarcode(isBarcode);
      sentTurnRef.current = null;
      turnEpochRef.current += 1;
      followLatest();
      setPendingSave(null);
      setOptimisticAfter(lastSavedIdRef.current);
      setOptimisticMessage(
        isBarcode ? COACH_BARCODE_USER_TEXT : COACH_PHOTO_USER_TEXT,
      );
      setStreamBlocks([]);
      setStreamingError(null);
      setIsAtDailyLimit(false);
      ttsStop();
      // The photo and scan paths have no stream to announce their start.
      // Delayed so it is not lost under the camera or picker closing.
      cancelPhotoAnnouncement();
      photoAnnounceTimerRef.current = setTimeout(
        () =>
          AccessibilityInfo.announceForAccessibility(
            isBarcode ? "Looking up that barcode" : "Looking at your photo",
          ),
        500,
      );
    },
    ensureConversation: async () => {
      if (conversationId) return conversationId;
      try {
        return await onCreateConversation();
      } catch {
        cancelPhotoAnnouncement();
        setOptimisticMessage(null);
        setStreamingError("Couldn't start the conversation. Please try again.");
        return null;
      }
    },
    onSettled: async (convId, failure, sentBrief, replyText) => {
      // An upload that ends inside the delay (offline, a fast refusal) must
      // not announce "Looking at your photo" over its own outcome.
      cancelPhotoAnnouncement();
      activeConvIdRef.current = convId;
      if (failure?.atDailyLimit) setIsAtDailyLimit(true);
      else if (failure?.message) setStreamingError(failure.message);
      // Refetch on failure too: the server may have stored the turn before
      // the response was lost.
      const epoch = turnEpochRef.current;
      await queryClient
        .invalidateQueries({ queryKey: chatMessagesKey(convId) })
        .catch(() => undefined);
      if (turnEpochRef.current === epoch) setOptimisticMessage(null);
      // A failure is announced by the error line or the limit banner.
      if (failure) return;
      // The photo path has no stream, so nothing else says the reply is here.
      // After the refetch, so the reply is on screen when it is spoken. As
      // for a typed turn: VoiceOver hears the reply, TalkBack a short cue.
      if (turnEpochRef.current === epoch) {
        AccessibilityInfo.announceForAccessibility(
          getStreamFinishAnnouncement(replyText ?? "", "", Platform.OS),
        );
      }
      if (sentBrief) {
        // The server saved the brief and cleared its reminders.
        void queryClient.invalidateQueries({ queryKey: PENDING_REMINDERS_KEY });
        void queryClient.invalidateQueries({ queryKey: COACH_BRIEF_KEY });
      } else {
        onMessageSent?.();
      }
    },
  });

  // What the host is told (audit 2026-11-24, M24). The camera or picker
  // being open is not part of it: the thread bar is covered then.
  useEffect(() => {
    onTurnBusyChange?.(isStreaming || isSendingPhoto || isStartingTurn);
  }, [isStreaming, isSendingPhoto, isStartingTurn, onTurnBusyChange]);

  // The one busy rule for every way a turn can start (audit 2026-11-24,
  // M20/M22/M53). Read at call time: the two refs change without a render.
  const turnBlocked = useCallback(
    () =>
      turnStartBlocked({
        isStreaming,
        isSendingPhoto,
        photoBusy: isPhotoBusy(),
        startingTurn: startingTurnRef.current,
      }),
    [isStreaming, isSendingPhoto, isPhotoBusy],
  );

  const handleSend = useCallback(
    async (text?: string) => {
      // onPress/onSubmitEditing invoke this with an event object, not a string — only trust an explicit string arg (quick replies, voice).
      const content = (
        typeof text === "string" ? text : inputTextRef.current
      ).trim();
      // Covers the time the camera or picker is open, before isSendingPhoto
      // is set (a voice transcript can still finalize then), and the first
      // send that is still creating the conversation (a second tap on a
      // brief chip used to create a second conversation).
      if (!content || turnBlocked()) return;

      // Only a tap or the return key buzzes. String callers (voice, quick
      // replies, retry, suggestion hand-off) get feedback from their trigger.
      if (typeof text !== "string") {
        haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      }
      sentTurnRef.current = {
        text: content,
        lastSavedId: lastSavedIdRef.current,
      };
      setInputText("");
      turnEpochRef.current += 1;
      // Sending brings the user back to the conversation's end, even if
      // they had scrolled up to reread.
      followLatest();
      setPendingSave(null);
      setOptimisticAfter(lastSavedIdRef.current);
      setOptimisticMessage(content);
      setStreamBlocks([]);
      setStreamingError(null);
      setIsAtDailyLimit(false);
      ttsStop();

      let convId = conversationId;
      // Only the send that creates the conversation carries the brief form.
      const briefForm = !convId && openingBrief ? openingBrief.form : undefined;
      if (!convId) {
        setStartingTurn(true);
        try {
          convId = await onCreateConversation();
        } catch {
          setStartingTurn(false);
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

      setStartingTurn(false);
      activeConvIdRef.current = convId;
      const currentWarmUpId = isCoachPro ? warmUpHook.getWarmUpId() : null;
      const live = latestLiveWriteCard(writeCardLists);
      const liveEdits = live ? writeCardEdits[live.cardId] : undefined;
      startStream(convId, content, {
        warmUpId: currentWarmUpId,
        ...(briefForm && { openingBrief: briefForm }),
        writeCards: true,
        ...(live &&
          liveEdits && { liveCard: { cardId: live.cardId, edits: liveEdits } }),
      });
      warmUpHook.reset();
      if (briefForm) {
        // The server clears reminders after saving the brief; clearing them
        // from here too would race it and drop the reminder from that copy.
        briefSendRef.current = true;
      } else {
        onMessageSent?.();
      }
    },
    [
      openingBrief,
      // inputText intentionally excluded — handleSend reads the latest value
      // from inputTextRef instead so its identity (and every callback that
      // transitively depends on it: handleRetry, handleBlockAction,
      // handleQuickReply, renderItem) stays stable across keystrokes.
      turnBlocked,
      setStartingTurn,
      conversationId,
      onCreateConversation,
      warmUpHook,
      isCoachPro,
      ttsStop,
      startStream,
      onMessageSent,
      setInputText,
      haptics,
      followLatest,
      writeCardEdits,
      writeCardLists,
    ],
  );

  // Auto-send when speech finalizes
  useEffect(() => {
    if (isFinal && transcript) {
      void handleSend(transcript);
    }
  }, [isFinal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = useCallback(async () => {
    // turnBlocked: Regenerate during a photo upload used to delete the last
    // exchange and then have its resend refused.
    if (!messages || messages.length < 2 || showLiveReply || turnBlocked()) {
      return;
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    // A photo turn's text is a placeholder; there is nothing to resend.
    if (!lastUserMsg || isPhotoTurnText(lastUserMsg.content)) return;

    const msgQueryKey = chatMessagesKey(conversationId);
    const snapshot = queryClient.getQueryData<ChatMessage[]>(msgQueryKey);
    // Both rows go: the question is resent as a new turn, and a cached copy
    // left here would show it twice while the reply regenerates.
    queryClient.setQueryData<ChatMessage[]>(
      msgQueryKey,
      (old) =>
        old?.filter((m) => m.id !== lastMsg.id && m.id !== lastUserMsg.id) ??
        [],
    );

    // Nothing else may start a turn (a photo, a second tap) while the two
    // rows are being deleted: the resend below would then be refused with
    // the exchange already gone.
    setStartingTurn(true);
    try {
      // Delete assistant then user message (in order — each was "most recent" at time of delete)
      await deleteChatMessage(lastMsg.id);
      await deleteChatMessage(lastUserMsg.id);
    } catch {
      setStartingTurn(false);
      queryClient.setQueryData(msgQueryKey, snapshot);
      // The first delete may have gone through before the second failed, so
      // the snapshot can show a reply the server no longer has. Re-read.
      void queryClient.invalidateQueries({ queryKey: msgQueryKey });
      setStreamingError("Retry failed. Check your connection and try again.");
      return;
    }
    setStartingTurn(false);
    void handleSend(lastUserMsg.content);
  }, [
    messages,
    showLiveReply,
    conversationId,
    deleteChatMessage,
    queryClient,
    handleSend,
    turnBlocked,
    setStartingTurn,
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
        // Re-sending "Please log: …" only drew another unsaved proposal from
        // the coach's log tool, which pointed back at Quick Log — a loop.
        // Open Quick Log with the food filled in instead.
        navigation.navigate("QuickLog", {
          initialText: action.description as string,
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
          case "CookMode":
            // Cook mode reads its steps aloud with its own voice.
            ttsStop();
            navigation.navigate(
              "CookMode",
              params as RootStackParamList["CookMode"],
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
      } else if (action.type === "add_allergy") {
        // The editor asks for the severity; nothing is saved until the user
        // picks one. The allergen id is schema-checked upstream.
        navigation.navigate("EditDietaryProfile", {
          addAllergen: action.allergen as AllergenId,
        });
      }
    },
    [navigation, ttsStop],
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
      // Before the chip row or form is marked used: a tap that cannot send
      // must leave it in place.
      if (turnBlocked()) return;
      if (blockKey) {
        usedQuickRepliesRef.current = new Set([
          ...usedQuickRepliesRef.current,
          blockKey,
        ]);
        setQuickReplyVersion((v) => v + 1);
      }
      void handleSend(message);
    },
    [handleSend, turnBlocked],
  );

  // A finder tap sends its visible label as the message, with the action.
  const handleFinderAction = useCallback(
    (action: FinderAction, label: string) => {
      if (turnBlocked() || !conversationId) return;
      if (planUnknown && finderActionNeedsPlan(action.type)) {
        recheckPlan();
        return;
      }
      // Same tap feedback as RecipeChef's finder handler.
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      sentTurnRef.current = null;
      turnEpochRef.current += 1;
      // Sending brings the user back to the conversation's end, even if
      // they had scrolled up to reread.
      followLatest();
      setPendingSave(null);
      setOptimisticAfter(lastSavedIdRef.current);
      setOptimisticMessage(label);
      setStreamBlocks([]);
      setStreamingError(null);
      setIsAtDailyLimit(false);
      ttsStop();
      activeConvIdRef.current = conversationId;
      startStream(conversationId, label, {
        finderAction: action,
        writeCards: true,
      });
      onMessageSent?.();
    },
    [
      turnBlocked,
      conversationId,
      planUnknown,
      recheckPlan,
      haptics,
      ttsStop,
      startStream,
      onMessageSent,
      followLatest,
    ],
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
        const view = deriveMessageView(msg, {
          savedBlocks: lockedMessageBlocks.get(msg.id),
          heldReplyId,
          showLiveReply,
          lastAssistantMessageId,
          savedRecipeIds: savedRecipeIdsRef.current,
          lastUserText,
        });
        return (
          <CoachMessageRow
            message={msg}
            view={view}
            isSpeaking={
              view.isAssistant && speakingMessageId === msg.id && isSpeaking
            }
            onSpeak={ttsSpeak}
            showLiveReply={showLiveReply}
            isActive={!showLiveReply && msg.id === lastAssistantMessageId}
            usedQuickReplies={usedQuickRepliesRef.current}
            acceptedCommitments={acceptedCommitmentsRef.current}
            onBlockAction={handleBlockAction}
            onQuickReply={handleQuickReply}
            onCommitmentAccept={handleCommitmentAccept}
            lockedFinderButtons={finderLocks}
            onFinderAction={handleFinderAction}
            onLockedFinderButton={openUpgrade}
            onOpenFinderItem={handleOpenFinderItem}
            onMakeFinderItem={handleMakeFinderItem}
            makingFinderItemId={makingFinderItemId}
            expiredFinderFlowIds={expiredFinderFlowIds}
            adjustChoices={adjustChoices}
            writeCardEdits={writeCardEdits}
            onWriteCardEdit={handleWriteCardEdit}
            generated={generatedRecipes.get(msg.id)}
            isSavingRecipe={savingRecipeMessageId === msg.id}
            isRecipeFavourited={
              view.savedRecipeId !== null &&
              !!favouriteIds?.ids.some(
                (f) =>
                  f.recipeId === view.savedRecipeId &&
                  f.recipeType === "community",
              )
            }
            onSaveRecipe={(id) => void handleSaveGeneratedRecipe(id)}
            onFavouriteRecipe={handleFavouriteGeneratedRecipe}
            onRetry={handleRetry}
          />
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
      lastUserText,
      handleWriteCardEdit,
      lockedMessageBlocks,
      writeCardEdits,
      showLiveReply,
      isSpeaking,
      speakingMessageId,
      ttsSpeak,
      lastAssistantMessageId,
      heldReplyId,
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
      showLiveReply || isSendingPhoto || streamBlocks.length > 0 ? (
        <StreamingBubble
          streamingContent={streamingContent}
          statusText={
            isSendingPhoto
              ? sendingBarcode
                ? "Looking up that barcode..."
                : "Looking at your photo..."
              : statusText
          }
          isStreaming={showLiveReply || isSendingPhoto}
          streamBlocks={lockedStreamBlocks}
          writeCardEdits={writeCardEdits}
          onWriteCardEdit={handleWriteCardEdit}
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
      isSendingPhoto,
      sendingBarcode,
      streamingContent,
      statusText,
      streamBlocks,
      lockedStreamBlocks,
      writeCardEdits,
      handleWriteCardEdit,
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
          >
            <Text style={[styles.historyRetryText, { color: theme.link }]}>
              ↺ Retry
            </Text>
          </Pressable>
        </View>
      ) : null,
    [showHistoryError, refetchMessages, theme.link],
  );

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
          queryKey: chatMessagesKey(convId),
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

  // Shown while the input is empty; the send button takes their place on
  // the first keystroke. The camera is Coach Pro's: its reply is a write card.
  const micAdornment = useMemo(
    () =>
      hasVoice || isCoachPro ? (
        <View style={styles.adornments}>
          {isCoachPro ? (
            <CoachCameraButton
              onPress={openPhotoChooser}
              disabled={isStreaming || isSendingPhoto || isListening}
            />
          ) : null}
          {hasVoice ? (
            <CoachMicButton
              isListening={isListening}
              volume={volume}
              onPress={handleMicPress}
            />
          ) : null}
        </View>
      ) : null,
    [
      hasVoice,
      isCoachPro,
      isListening,
      volume,
      handleMicPress,
      openPhotoChooser,
      isStreaming,
      isSendingPhoto,
    ],
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

  // Until the server's saved copy arrives with the conversation's messages,
  // the brief draws here; then it is an ordinary assistant message.
  const showBrief = !!openingBrief && (messages?.length ?? 0) === 0;
  const briefHeader = showBrief ? (
    <OpeningBrief
      brief={openingBrief.brief}
      onShown={openingBrief.onShown}
      onSend={(text) => void handleSend(text)}
      onQuickLog={() => {
        onReminderHandled?.();
        navigation.navigate("QuickLog");
      }}
      onDismiss={onDismissReminder}
      onDrop={(id, message) => {
        // "Drop it": archive the commitment so it stops coming up, then tell
        // the coach. A failed archive still sends — the coach can follow up.
        void Promise.resolve(
          apiRequest("PATCH", `/api/coach/notebook/${id}`, {
            status: "archived",
          }),
        ).catch(() => undefined);
        void handleSend(message);
      }}
    />
  ) : null;

  return (
    <CoachChatBase
      inputText={inputText}
      onChangeText={handleChangeText}
      onSend={handleSend}
      isStreaming={isStreaming || isSendingPhoto}
      inputAdornment={micAdornment}
      // Multiline like RecipeChef and the Coach overlay: iOS offered no Paste
      // in the single-line input's long-press menu (user report 2026-09-30).
      // Return still sends.
      multilineInput
      submitOnReturn
      inputBarAlign="flex-end"
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
        ListHeaderComponent={briefHeader ?? undefined}
        ListFooterComponent={streamingFooter ?? undefined}
        ListEmptyComponent={historyErrorEmpty ?? undefined}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
        // Follow a streaming reply only while the user is at the bottom;
        // scrolling up to reread stops it and offers the jump button.
        onContentSizeChange={stickToBottom.onContentSizeChange}
        onScroll={stickToBottom.onScroll}
        onScrollBeginDrag={stickToBottom.onScrollBeginDrag}
        onScrollEndDrag={stickToBottom.onScrollEndDrag}
        onMomentumScrollBegin={stickToBottom.onMomentumScrollBegin}
        onMomentumScrollEnd={stickToBottom.onMomentumScrollEnd}
        onLayout={stickToBottom.onLayout}
        scrollEventThrottle={32}
      />
      <JumpToLatestButton
        visible={stickToBottom.showJumpToLatest}
        onPress={stickToBottom.jumpToLatest}
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
  adornments: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  messageList: { flex: 1 },
  messageContent: { padding: Spacing.md, paddingBottom: Spacing.lg },
  historyError: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  historyRetryButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center" as const,
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
