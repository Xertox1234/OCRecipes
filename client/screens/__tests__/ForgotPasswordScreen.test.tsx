// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ForgotPasswordScreen from "../ForgotPasswordScreen";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { ApiError } from "@/lib/api-error";
import * as Haptics from "expo-haptics";

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;

const { mockRequestResetCode } = vi.hoisted(() => ({
  mockRequestResetCode: vi.fn(),
}));
vi.mock("../ForgotPasswordScreen-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ForgotPasswordScreen-utils")>();
  return { ...actual, requestResetCode: mockRequestResetCode };
});

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

function renderScreen(params?: RootStackParamList["ForgotPassword"]) {
  const navigate = vi.fn();
  const replace = vi.fn();
  const route = { params } as unknown as Props["route"];
  const navigation = { navigate, replace } as unknown as Props["navigation"];
  renderComponent(
    <ForgotPasswordScreen route={route} navigation={navigation} />,
  );
  return { navigate, replace };
}

describe("ForgotPasswordScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefills the email from params", () => {
    renderScreen({ email: "a@b.com" });
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "a@b.com",
    );
  });

  it("rejects an invalid email without calling the API", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByText("Send code"));
    expect(mockRequestResetCode).not.toHaveBeenCalled();
    expect(
      screen.getAllByText("Please enter a valid email address.").length,
    ).toBeGreaterThan(0);
  });

  // Single announcement: the InlineError below the field says it; the field
  // only turns red, so VoiceOver does not read the message twice.
  it("puts the error in the accessibility tree once, not also in the field's hint", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByText("Send code"));
    const msg = "Please enter a valid email address.";
    expect(screen.getAllByText(msg)).toHaveLength(1);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-hint") ?? "").not.toContain(msg);
  });

  // #44: the red border and message used to stay after the email was fixed,
  // until the next tap of Send code.
  it("clears the error as soon as the email is edited", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByText("Send code"));
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe(
      "true",
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nope@example.com" },
    });

    expect(
      screen.queryAllByText("Please enter a valid email address."),
    ).toHaveLength(0);
    expect(
      screen.getByLabelText("Email").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("on success moves to ResetPassword with the trimmed email", async () => {
    mockRequestResetCode.mockResolvedValue(undefined);
    const { replace } = renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: " a@b.com " },
    });
    fireEvent.click(screen.getByText("Send code"));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("ResetPassword", {
        email: "a@b.com",
      }),
    );
  });

  it("on 429 stays put and shows the hourly-limit message", async () => {
    mockRequestResetCode.mockRejectedValue(
      new ApiError("x", "RATE_LIMITED", 429),
    );
    const { replace } = renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.click(screen.getByText("Send code"));
    await waitFor(() =>
      expect(
        screen.getAllByText(
          "Too many code requests. Please wait a while and try again.",
        ).length,
      ).toBeGreaterThan(0),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("Back to sign in navigates to Login", () => {
    const { navigate } = renderScreen();
    fireEvent.click(screen.getByText("Back to sign in"));
    expect(navigate).toHaveBeenCalledWith("Login");
  });
});

// A validation reject shakes the error (paired with the Error haptic it
// already fires); a server error shows copy and buzzes but does not shake.
describe("ForgotPasswordScreen — shake on validation reject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the same validation reject twice shakes twice", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nope" },
    });

    fireEvent.click(screen.getByText("Send code"));
    fireEvent.click(screen.getByText("Send code"));

    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(mockRequestResetCode).not.toHaveBeenCalled();
  });

  it("a server error buzzes but does not shake", async () => {
    mockRequestResetCode.mockRejectedValue(
      new ApiError("x", "RATE_LIMITED", 429),
    );
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.click(screen.getByText("Send code"));

    await waitFor(() =>
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Error,
      ),
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});

const fieldLabels = () =>
  screen.getAllByTestId("focus-field-label").map((n) => n.textContent);

describe("ForgotPasswordScreen — floating labels", () => {
  it("floats Email as the field name, with no repeated placeholder", () => {
    renderScreen();
    expect(fieldLabels()).toEqual(["Email"]);
    fireEvent.focus(screen.getByLabelText("Email"));
    expect(screen.queryByPlaceholderText("Email")).toBeNull();
  });
});

// Form-fields spec §5.1: no error while typing; check on leaving a field
// with text; an empty field is flagged (and focused) by Send code.
describe("ForgotPasswordScreen — validation timing", () => {
  beforeEach(() => vi.clearAllMocks());
  const MESSAGE = "Please enter a valid email address.";

  it("shows no error while an invalid email is typed, and shows it on leaving", () => {
    renderScreen();
    const input = screen.getByLabelText("Email");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "nope" } });
    expect(screen.queryAllByText(MESSAGE)).toHaveLength(0);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.blur(input);
    expect(screen.getAllByText(MESSAGE).length).toBeGreaterThan(0);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("leaving the email empty shows nothing", () => {
    renderScreen();
    const input = screen.getByLabelText("Email");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("Send code with an empty email flags the field and moves focus to it", () => {
    renderScreen();
    fireEvent.click(screen.getByText("Send code"));
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(
      screen.getAllByText("Please enter your email address.").length,
    ).toBeGreaterThan(0);
    expect(mockRequestResetCode).not.toHaveBeenCalled();
  });
});
