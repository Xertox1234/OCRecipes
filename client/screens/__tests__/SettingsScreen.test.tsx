// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Alert } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import SettingsScreen from "../SettingsScreen";
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import type { ConfirmOptions } from "@/components/ConfirmationModal";

const { mockConfirm, mockLogout } = vi.hoisted(() => ({
  mockConfirm: vi.fn<(options: ConfirmOptions) => void>(),
  mockLogout: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setOptions: vi.fn() }),
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 80,
}));

vi.mock("expo-application", () => ({
  nativeApplicationVersion: "1.0.0",
  nativeBuildVersion: "1",
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock("expo-updates", () => ({
  runtimeVersion: "1.0.0",
  channel: null,
  updateId: null,
  createdAt: null,
  isEmbeddedLaunch: true,
  isEnabled: false,
  isEmergencyLaunch: false,
  emergencyLaunchReason: null,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    logout: mockLogout,
    deleteAccount: vi.fn(),
    changeEmail: vi.fn(),
    updateUser: vi.fn().mockResolvedValue(undefined),
    user: { id: 1, username: "testuser", measurementUnit: "metric" },
  }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: false }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(),
}));

// Sibling modals are exercised by their own suites — stub to keep this render
// focused on the settings list itself.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));
vi.mock("@/components/DeleteAccountModal", () => ({
  DeleteAccountModal: () => null,
}));
vi.mock("@/components/ChangeEmailModal", () => ({
  ChangeEmailModal: () => null,
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: mockConfirm,
    // Render an observable marker (not null) so the suite can assert the
    // screen actually mounts the hook's component — without this, deleting
    // <ConfirmationModal /> from the JSX would keep every test green.
    ConfirmationModal: () =>
      React.createElement("div", { "data-testid": "confirmation-modal-mount" }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsScreen sign-out confirmation", () => {
  // The sign-out confirm must go through useConfirmationModal, NEVER the
  // native Alert.alert: on the CI iOS simulator the UIAlertController renders
  // on screen but is intermittently ABSENT from the accessibility hierarchy
  // for 30s+ (issue #908, run 33935553286 attempt-1 dump: screenshot shows the
  // alert, the hierarchy dump has no alert nodes). This suite mocks the hook,
  // so it pins the CONTRACT (confirm() called, Alert.alert not, the hook's
  // component mounted); the real sheet's rendering/exposure is owned by
  // client/components/__tests__/ConfirmationModal.test.tsx.
  it("requests confirmation via the confirmation-sheet hook, not Alert.alert", () => {
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sign Out",
        message: "Are you sure you want to sign out?",
        confirmLabel: "Yes, Sign Out",
        destructive: true,
      }),
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("mounts the hook's ConfirmationModal component", () => {
    // Guards the <ConfirmationModal /> line in the JSX: confirm() presents
    // via the hook's sheetRef, which only works if the screen renders the
    // hook's component. Without this, deleting that line keeps every other
    // test here green while sign-out silently stops confirming.
    renderComponent(<SettingsScreen />);

    expect(screen.getByTestId("confirmation-modal-mount")).toBeTruthy();
  });

  it("logs out only when the sheet's confirm action fires", () => {
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    expect(mockLogout).not.toHaveBeenCalled();

    const options = mockConfirm.mock.calls[0]?.[0];
    expect(options).toBeDefined();
    options?.onConfirm();

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsScreen data export error copy", () => {
  // L4 (2026-09-23 front-end audit): performExport used to branch on
  // `/^429:/.test(error.message)`, which only matches the raw status-prefixed
  // message ApiError happens to carry today. Branching on `error.code` instead
  // is the project convention (LabelAnalysisScreen.tsx, useNutritionLookup.ts)
  // and survives a RATE_LIMITED error whose message doesn't start with "429:".
  it("shows a rate-limit-specific message when the export request is throttled", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(
      new ApiError("Too many requests", ErrorCode.RATE_LIMITED),
    );

    renderComponent(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Export My Data" }));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
    const confirmButtons = (Alert.alert as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as { text: string; onPress?: () => void }[];
    const exportButton = confirmButtons.find((b) => b.text === "Export");
    expect(exportButton).toBeDefined();
    await act(async () => {
      exportButton?.onPress?.();
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Export Failed",
        "You have already exported recently. Please wait before trying again.",
      );
    });
  });

  it("shows a generic message for a non-rate-limit export failure", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("boom"));

    renderComponent(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Export My Data" }));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
    const confirmButtons = (Alert.alert as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as { text: string; onPress?: () => void }[];
    const exportButton = confirmButtons.find((b) => b.text === "Export");
    await act(async () => {
      exportButton?.onPress?.();
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Export Failed",
        "Could not export your data. Please try again.",
      );
    });
  });
});
