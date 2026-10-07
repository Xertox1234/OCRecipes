import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { SAVED_ITEMS_FULL_MESSAGE } from "@/lib/saved-items-full";
import {
  useAddFavouriteRecipe,
  useFavouriteRecipeIds,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import { savedRecipeIdFromMetadata } from "@/components/recipe-chat/saved-recipe-utils";
import {
  withOpacity,
  Spacing,
  BorderRadius,
  Typography,
} from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { TypingDots } from "@/components/TypingDots";
import { SendButton } from "@/components/SendButton";
import { MarkdownText } from "@/components/MarkdownText";
import { spokenMarkdown } from "@/components/markdown-text-utils";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { safeGoBack } from "@/navigation/safeGoBack";
import type { RecipeChatScreenNavigationProp } from "@/types/navigation";
import {
  useCreateConversation,
  useChatMessages,
  useSendMessage,
  useSaveRecipeFromChat,
  useMarkPendingRecipeTurn,
  type StreamingRecipe,
} from "@/hooks/useChat";
import { usePendingAssistantBridge } from "@/hooks/usePendingAssistantBridge";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { RecipeCard } from "@/components/recipe-chat/RecipeCard";
import { UpgradeModal } from "@/components/UpgradeModal";
import { RecipeFinderMessage } from "@/components/recipe-finder/RecipeFinderMessage";
import {
  finderBlockFromMessageMetadata,
  finderItemNavParams,
  lockedFinderButtons,
} from "@/components/recipe-finder/recipe-finder-utils";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import type {
  FinderAction,
  FinderBlock,
  FinderItem,
} from "@shared/schemas/recipe-finder";
import { generateRemixChips, type RemixChip } from "@/lib/remix-chips";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";

type RecipeChatRouteProp = RouteProp<RootStackParamList, "RecipeChat">;

const SUGGESTION_CHIPS = [
  {
    label: "Quick & Easy",
    emoji: "⚡",
    prompt: "Give me a quick and easy recipe I can make in under 20 minutes",
  },
  {
    label: "High Protein",
    emoji: "💪",
    prompt: "Create a high-protein meal for post-workout recovery",
  },
  {
    label: "Italian",
    emoji: "🍝",
    prompt: "Make me an authentic Italian dinner",
  },
  {
    label: "Comfort Food",
    emoji: "🍲",
    prompt: "I want something warm and comforting",
  },
  {
    label: "Kid-Friendly",
    emoji: "⭐",
    prompt: "Create a healthy kid-friendly meal",
  },
  {
    label: "Low Carb",
    emoji: "🥗",
    prompt: "Give me a delicious low-carb dinner option",
  },
  {
    label: "Budget Friendly",
    emoji: "💵",
    prompt: "Create a tasty meal using affordable ingredients",
  },
  {
    label: "Date Night",
    emoji: "🕯",
    prompt: "Create an impressive dinner for two",
  },
];

const stripStreamingRecipeJson = (content: string) =>
  content.replace(/\n*```json[\s\S]*$/, "").trimEnd();

const RecipeStreamingFooter = React.memo(function RecipeStreamingFooter({
  content,
  recipe,
  status,
}: {
  content: string;
  recipe: StreamingRecipe | null;
  /** Recipe finder progress ("Searching community recipes…"). */
  status: string | null;
}) {
  const { theme } = useTheme();

  // The thinking bubble's polite live region carries a status change on
  // Android only; iOS needs the imperative announce.
  useEffect(() => {
    if (status && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(status);
    }
  }, [status]);

  return (
    <View>
      {content ? (
        <View
          style={[
            styles.messageBubble,
            styles.assistantBubble,
            { backgroundColor: withOpacity(theme.text, 0.06) },
          ]}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`RecipeChef: ${spokenMarkdown(content)}`}
        >
          <MarkdownText style={{ ...Typography.body, color: theme.text }}>
            {content}
          </MarkdownText>
        </View>
      ) : (
        <View
          style={[
            styles.messageBubble,
            styles.assistantBubble,
            styles.thinkingRow,
            { backgroundColor: withOpacity(theme.text, 0.06) },
          ]}
          accessible
          accessibilityRole="text"
          accessibilityLabel={status ?? "RecipeChef is thinking"}
          accessibilityLiveRegion="polite"
        >
          <TypingDots color={theme.textSecondary} />
          {status ? (
            <ThemedText style={{ color: theme.textSecondary }}>
              {status}
            </ThemedText>
          ) : null}
        </View>
      )}
      {recipe && (
        <RecipeCard
          recipe={recipe}
          isImageLoading={recipe.imageUrl === undefined}
          isSaved={false}
          isSaving={false}
        />
      )}
    </View>
  );
});

// Module-level so its identity is stable in usePendingAssistantBridge's deps.
function hasPendingRecipeReply(value: {
  content: string;
  recipe: StreamingRecipe | null;
  finder: FinderBlock | null;
}): boolean {
  return !!value.content || !!value.recipe || !!value.finder;
}

export default function RecipeChatScreen() {
  const route = useRoute<RecipeChatRouteProp>();
  const navigation = useNavigation<RecipeChatScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const flatListRef = useRef<FlatList>(null);

  // Remix mode detection
  // In-app navigation passes a number; anything else (e.g. a link's string or
  // array, which linking.ts strips anyway) is not remix mode.
  const routeRemixId: unknown = route.params?.remixSourceRecipeId;
  const remixSourceRecipeId =
    typeof routeRemixId === "number" ? routeRemixId : undefined;
  const isRemixMode = !!remixSourceRecipeId;
  const remixSourceRecipeTitle = route.params?.remixSourceRecipeTitle;

  const [conversationId, setConversationId] = useState<number | null>(
    route.params?.conversationId ?? null,
  );
  const [inputText, setInputText] = useState("");
  const [hasStarted, setHasStarted] = useState(!!route.params?.conversationId);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );

  const createConversation = useCreateConversation();

  // Fetch user dietary profile for remix chip generation
  const { data: userProfile } = useQuery<{
    allergies?: { name: string; severity: "mild" | "moderate" | "severe" }[];
    dietType?: string | null;
  }>({
    queryKey: QUERY_KEYS.dietaryProfile,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user/dietary-profile");
      return res.json();
    },
    enabled: isRemixMode,
  });

  // Fetch source recipe ingredients for chip generation
  const { data: sourceRecipe } = useQuery<{
    ingredients: { name: string; quantity: string; unit: string }[];
    dietTags?: string[];
  }>({
    queryKey: [`/api/recipes/${remixSourceRecipeId}`],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/recipes/${remixSourceRecipeId}`,
      );
      return res.json();
    },
    enabled: isRemixMode && !!remixSourceRecipeId,
  });

  // Generate dynamic remix chips
  const remixChips = useMemo<RemixChip[]>(() => {
    if (!isRemixMode || !sourceRecipe) return [];
    return generateRemixChips(sourceRecipe, userProfile);
  }, [isRemixMode, sourceRecipe, userProfile]);
  // Poll while THIS conversation has an outstanding server-side turn from an
  // earlier abort (see useMarkPendingRecipeTurn below) — the recipe/remix
  // finish-and-save policy can still be generating when the user reopens.
  const { data: messages = [] } = useChatMessages(conversationId, undefined, {
    pollPendingRecipeTurn: true,
  });
  const {
    sendMessage,
    abortStream,
    streamingContent,
    streamingRecipe,
    streamingFinder,
    streamingStatus,
    isStreaming,
    streamError,
    requestError,
  } = useSendMessage(conversationId);
  const markPendingRecipeTurn = useMarkPendingRecipeTurn();
  const saveRecipeMutation = useSaveRecipeFromChat();
  // messageId → the community recipe id it was saved as (this session).
  const savedMessageIdsRef = useRef(new Map<number, number>());
  const { data: favouriteIds } = useFavouriteRecipeIds();
  const { mutate: toggleFavourite } = useToggleFavouriteRecipe();
  const addFavourite = useAddFavouriteRecipe();
  const [, forceRender] = useState(0);

  const assistantMessageCount = messages.filter(
    (m) => m.role === "assistant",
  ).length;
  // Stripped once and reused for both the pending-bubble snapshot below and
  // the live streaming footer's display content further down.
  const strippedStreamingContent = useMemo(
    () => stripStreamingRecipeJson(streamingContent),
    [streamingContent],
  );
  // Memoized so the bridge's effect deps stay stable across unrelated
  // re-renders (e.g. typing in the input) instead of a fresh object every
  // render — see docs/solutions/conventions/per-render-object-into-effect-deps-dry-trap-2026-07-17.md.
  const pendingStreamingValue = useMemo(
    () => ({
      content: strippedStreamingContent,
      recipe: streamingRecipe,
      finder: streamingFinder,
    }),
    [strippedStreamingContent, streamingRecipe, streamingFinder],
  );
  const pendingAssistantMessage = usePendingAssistantBridge<{
    content: string;
    recipe: StreamingRecipe | null;
    finder: FinderBlock | null;
  }>({
    isStreaming,
    streamingValue: pendingStreamingValue,
    // Gate on the RAW content (as before the extraction): stripping a stream
    // that is only an opening ```json fence yields "", and a stripped-basis
    // gate would skip that tick and keep an earlier fragment.
    hasStreamingValue:
      !!streamingContent || !!streamingRecipe || !!streamingFinder,
    isPresent: hasPendingRecipeReply,
    hasError: !!streamError || !!requestError,
    assistantMessageCount,
    announce: { message: "Recipe response received", always: false },
  });

  // Clear optimistic user message once streaming completes
  useEffect(() => {
    if (!isStreaming) setPendingUserMessage(null);
  }, [isStreaming]);

  // isStreaming and conversationId mirrored to refs so the unmount cleanup
  // below reads their freshest values without needing either in the effect's
  // own deps (see docs/rules/hooks.md). conversationId specifically must NOT
  // be a dep: handleSend calls setConversationId(convId) immediately before
  // (no await between) `void sendMessage(...)` for a brand-new chat, so a
  // conversationId dep would rerun this cleanup on that transition — not
  // just at real unmount — aborting the just-started XHR before it can
  // stream anything.
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // Generation keeps running server-side after this screen goes away
  // (recipe/remix finish-and-save policy) — abort our own dead XHR so it
  // stops driving local state, and let useSendMessage mark the conversation
  // stale so returning to it refetches the finished reply instead of a
  // pre-settle cache (same pattern as CoachOverlayContent / CoachChat, #1060).
  // When a generation was actually in flight, also mark this conversation
  // pending so ChatListScreen (and a later reopen of this same screen) poll
  // for the finished reply instead of waiting out the fixed settle margin,
  // which recipe/remix generation can outlast by a wide margin.
  useEffect(() => {
    return () => {
      abortStream();
      if (isStreamingRef.current && conversationIdRef.current) {
        markPendingRecipeTurn(conversationIdRef.current);
      }
    };
  }, [abortStream, markPendingRecipeTurn]);

  useEffect(() => {
    if (!isStreaming) return;
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
  }, [isStreaming]);

  /** Resolves the saved community recipe id, or null if the save failed. */
  const handleSaveRecipe = useCallback(
    async (messageId: number): Promise<number | null> => {
      if (!conversationId) return null;
      const known = savedMessageIdsRef.current.get(messageId);
      if (known !== undefined) return known;
      try {
        const saved = await saveRecipeMutation.mutateAsync({
          conversationId,
          messageId,
        });
        savedMessageIdsRef.current.set(messageId, saved.id);
        forceRender((n) => n + 1);
        haptics.notification(Haptics.NotificationFeedbackType.Success);
        if (saved.savedItemStatus === "limit_reached") {
          // The toast announces itself; one message, not two.
          toast.info(SAVED_ITEMS_FULL_MESSAGE);
        } else {
          AccessibilityInfo.announceForAccessibility("Recipe saved");
        }
        return saved.id;
      } catch {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        AccessibilityInfo.announceForAccessibility("Couldn't save recipe");
        return null;
      }
    },
    [conversationId, saveRecipeMutation, haptics, toast],
  );

  // The card's heart (ruling 2026-09-29): toggles the saved copy; on an
  // unsaved recipe it saves first, then favourites without ever toggling off.
  const handleFavouriteRecipe = useCallback(
    async (messageId: number, savedRecipeId: number | null) => {
      if (savedRecipeId !== null) {
        toggleFavourite({ recipeId: savedRecipeId, recipeType: "community" });
        return;
      }
      const id = await handleSaveRecipe(messageId);
      if (id === null) return;
      try {
        await addFavourite({ recipeId: id, recipeType: "community" });
      } catch {
        // useToggleFavouriteRecipe surfaces its own failures; the save stands.
      }
    },
    [toggleFavourite, handleSaveRecipe, addFavourite],
  );

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text || inputText).trim();
      if (!content || isStreaming) return;

      setInputText("");
      setHasStarted(true);
      setPendingUserMessage(content);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);

      let convId = conversationId;
      if (!convId) {
        try {
          const conv = await createConversation.mutateAsync(
            isRemixMode
              ? {
                  type: "remix",
                  sourceRecipeId: remixSourceRecipeId,
                }
              : {
                  title: "New Recipe Chat",
                  type: "recipe",
                },
          );
          convId = conv.id;
          setConversationId(convId);
        } catch {
          setPendingUserMessage(null);
          return;
        }
      }

      void sendMessage(content, undefined, convId);
    },
    [
      inputText,
      isStreaming,
      conversationId,
      createConversation,
      sendMessage,
      isRemixMode,
      remixSourceRecipeId,
      haptics,
    ],
  );

  const canSearchOnline = usePremiumFeature("catalogSave");
  const canGenerate = usePremiumFeature("recipeGeneration");
  const finderLocks = useMemo(
    () => lockedFinderButtons({ canSearchOnline, canGenerate }),
    [canSearchOnline, canGenerate],
  );
  const [showUpgrade, setShowUpgrade] = useState(false);

  // A finder tap sends its visible label as the message, with the action.
  const handleFinderAction = useCallback(
    (action: FinderAction, label: string) => {
      if (!conversationId || isStreaming) return;
      setPendingUserMessage(label);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      void sendMessage(label, undefined, conversationId, {
        finderAction: action,
      });
    },
    [conversationId, isStreaming, sendMessage, haptics],
  );

  const handleOpenFinderItem = useCallback(
    (item: FinderItem) => {
      navigation.navigate("FeaturedRecipeDetail", finderItemNavParams(item));
    },
    [navigation],
  );

  const openUpgrade = useCallback(() => setShowUpgrade(true), []);

  // Auto-send a prefilled request once (Home's Generate Recipe drawer, or a
  // Coach navigate action) — same one-shot guard as ChatScreen's.
  // Only a string is ever sent. linking.ts strips this param from links, but
  // a repeated query key would arrive as an array; never hand that to send.
  const routeInitialMessage: unknown = route.params?.initialMessage;
  const initialMessage =
    typeof routeInitialMessage === "string" ? routeInitialMessage : undefined;
  const didSendInitialRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !didSendInitialRef.current) {
      didSendInitialRef.current = true;
      void handleSend(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  const handleChipPress = useCallback(
    (prompt: string) => {
      void handleSend(prompt);
    },
    [handleSend],
  );

  // Build display messages from fetched messages + low-frequency optimistic/error state.
  // Streaming assistant content renders in ListFooterComponent so token updates
  // do not invalidate visible FlatList rows.
  const displayMessages = React.useMemo(() => {
    // System messages are internal AI context — never show in the chat UI
    const msgs = messages.filter((m) => m.role !== "system");

    // Optimistic user message: show the sent text immediately before the server
    // persists it, so the UI doesn't appear blank while awaiting the first response.
    // Only shown when streaming and the message isn't yet in the DB query result.
    if (pendingUserMessage && isStreaming) {
      const lastUserMsg = msgs.filter((m) => m.role === "user").at(-1);
      if (lastUserMsg?.content !== pendingUserMessage) {
        msgs.push({
          id: -3,
          conversationId: conversationId ?? 0,
          role: "user",
          content: pendingUserMessage,
          metadata: null,
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (pendingAssistantMessage) {
      msgs.push({
        id: -5,
        conversationId: conversationId ?? 0,
        role: "assistant",
        content: pendingAssistantMessage.content,
        metadata: pendingAssistantMessage.recipe
          ? { recipe: pendingAssistantMessage.recipe }
          : pendingAssistantMessage.finder
            ? { metadataVersion: 1, finder: pendingAssistantMessage.finder }
            : null,
        createdAt: new Date().toISOString(),
      });
    }

    // Show request errors (e.g. premium gate) as an inline error message
    if (requestError) {
      msgs.push({
        id: -2,
        conversationId: conversationId ?? 0,
        role: "assistant",
        content: requestError,
        metadata: { isError: true },
        createdAt: new Date().toISOString(),
      });
    }

    // Show dropped-connection error as an inline bubble. No partial content
    // is ever shown here — the pending-assistant bridge above deliberately
    // skips creating a bubble on `streamError` (see
    // usePendingAssistantBridge's `hasError` gate), so this static copy must
    // not claim otherwise (same fix as ChatScreen's toast, P2-2026-09-23).
    if (streamError) {
      msgs.push({
        id: -4,
        conversationId: conversationId ?? 0,
        role: "assistant",
        content: "Response interrupted. Try sending again.",
        metadata: { isError: true },
        createdAt: new Date().toISOString(),
      });
    }

    return msgs;
  }, [
    messages,
    isStreaming,
    conversationId,
    requestError,
    streamError,
    pendingUserMessage,
    pendingAssistantMessage,
  ]);

  // Only the newest assistant reply's finder buttons are live (spec §4);
  // error bubbles (-2, -4) never count as the newest reply.
  const activeFinderMessageId = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i];
      const meta = m.metadata as Record<string, unknown> | null;
      if (m.role === "assistant" && !meta?.isError) return m.id;
    }
    return null;
  }, [displayMessages]);

  const renderMessage = useCallback(
    ({ item }: { item: (typeof displayMessages)[0] }) => {
      const isUser = item.role === "user";
      const metadata = item.metadata as Record<string, unknown> | null;
      const storedRecipe = metadata?.recipe as StreamingRecipe | undefined;
      // A persisted recipe message keeps its image at the top level of
      // metadata (recipeChatMetadataSchema), not in metadata.recipe — the
      // recipe streams before its image. The pending bubble has no top-level
      // key, so its streamed recipe.imageUrl stands.
      const recipe =
        storedRecipe && metadata && "imageUrl" in metadata
          ? {
              ...storedRecipe,
              imageUrl: metadata.imageUrl as string | null,
            }
          : storedRecipe;
      const allergenWarning = metadata?.allergenWarning as string | undefined;
      const isError = !!metadata?.isError;
      // A finder message's text is the old-client fallback; the block replaces it.
      const finder = finderBlockFromMessageMetadata(metadata);
      const isPendingAssistant = item.id === -5;
      const savedRecipeId =
        savedMessageIdsRef.current.get(item.id) ??
        savedRecipeIdFromMetadata(metadata);
      const isAlreadySaved = savedRecipeId !== null;
      const isFavourited =
        savedRecipeId !== null &&
        !!favouriteIds?.ids.some(
          (f) => f.recipeId === savedRecipeId && f.recipeType === "community",
        );
      // Only assistant prose (not the user's own typed text, not an
      // app-authored error message) is model output that needs markdown
      // stripped for both what's shown and what's spoken.
      const isAssistantProse = !isUser && !isError;

      return (
        <View>
          {/* Text bubble — or typing indicator while waiting for first token */}
          {item.content && !finder ? (
            <View
              style={[
                styles.messageBubble,
                isUser
                  ? [styles.userBubble, { backgroundColor: theme.accentSolid }]
                  : isError
                    ? [
                        styles.assistantBubble,
                        {
                          backgroundColor: withOpacity(theme.error, 0.1),
                          borderWidth: 1,
                          borderColor: withOpacity(theme.error, 0.3),
                        },
                      ]
                    : [
                        styles.assistantBubble,
                        {
                          backgroundColor: withOpacity(theme.text, 0.06),
                        },
                      ],
              ]}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${isUser ? "You" : isError ? "Error" : "RecipeChef"}: ${
                isAssistantProse ? spokenMarkdown(item.content) : item.content
              }`}
            >
              {isAssistantProse ? (
                <MarkdownText style={{ ...Typography.body, color: theme.text }}>
                  {item.content}
                </MarkdownText>
              ) : (
                <ThemedText
                  style={[
                    isUser ? { color: theme.buttonText } : undefined,
                    isError ? { color: theme.error } : undefined,
                  ]}
                >
                  {item.content}
                </ThemedText>
              )}
            </View>
          ) : null}

          {/* Recipe card (if present in metadata) */}
          {recipe && (
            <RecipeCard
              recipe={recipe}
              allergenWarning={allergenWarning}
              isImageLoading={
                isPendingAssistant && recipe.imageUrl === undefined
              }
              isSaved={isPendingAssistant ? false : isAlreadySaved}
              isSaving={
                !isPendingAssistant &&
                saveRecipeMutation.isPending &&
                !isAlreadySaved
              }
              onSave={
                isPendingAssistant ? undefined : () => handleSaveRecipe(item.id)
              }
              isFavourited={isFavourited}
              onFavourite={
                isPendingAssistant
                  ? undefined
                  : () => void handleFavouriteRecipe(item.id, savedRecipeId)
              }
            />
          )}

          {finder ? (
            <RecipeFinderMessage
              block={finder}
              content={item.content}
              isActive={!isStreaming && item.id === activeFinderMessageId}
              announceArrival={!isPendingAssistant}
              lockedButtons={finderLocks}
              onAction={handleFinderAction}
              onLockedButton={openUpgrade}
              onOpenItem={handleOpenFinderItem}
            />
          ) : null}
        </View>
      );
    },
    [
      theme,
      saveRecipeMutation.isPending,
      handleSaveRecipe,
      handleFavouriteRecipe,
      favouriteIds,
      isStreaming,
      activeFinderMessageId,
      finderLocks,
      handleFinderAction,
      openUpgrade,
      handleOpenFinderItem,
    ],
  );

  const streamingFooter = isStreaming ? (
    <RecipeStreamingFooter
      content={strippedStreamingContent}
      recipe={streamingRecipe}
      status={streamingStatus}
    />
  ) : null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
      accessibilityViewIsModal
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + Spacing.xs,
            borderBottomColor: withOpacity(theme.text, 0.08),
          },
        ]}
      >
        <Pressable
          onPress={() =>
            safeGoBack(navigation, () =>
              navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
            )
          }
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.headerButton}
        >
          <Feather name="x" size={22} color={theme.text} />
        </Pressable>
        <ThemedText type="body">
          {isRemixMode ? "Recipe Remix" : "Recipe Chat"}
        </ThemedText>
        <View style={styles.headerButton} />
      </View>

      {/* Messages or Empty State */}
      {!hasStarted ? (
        <View style={styles.emptyState}>
          <View
            style={[
              styles.iconWrapper,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
          >
            <Feather
              name={isRemixMode ? "shuffle" : "book-open"}
              size={32}
              color={theme.link}
            />
          </View>
          <ThemedText
            type="h3"
            style={{ textAlign: "center", marginTop: Spacing.md }}
            accessibilityRole="header"
          >
            {isRemixMode
              ? `Remix ${remixSourceRecipeTitle ?? "Recipe"}`
              : "What would you like to cook?"}
          </ThemedText>
          <ThemedText
            type="body"
            style={{
              textAlign: "center",
              color: theme.textSecondary,
              marginTop: Spacing.xs,
            }}
          >
            {isRemixMode
              ? "Choose a modification or describe what you'd like to change"
              : "Describe a recipe, upload a photo of ingredients, or pick a suggestion below"}
          </ThemedText>

          {/* Suggestion Chips */}
          {isRemixMode ? (
            /* Remix: horizontal scroll (dynamic chip count) */
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsScrollContent}
              style={{ marginTop: Spacing.lg, alignSelf: "stretch" }}
              accessible
              accessibilityRole="none"
              accessibilityLabel="Remix suggestions"
            >
              {remixChips.map((chip) => (
                <Pressable
                  key={chip.label}
                  onPress={() => handleChipPress(chip.prompt)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: withOpacity(theme.link, 0.08),
                      borderColor: withOpacity(theme.link, 0.2),
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Suggested prompt: ${chip.label}`}
                >
                  <ThemedText
                    type="caption"
                    style={{ color: theme.link, fontWeight: "600" }}
                  >
                    {chip.label}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            /* Default: 2-column wrapping grid — all chips visible, no scroll */
            <View
              style={styles.chipsGrid}
              accessible
              accessibilityRole="none"
              accessibilityLabel="Suggested prompts"
            >
              {SUGGESTION_CHIPS.map((chip) => (
                <Pressable
                  key={chip.label}
                  onPress={() => handleChipPress(chip.prompt)}
                  style={[
                    styles.chip,
                    styles.chipGridItem,
                    {
                      backgroundColor: withOpacity(theme.link, 0.08),
                      borderColor: withOpacity(theme.link, 0.2),
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Suggested prompt: ${chip.label}`}
                >
                  <Text style={styles.chipEmoji}>{chip.emoji}</Text>
                  <ThemedText
                    type="caption"
                    style={{
                      color: theme.link,
                      fontWeight: "600",
                      flexShrink: 1,
                    }}
                    numberOfLines={1}
                  >
                    {chip.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          renderItem={renderMessage}
          keyExtractor={(item) => {
            if (item.id === -2) return "error";
            if (item.id === -3) return "pending-user";
            if (item.id === -4) return "stream-error";
            if (item.id === -5) return "pending-assistant";
            return item.id.toString();
          }}
          contentContainerStyle={[
            styles.messageList,
            { paddingBottom: Spacing.md },
          ]}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          keyboardDismissMode="interactive"
          {...FLATLIST_DEFAULTS}
          ListFooterComponent={streamingFooter}
        />
      )}

      {/* Input Bar */}
      <View
        style={[
          styles.inputBar,
          {
            paddingBottom: Math.max(insets.bottom, Spacing.sm),
            borderTopColor: withOpacity(theme.text, 0.08),
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <TextInput
          value={inputText}
          onChangeText={setInputText}
          placeholder={
            isRemixMode
              ? "Describe what you'd like to change..."
              : "Describe what you want to cook..."
          }
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.textInput,
            {
              backgroundColor: withOpacity(theme.text, 0.06),
              color: theme.text,
            },
          ]}
          multiline
          maxLength={2000}
          editable={!isStreaming}
          onSubmitEditing={() => handleSend()}
          returnKeyType="send"
          blurOnSubmit
          accessibilityLabel="Recipe request"
          accessibilityHint="Describe what you want to cook"
        />
        <SendButton
          onPress={() => handleSend()}
          canSend={inputText.trim().length > 0}
          busy={isStreaming}
        />
      </View>
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  iconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  chipsScrollContent: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    alignItems: "flex-start",
  },
  chipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    width: "100%",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  chipGridItem: {
    flexBasis: "47%",
    flexGrow: 1,
    flexShrink: 1,
  },
  chipEmoji: {
    fontSize: 15,
  },
  messageList: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  messageBubble: {
    maxWidth: "80%",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.sm,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: BorderRadius.xs,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: BorderRadius.xs,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: BorderRadius.card,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
  },
});
