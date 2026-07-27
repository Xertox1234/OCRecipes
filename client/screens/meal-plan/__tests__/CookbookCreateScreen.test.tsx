// @vitest-environment jsdom
//
// Net-new coverage for the cookbook cover experience. The two behaviours worth
// pinning are (a) the screen can always be left — it is reachable from Home as
// the only route in the Plan stack, where goBack() is a no-op — and (b) a
// cover failure after the cookbook row is committed must not read as "creation
// failed".
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";

import { renderComponent } from "../../../../test/utils/render-component";
import CookbookCreateScreen from "../CookbookCreateScreen";

const {
  mockNavigate,
  mockGoBack,
  mockCanGoBack,
  mockSetOptions,
  mockSetParams,
  mockParentNavigate,
  mockRouteParams,
  mockCreate,
  mockUpdate,
  mockUploadCover,
  mockGenerateCover,
  mockCookbookDetail,
  mockPremiumFeature,
  mockLaunchImageLibrary,
  mockToastError,
  mockAnnounce,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockSetOptions: vi.fn(),
  mockSetParams: vi.fn(),
  mockParentNavigate: vi.fn(),
  mockRouteParams: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockUploadCover: vi.fn(),
  mockGenerateCover: vi.fn(),
  mockCookbookDetail: vi.fn(),
  mockPremiumFeature: vi.fn(),
  mockLaunchImageLibrary: vi.fn(),
  mockToastError: vi.fn(),
  mockAnnounce: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    setOptions: mockSetOptions,
    setParams: mockSetParams,
    dispatch: vi.fn(),
    getParent: () => ({ navigate: mockParentNavigate }),
  }),
  useRoute: () => ({ params: mockRouteParams() }),
  usePreventRemove: vi.fn(),
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("expo-image", () => ({
  Image: () => null,
}));

vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibrary(...args),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: mockToastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: (key: string) => mockPremiumFeature(key),
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? React.createElement("div", null, "UPGRADE_MODAL") : null,
}));

vi.mock("@/hooks/useCookbooks", () => ({
  useCookbookDetail: () => mockCookbookDetail(),
  useCreateCookbook: () => ({
    mutateAsync: mockCreate,
    isPending: false,
  }),
  useUpdateCookbook: () => ({
    mutateAsync: mockUpdate,
    isPending: false,
  }),
  useUploadCookbookCover: () => ({
    mutateAsync: mockUploadCover,
    isPending: false,
  }),
  useGenerateCookbookCover: () => ({
    mutateAsync: mockGenerateCover,
    isPending: false,
  }),
}));

const idleDetail = {
  data: undefined,
  isError: false,
  isLoading: false,
  refetch: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.mockReturnValue(undefined);
  // Default: pushed onto an existing stack. The one-route case is opted into
  // per test.
  mockCanGoBack.mockReturnValue(true);
  mockCookbookDetail.mockReturnValue(idleDetail);
  mockPremiumFeature.mockReturnValue(true);
  mockCreate.mockResolvedValue({ id: 7, name: "Weeknight Dinners" });
  mockUploadCover.mockResolvedValue({ id: 7 });
  mockGenerateCover.mockResolvedValue({ id: 7 });
  mockLaunchImageLibrary.mockResolvedValue({ canceled: true, assets: [] });
  vi.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(
    mockAnnounce,
  );
});

/** Pull the headerLeft element the screen registered via setOptions. */
function renderHeaderLeft() {
  const call = mockSetOptions.mock.calls.at(-1)?.[0] as
    | { headerLeft?: () => React.ReactElement }
    | undefined;
  expect(call?.headerLeft).toBeTypeOf("function");
  return call!.headerLeft!();
}

function typeName(value: string) {
  const input = screen.getByLabelText("Name");
  fireEvent.change(input, { target: { value } });
}

describe("CookbookCreateScreen — leaving the screen", () => {
  it("registers an explicit close control and hides the native back button", () => {
    renderComponent(<CookbookCreateScreen />);

    const options = mockSetOptions.mock.calls.at(-1)?.[0] as {
      headerBackVisible?: boolean;
      headerLeft?: () => React.ReactElement;
    };
    expect(options.headerBackVisible).toBe(false);
    expect(options.headerLeft).toBeTypeOf("function");
  });

  it("goes back when there is a route beneath", () => {
    mockCanGoBack.mockReturnValue(true);
    renderComponent(<CookbookCreateScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByLabelText("Close without saving"));

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockParentNavigate).not.toHaveBeenCalled();
  });

  it("redirects to Home when this is the only route in the stack", () => {
    // Reached via a nested navigate from Home, this screen is the only route
    // in the Plan stack — goBack() would be a no-op and strand the user.
    mockCanGoBack.mockReturnValue(false);
    mockRouteParams.mockReturnValue({ fromHome: true });
    renderComponent(<CookbookCreateScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByLabelText("Close without saving"));

    expect(mockParentNavigate).toHaveBeenCalledWith("HomeTab");
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("still escapes on a SECOND visit, after fromHome has been cleared", () => {
    // redirectToHomeTab clears `fromHome`, so the screen sits in the Plan
    // stack without it. Returning via the Plan tab lands here again with the
    // same one-route stack — a `fromHome`-keyed check would fall through to a
    // no-op goBack() and re-create the dead end.
    mockCanGoBack.mockReturnValue(false);
    mockRouteParams.mockReturnValue(undefined);
    renderComponent(<CookbookCreateScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByLabelText("Close without saving"));

    expect(mockParentNavigate).toHaveBeenCalledWith("HomeTab");
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

describe("CookbookCreateScreen — cover generation gating", () => {
  it("opens the upgrade modal for a free user and never arms generation", () => {
    mockPremiumFeature.mockReturnValue(false);
    renderComponent(<CookbookCreateScreen />);

    fireEvent.click(screen.getByLabelText("Generate a cover, premium feature"));

    expect(screen.getByText("UPGRADE_MODAL")).toBeTruthy();
    expect(mockGenerateCover).not.toHaveBeenCalled();
  });

  it("labels the action without the premium suffix for an entitled user", () => {
    renderComponent(<CookbookCreateScreen />);

    expect(screen.getByLabelText("Generate a cover")).toBeTruthy();
  });

  it("generates immediately in edit mode", async () => {
    mockRouteParams.mockReturnValue({ cookbookId: 3 });
    mockCookbookDetail.mockReturnValue({
      ...idleDetail,
      data: {
        id: 3,
        name: "Sunday Bakes",
        description: null,
        coverImageUrl: null,
      },
    });
    renderComponent(<CookbookCreateScreen />);

    fireEvent.click(screen.getByLabelText("Generate a cover"));

    await waitFor(() => expect(mockGenerateCover).toHaveBeenCalledWith(3));
  });
});

describe("CookbookCreateScreen — create then attach", () => {
  it("creates the cookbook, then generates the armed cover", async () => {
    renderComponent(<CookbookCreateScreen />);
    typeName("Weeknight Dinners");

    fireEvent.click(screen.getByLabelText("Generate a cover"));
    fireEvent.click(screen.getByLabelText("Create cookbook"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: "Weeknight Dinners",
        description: undefined,
      }),
    );
    // Generation targets the id the create call returned.
    await waitFor(() => expect(mockGenerateCover).toHaveBeenCalledWith(7));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("uploads a picked photo against the newly created id", async () => {
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///picked.jpg" }],
    });
    renderComponent(<CookbookCreateScreen />);
    typeName("Weeknight Dinners");

    fireEvent.click(screen.getByLabelText("Add cover photo"));
    await waitFor(() => expect(mockLaunchImageLibrary).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText("Create cookbook"));

    await waitFor(() =>
      expect(mockUploadCover).toHaveBeenCalledWith({
        cookbookId: 7,
        uri: "file:///picked.jpg",
      }),
    );
    expect(mockGenerateCover).not.toHaveBeenCalled();
  });

  it("still completes when the cover step fails after the cookbook is saved", async () => {
    mockGenerateCover.mockRejectedValue(new Error("provider down"));
    renderComponent(<CookbookCreateScreen />);
    typeName("Weeknight Dinners");

    fireEvent.click(screen.getByLabelText("Generate a cover"));
    fireEvent.click(screen.getByLabelText("Create cookbook"));

    // The row is committed — the failure is reported as a cover problem, and
    // the flow completes rather than stranding the user on the form.
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Cookbook created, but the cover couldn't be added.",
      ),
    );
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockAnnounce).toHaveBeenCalledWith(
      expect.stringContaining("Cookbook created."),
    );
  });

  it("announces creation exactly once on the happy path", async () => {
    // Two announceForAccessibility calls in the same commit collide on iOS.
    renderComponent(<CookbookCreateScreen />);
    typeName("Weeknight Dinners");

    fireEvent.click(screen.getByLabelText("Create cookbook"));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith("Cookbook created");
  });
});

describe("CookbookCreateScreen — edit-mode load guard", () => {
  it("blocks saving while the cookbook fetch has failed", () => {
    // Submitting an empty form here would blank a real cookbook's fields.
    mockRouteParams.mockReturnValue({ cookbookId: 3 });
    mockCookbookDetail.mockReturnValue({
      ...idleDetail,
      isError: true,
    });
    renderComponent(<CookbookCreateScreen />);

    typeName("Anything");
    fireEvent.click(screen.getByLabelText("Save changes"));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Couldn't load this cookbook to edit. Saving is disabled until it loads.",
      ),
    ).toBeTruthy();
  });
});
