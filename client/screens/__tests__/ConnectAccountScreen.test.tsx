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
  const navigation = {
    navigate: vi.fn(),
    replace: vi.fn(),
  } as unknown as Props["navigation"];
  renderComponent(
    <ConnectAccountScreen route={route} navigation={navigation} />,
  );
  return navigation;
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

  it("puts the error in the accessibility tree once, not also in the field's hint", () => {
    renderScreen();
    fireEvent.click(screen.getByText("Connect and sign in"));
    const input = screen.getByLabelText("Password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const msg = "Please enter your password.";
    expect(screen.getAllByText(msg)).toHaveLength(1);
    expect(input.getAttribute("aria-hint") ?? "").not.toContain(msg);
  });

  it("a server error buzzes once but does not shake", async () => {
    mockLinkWithPassword.mockRejectedValue(
      new ApiError("x", "UNAUTHORIZED", 401),
    );
    renderScreen();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByText("Connect and sign in"));

    await waitFor(() =>
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1),
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});

describe("ConnectAccountScreen — two-step verification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a right password on a 2FA account replaces this screen with the code screen", async () => {
    mockLinkWithPassword.mockResolvedValue({
      status: "mfa_required",
      challenge: "c-link",
    });
    const navigation = renderScreen();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "right-pass1" },
    });
    fireEvent.click(screen.getByText("Connect and sign in"));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("TwoStepCode", {
        challenge: "c-link",
        purpose: "link",
      }),
    );
  });
});

const fieldLabels = () =>
  screen.getAllByTestId("focus-field-label").map((n) => n.textContent);

describe("ConnectAccountScreen — floating labels", () => {
  it("floats Password with no repeated placeholder", () => {
    renderScreen();
    expect(fieldLabels()).toEqual(["Password"]);
    fireEvent.focus(screen.getByLabelText("Password"));
    expect(screen.queryByPlaceholderText("Password")).toBeNull();
  });
});
