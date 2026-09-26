// @vitest-environment jsdom
/**
 * Regression test for P3-2026-09-24-mounted-chat-list-stays-stale-after-abort:
 * a conversation whose reply finished after the user left is marked stale
 * with `refetchType: "none"` (#1060/#1065), which only refetches once a query
 * observer mounts. ChatListScreen stays mounted across a stack push/pop, so
 * it needs its own focus-driven refetch to pick that reply up.
 */
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ChatListScreen from "../ChatListScreen";

const { mockRefetch, focusEffectCb } = vi.hoisted(() => ({
  // Hoisted so it stays referentially stable across renders, matching the
  // real useChatConversations().refetch (see the referential-equality-test-
  // mocks-must-match-hook-stability-profile solution doc).
  mockRefetch: vi.fn(),
  // Captures the latest callback ChatListScreen's useRefreshOnFocus passes to
  // useFocusEffect, so tests can simulate a refocus by invoking it directly.
  focusEffectCb: { current: null as (() => void) | null },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useFocusEffect: (cb: () => void) => {
    focusEffectCb.current = cb;
  },
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("@/hooks/useChat", () => ({
  useChatConversations: () => ({
    data: [],
    isLoading: false,
    refetch: mockRefetch,
    isRefetching: false,
  }),
  useCreateConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteConversation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: vi.fn(),
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  focusEffectCb.current = null;
});

describe("ChatListScreen — refetch on refocus", () => {
  it("does not refetch on the initial focus (already fresh from useQuery)", () => {
    renderComponent(<ChatListScreen />);

    expect(focusEffectCb.current).toBeTypeOf("function");
    focusEffectCb.current?.();

    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("refetches the conversation list when the screen regains focus", () => {
    renderComponent(<ChatListScreen />);

    focusEffectCb.current?.(); // initial focus (mount) — skipped
    focusEffectCb.current?.(); // returning focus — triggers a refetch

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("still renders the empty state after a refocus-triggered refetch", () => {
    // Non-vacuity control: the screen doesn't crash or blank out once the
    // focus effect wires up.
    renderComponent(<ChatListScreen />);
    focusEffectCb.current?.();
    focusEffectCb.current?.();

    expect(screen.getByText("Start a Conversation")).toBeTruthy();
  });
});
