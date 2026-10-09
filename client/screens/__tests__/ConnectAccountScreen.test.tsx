// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { renderComponent } from "../../../test/utils/render-component";
import ConnectAccountScreen from "../ConnectAccountScreen";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { ApiError } from "@/lib/api-error";

type Props = NativeStackScreenProps<RootStackParamList, "ConnectAccount">;

const { withSequenceSpy, mockLinkWithPassword } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
  mockLinkWithPassword: vi.fn(),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    linkWithPassword: mockLinkWithPassword,
    linkWithProvider: vi.fn(),
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

// react-native-keyboard-controller ships untransformed native source — passthrough.
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("div", props, children),
}));

function renderScreen() {
  const route = {
    params: { ticket: "t-1", methods: ["password"], email: "a@b.com" },
  } as unknown as Props["route"];
  const navigation = { navigate: vi.fn() } as unknown as Props["navigation"];
  return renderComponent(
    <ConnectAccountScreen route={route} navigation={navigation} />,
  );
}

// A validation reject shakes the error and buzzes; a server error buzzes
// but does not shake.
describe("ConnectAccountScreen — shake on validation reject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an empty password twice shakes twice and buzzes twice", () => {
    renderScreen();

    fireEvent.click(screen.getByText("Connect and sign in"));
    fireEvent.click(screen.getByText("Connect and sign in"));

    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(mockLinkWithPassword).not.toHaveBeenCalled();
  });

  it("a server error buzzes once but does not shake", async () => {
    mockLinkWithPassword.mockRejectedValue(
      new ApiError("x", "UNAUTHORIZED", 401),
    );
    renderScreen();
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByText("Connect and sign in"));

    await waitFor(() =>
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1),
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});
