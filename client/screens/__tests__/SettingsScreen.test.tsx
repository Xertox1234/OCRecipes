// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Alert, Linking } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import SettingsScreen from "../SettingsScreen";
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { HEALTH_PRIVACY_POLICY_URL } from "@/constants/legal";
import { ErrorCode } from "@shared/constants/error-codes";
import type { ConfirmOptions } from "@/components/ConfirmationModal";

const {
  mockConfirm,
  mockLogout,
  mockDeleteAccount,
  mockNavigate,
  mockRefetch,
  me,
  changeEmailModal,
  deleteModal,
  mockChangeEmail,
} = vi.hoisted(() => ({
  mockChangeEmail: vi.fn(),
  mockConfirm: vi.fn<(options: ConfirmOptions) => void>(),
  mockLogout: vi.fn(),
  mockDeleteAccount: vi.fn(),
  mockNavigate: vi.fn(),
  mockRefetch: vi.fn(),
  me: {
    methods: undefined as unknown,
    isError: false,
    mfaEnabled: false,
  },
  changeEmailModal: {
    visible: false,
    props: null as null | {
      visible: boolean;
      askCode?: boolean;
      onConfirm: (
        email: string,
        password: string,
        secondFactor?: unknown,
      ) => Promise<unknown>;
    },
  },
  deleteModal: {
    props: null as null | {
      visible: boolean;
      signInMethods: unknown;
      loadError?: boolean;
      askCode?: boolean;
      onConfirm: (proof: unknown, secondFactor?: unknown) => Promise<boolean>;
    },
  },
}));

vi.mock("@/hooks/useSignInMethods", () => ({
  useSignInMethods: () => ({
    methods: me.methods,
    mfaEnabled: me.mfaEnabled,
    isError: me.isError,
    refetch: mockRefetch,
    setMethods: vi.fn(),
  }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, setOptions: vi.fn() }),
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
    deleteAccount: mockDeleteAccount,
    changeEmail: mockChangeEmail,
    updateUser: vi.fn().mockResolvedValue(undefined),
    checkAuth: mockCheckAuth,
    user: { id: 1, username: "testuser", measurementUnit: "metric" },
  }),
}));

vi.mock("@/hooks/useHealthConsent", () => ({
  useHealthConsent: () => ({
    consented: healthConsent.given,
    grant: vi.fn(),
    withdraw: mockWithdrawConsent,
  }),
}));

vi.mock("@/hooks/useAiSharing", () => ({
  useAiSharing: () => ({
    status: aiSharing.status,
    answer: mockAnswerAiSharing,
  }),
}));

vi.mock("@/navigation/openAiSharing", () => ({
  openAiSharing: mockOpenAiSharing,
}));

const { aiSharing, mockAnswerAiSharing, mockOpenAiSharing } = vi.hoisted(
  () => ({
    aiSharing: { status: { allowed: true, answered: true } },
    mockAnswerAiSharing: vi.fn(),
    mockOpenAiSharing: vi.fn(),
  }),
);

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: false }),
}));

const { healthConsent, mockWithdrawConsent, mockCheckAuth } = vi.hoisted(
  () => ({
    healthConsent: { given: false },
    mockWithdrawConsent: vi.fn(),
    mockCheckAuth: vi.fn(),
  }),
);

const { mockToast, mockClearImportBrowserData } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  mockClearImportBrowserData: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => mockToast,
}));

vi.mock("../../../modules/webview-site-data", () => ({
  clearImportBrowserData: () => mockClearImportBrowserData(),
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
  DeleteAccountModal: (props: NonNullable<typeof deleteModal.props>) => {
    deleteModal.props = props;
    return null;
  },
}));
vi.mock("@/components/ChangeEmailModal", () => ({
  ChangeEmailModal: (props: NonNullable<typeof changeEmailModal.props>) => {
    changeEmailModal.visible = props.visible;
    changeEmailModal.props = props;
    return null;
  },
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
  me.methods = {
    password: false,
    google: null,
    apple: { email: null, isPrivateRelay: true },
  };
  me.isError = false;
  changeEmailModal.visible = false;
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

describe("SettingsScreen clear site data", () => {
  it("shows the row with its subtitle", () => {
    renderComponent(<SettingsScreen />);

    expect(
      screen.getByRole("button", { name: "Clear site data" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Sign-ins to recipe sites made in OCRecipes"),
    ).toBeTruthy();
  });

  it("Clear site data asks for confirmation, then calls clearImportBrowserData", async () => {
    mockClearImportBrowserData.mockResolvedValue(true);
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Clear site data" }));

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockClearImportBrowserData).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();

    const options = mockConfirm.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({ title: "Clear site data" }),
    );
    options?.onConfirm();

    expect(mockClearImportBrowserData).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledTimes(1));
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("shows an error toast when clearing fails", async () => {
    mockClearImportBrowserData.mockResolvedValue(false);
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Clear site data" }));
    mockConfirm.mock.calls[0]?.[0]?.onConfirm();

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
    expect(mockToast.success).not.toHaveBeenCalled();
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

describe("SettingsScreen delete account", () => {
  async function openDeleteModal() {
    renderComponent(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Account" }));
    await waitFor(() => expect(deleteModal.props?.visible).toBe(true));
  }

  it("passes the account's sign-in methods to the modal", async () => {
    await openDeleteModal();
    expect(deleteModal.props?.signInMethods).toMatchObject({ password: false });
  });

  it("a cancelled Apple confirmation keeps the modal open", async () => {
    mockDeleteAccount.mockResolvedValue(false);
    await openDeleteModal();
    await act(async () => {
      await deleteModal.props?.onConfirm({ provider: "apple" });
    });
    expect(mockDeleteAccount).toHaveBeenCalledWith({ provider: "apple" });
    expect(deleteModal.props?.visible).toBe(true);
  });

  it("closes once the account is deleted", async () => {
    mockDeleteAccount.mockResolvedValue(true);
    await openDeleteModal();
    await act(async () => {
      await deleteModal.props?.onConfirm({ provider: "apple" });
    });
    expect(deleteModal.props?.visible).toBe(false);
  });
});

describe("SettingsScreen change email without a password", () => {
  it("points a password-less account to Sign-in methods instead of a password prompt", () => {
    renderComponent(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Change Email" }));
    expect(changeEmailModal.visible).toBe(false);
    const opts = mockConfirm.mock.calls[0][0];
    expect(opts.title).toMatch(/password first/i);
    act(() => opts.onConfirm());
    expect(mockNavigate).toHaveBeenCalledWith("SignInMethods");
  });

  it("a password account still gets the change-email modal", async () => {
    me.methods = { password: true, google: null, apple: null };
    renderComponent(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Change Email" }));
    await waitFor(() => expect(changeEmailModal.visible).toBe(true));
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});

describe("SettingsScreen sign-in methods failed to load", () => {
  it("retries the load when Delete Account opens, and tells the modal", async () => {
    me.methods = undefined;
    me.isError = true;
    renderComponent(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Account" }));
    await waitFor(() => expect(deleteModal.props?.visible).toBe(true));
    expect(mockRefetch).toHaveBeenCalled();
    expect(deleteModal.props?.loadError).toBe(true);
  });
});

describe("SettingsScreen — two-step verification on password proofs", () => {
  beforeEach(() => {
    me.mfaEnabled = true;
    me.methods = { password: true, google: null, apple: null };
  });
  afterEach(() => {
    me.mfaEnabled = false;
  });

  it("asks both modals for the code up front when two-step is on", () => {
    renderComponent(<SettingsScreen />);
    expect(changeEmailModal.props?.askCode).toBe(true);
    expect(deleteModal.props?.askCode).toBe(true);
  });

  it("delete forwards the code to deleteAccount", async () => {
    mockDeleteAccount.mockResolvedValue(true);
    renderComponent(<SettingsScreen />);
    await act(async () => {
      await deleteModal.props?.onConfirm(
        { password: "pw" },
        { code: "123456" },
      );
    });
    expect(mockDeleteAccount).toHaveBeenCalledWith(
      { password: "pw" },
      { code: "123456" },
    );
  });
});

// Privacy audit H2 — "no consent, no health data".
describe("SettingsScreen — withdraw health-data consent", () => {
  beforeEach(() => {
    healthConsent.given = true;
    mockWithdrawConsent.mockReset().mockResolvedValue(undefined);
    mockCheckAuth.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    healthConsent.given = false;
  });

  it("hides the row until a consent is on record", () => {
    healthConsent.given = false;
    renderComponent(<SettingsScreen />);

    expect(
      screen.queryByRole("button", { name: /Withdraw health-data consent/ }),
    ).toBeNull();
  });

  it("asks first, then withdraws, confirms it and refreshes the account", async () => {
    renderComponent(<SettingsScreen />);

    fireEvent.click(
      screen.getByRole("button", { name: /Withdraw health-data consent/ }),
    );

    expect(mockWithdrawConsent).not.toHaveBeenCalled();
    const options = mockConfirm.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        title: "Withdraw health-data consent",
        destructive: true,
      }),
    );
    options?.onConfirm();

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledTimes(1));
    expect(mockWithdrawConsent).toHaveBeenCalledTimes(1);
    expect(mockCheckAuth).toHaveBeenCalledTimes(1);
  });

  it("says so when the withdrawal fails", async () => {
    mockWithdrawConsent.mockRejectedValue(new Error("offline"));
    renderComponent(<SettingsScreen />);

    fireEvent.click(
      screen.getByRole("button", { name: /Withdraw health-data consent/ }),
    );
    mockConfirm.mock.calls[0]?.[0]?.onConfirm();

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockCheckAuth).not.toHaveBeenCalled();
  });
});

// Privacy audit H3 — the AI-sharing permission can be changed any time.
describe("SettingsScreen — AI features", () => {
  beforeEach(() => {
    aiSharing.status = { allowed: true, answered: true };
    mockAnswerAiSharing.mockReset().mockResolvedValue(undefined);
    mockOpenAiSharing.mockReset();
  });

  it("asks first, then turns AI features off", async () => {
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: /AI features/ }));

    expect(mockAnswerAiSharing).not.toHaveBeenCalled();
    const options = mockConfirm.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        title: "Turn off AI features",
        destructive: true,
      }),
    );
    options?.onConfirm();

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledTimes(1));
    expect(mockAnswerAiSharing).toHaveBeenCalledWith(false);
  });

  it("says so when turning it off fails", async () => {
    mockAnswerAiSharing.mockRejectedValue(new Error("offline"));
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: /AI features/ }));
    mockConfirm.mock.calls[0]?.[0]?.onConfirm();

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
  });

  it("opens the full question, naming the companies, when AI is off", () => {
    aiSharing.status = { allowed: false, answered: true };
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: /AI features/ }));

    expect(mockOpenAiSharing).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockAnswerAiSharing).not.toHaveBeenCalled();
  });
});

describe("SettingsScreen legal links", () => {
  it("opens the Consumer Health Data Privacy Policy", async () => {
    const openSpy = vi.spyOn(Linking, "openURL").mockResolvedValue();
    renderComponent(<SettingsScreen />);

    fireEvent.click(
      screen.getByRole("link", { name: "Consumer Health Data Privacy Policy" }),
    );

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(HEALTH_PRIVACY_POLICY_URL),
    );
    expect(HEALTH_PRIVACY_POLICY_URL).toBe(
      "https://ocrecipes.com/health-privacy",
    );
  });
});
