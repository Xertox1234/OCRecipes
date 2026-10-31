// @vitest-environment jsdom
//
// The step-by-step New Cookbook flow: the step rules the screen enforces,
// the create-then-attach run on Review, and the create-mode behaviour that
// moved here from CookbookCreateScreen (empty name, upgrade gating, the one
// announcer per outcome, the success settle).
import React from "react";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";
import * as Haptics from "expo-haptics";

import { renderComponent } from "../../../../test/utils/render-component";
import { reactProps } from "../../../../test/utils/react-props";
import CookbookCreateWizard from "../CookbookCreateWizard";

const {
  mockGoBack,
  mockCanGoBack,
  mockPopTo,
  mockGetState,
  mockSetOptions,
  mockRouteParams,
  mockCreate,
  mockUploadCover,
  mockGenerateCover,
  mockAddRecipe,
  mockPremiumFeature,
  mockLaunchImageLibrary,
  mockToastError,
  mockToastSuccess,
  mockAnnounce,
  sources,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockPopTo: vi.fn(),
  mockGetState: vi.fn(),
  mockSetOptions: vi.fn(),
  mockRouteParams: vi.fn(),
  mockCreate: vi.fn(),
  mockUploadCover: vi.fn(),
  mockGenerateCover: vi.fn(),
  mockAddRecipe: vi.fn(),
  mockPremiumFeature: vi.fn(),
  mockLaunchImageLibrary: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockAnnounce: vi.fn(),
  sources: { favourites: [] as unknown[] },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    popTo: mockPopTo,
    getState: mockGetState,
    setOptions: mockSetOptions,
    setParams: vi.fn(),
    dispatch: vi.fn(),
    getParent: () => ({ navigate: vi.fn() }),
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

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
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
  useCreateCookbook: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUploadCookbookCover: () => ({
    mutateAsync: mockUploadCover,
    isPending: false,
  }),
  useGenerateCookbookCover: () => ({
    mutateAsync: mockGenerateCover,
    isPending: false,
  }),
  useAddRecipeToCookbook: () => ({
    mutateAsync: mockAddRecipe,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipes: () => ({
    data: sources.favourites,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useUnifiedRecipes: () => ({
    data: { community: [], personal: [], frequent: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const chicken = {
  recipeId: 11,
  recipeType: "community" as const,
  title: "Garlic Lemon Chicken",
  imageUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.mockReturnValue(undefined);
  mockCanGoBack.mockReturnValue(true);
  // Pushed onto MealPlanHome, so dismiss() is a plain goBack().
  mockGetState.mockReturnValue({
    index: 1,
    routes: [
      { key: "home-1", name: "MealPlanHome" },
      { key: "create-1", name: "CookbookCreate" },
    ],
  });
  mockPremiumFeature.mockReturnValue(true);
  mockCreate.mockResolvedValue({ id: 7, name: "Weeknight Dinners" });
  mockUploadCover.mockResolvedValue({ id: 7 });
  mockGenerateCover.mockResolvedValue({ id: 7 });
  mockAddRecipe.mockResolvedValue({});
  mockLaunchImageLibrary.mockResolvedValue({ canceled: true, assets: [] });
  sources.favourites = [chicken];
  vi.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(
    mockAnnounce,
  );
  // jsdom has no Element.scrollTo; the screen scrolls to the top on each step.
  HTMLElement.prototype.scrollTo = vi.fn();
});

function typeName(value: string) {
  fireEvent.change(screen.getByLabelText("Cookbook name"), {
    target: { value },
  });
}

function pressContinue() {
  fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
}

/** Name → Cover → Recipes (picking the chicken) → Review. */
function walkToReview({ pick = true } = {}) {
  typeName("Weeknight Dinners");
  pressContinue();
  pressContinue();
  if (pick) fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
  pressContinue();
}

describe("CookbookCreateWizard — basics", () => {
  it("Continue with an empty name flags and focuses it, buzzes, and stays on Basics", () => {
    renderComponent(<CookbookCreateWizard />);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(button);

    const name = screen.getByLabelText("Cookbook name");
    expect(screen.getByText("Enter a name for your cookbook.")).toBeTruthy();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText("Name your cookbook")).toBeTruthy();
    expect(screen.queryByText("Design your cover")).toBeNull();
  });

  it("typing a name clears the message", () => {
    renderComponent(<CookbookCreateWizard />);
    pressContinue();
    typeName("Weeknight Dinners");
    expect(screen.queryByText("Enter a name for your cookbook.")).toBeNull();
  });

  it("Next on the name focuses the description", () => {
    renderComponent(<CookbookCreateWizard />);
    const name = screen.getByLabelText("Cookbook name");
    expect(reactProps(name).returnKeyType).toBe("next");
    act(() => {
      (reactProps(name).onSubmitEditing as () => void)();
    });
    expect(document.activeElement).toBe(
      screen.getByLabelText("Description (optional)"),
    );
  });

  it("hides Back on the first step", () => {
    renderComponent(<CookbookCreateWizard />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

describe("CookbookCreateWizard — moving through the steps", () => {
  it("walks Basics → Cover → Recipes → Review, which counts the picked recipe", () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");

    pressContinue();
    expect(screen.getByText("Design your cover")).toBeTruthy();

    pressContinue();
    expect(screen.getByText("Choose your recipes")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue · 1 recipe" }),
    );

    expect(screen.getByText("Review & create")).toBeTruthy();
    expect(screen.getByText("1 recipe")).toBeTruthy();
  });

  it("Back returns to the previous step", () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Name your cookbook")).toBeTruthy();
  });

  it("won't leave Recipes with nothing picked when there are recipes to pick", () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    pressContinue();
    vi.mocked(Haptics.notificationAsync).mockClear();

    pressContinue();

    expect(screen.getByText("Pick at least one recipe.")).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText("Choose your recipes")).toBeTruthy();

    // Picking one clears the message.
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    expect(screen.queryByText("Pick at least one recipe.")).toBeNull();
  });

  it("offers to skip Recipes when there is nothing to pick", () => {
    sources.favourites = [];
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(screen.getByText("Review & create")).toBeTruthy();
  });

  it("Edit Name on Review returns to Basics with the name kept", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByLabelText("Edit Name"));

    expect(screen.getByText("Name your cookbook")).toBeTruthy();
    expect(
      (screen.getByLabelText("Cookbook name") as HTMLInputElement).value,
    ).toBe("Weeknight Dinners");
  });

  it("scrolls the body back to the top on each step change", () => {
    renderComponent(<CookbookCreateWizard />);
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();
    typeName("Weeknight Dinners");

    pressContinue();

    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });
});

describe("CookbookCreateWizard — cover", () => {
  it("opens the upgrade modal for a free user and never arms generation", async () => {
    mockPremiumFeature.mockReturnValue(false);
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();

    fireEvent.click(screen.getByLabelText("Generate with AI"));

    expect(screen.getByText("UPGRADE_MODAL")).toBeTruthy();
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();
    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockGenerateCover).not.toHaveBeenCalled();
  });

  it("uploads a picked photo against the newly created id", async () => {
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///picked.jpg" }],
    });
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();

    fireEvent.click(screen.getByLabelText("Upload a photo"));
    await waitFor(() =>
      expect(
        screen
          .getByRole("radio", { name: "Upload a photo" })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(mockLaunchImageLibrary).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.9,
    });
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();
    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() =>
      expect(mockUploadCover).toHaveBeenCalledWith({
        cookbookId: 7,
        uri: "file:///picked.jpg",
      }),
    );
    expect(mockGenerateCover).not.toHaveBeenCalled();
  });

  it("toasts when the photo library can't be opened", async () => {
    mockLaunchImageLibrary.mockRejectedValue(new Error("no permission"));
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();

    fireEvent.click(screen.getByLabelText("Upload a photo"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Couldn't open your photo library.",
      ),
    );
  });
});

describe("CookbookCreateWizard — create", () => {
  it("creates the cookbook, adds the picked recipe, toasts once and closes", async () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      name: "Weeknight Dinners",
      description: undefined,
    });
    expect(mockAddRecipe).toHaveBeenCalledWith({
      cookbookId: 7,
      recipeId: 11,
      recipeType: "community",
    });
    // The toast is the one announcer; its own haptic is off because the
    // screen already fired one.
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith("Cookbook created", {
      haptic: false,
    });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("lets the cover's success pop land before closing", async () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(mockGoBack).not.toHaveBeenCalled();
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("creates only once when Create is pressed twice", async () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    const create = screen.getByRole("button", { name: "Create Cookbook" });

    fireEvent.click(create);
    fireEvent.click(create);

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("generates the armed cover against the new id", async () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    fireEvent.click(screen.getByLabelText("Generate with AI"));
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() => expect(mockGenerateCover).toHaveBeenCalledWith(7));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("still completes, as a partial success, when a recipe can't be added", async () => {
    mockAddRecipe.mockRejectedValue(new Error("server down"));
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Cookbook created, but 1 recipe couldn't be added.",
        { haptic: false },
      ),
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Warning,
    );
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("still completes when the cover step fails after the cookbook is saved", async () => {
    mockGenerateCover.mockRejectedValue(new Error("provider down"));
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    fireEvent.click(screen.getByLabelText("Generate with AI"));
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("Cookbook created, but the cover couldn't"),
        { haptic: false },
      ),
    );
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("keeps the wizard open with an error when create fails, and lets you retry", async () => {
    mockCreate.mockRejectedValueOnce(new Error("500: boom"));
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    expect(
      await screen.findByText(
        "Couldn't create this cookbook. Please try again.",
      ),
    ).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockAddRecipe).not.toHaveBeenCalled();
    expect(screen.getByText("Review & create")).toBeTruthy();

    // The guard is released: a second press runs again.
    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
