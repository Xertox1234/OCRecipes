// @vitest-environment jsdom
import React, { useImperativeHandle } from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";

import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeImportBrowserScreen from "../RecipeImportBrowserScreen";

const {
  mockReplace,
  mockGoBack,
  mockGetState,
  mockSetOptions,
  mockRouteParams,
  mockParsePage,
  mockExtract,
  mockReload,
  webViewProps,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockGoBack: vi.fn(),
  mockGetState: vi.fn(),
  mockSetOptions: vi.fn(),
  mockRouteParams: vi.fn(),
  mockParsePage: vi.fn(),
  mockExtract: vi.fn(),
  mockReload: vi.fn(),
  webViewProps: { current: null as null | Record<string, any> },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    replace: mockReplace,
    goBack: mockGoBack,
    getState: mockGetState,
    setOptions: mockSetOptions,
    setParams: vi.fn(),
    dispatch: vi.fn(),
    addListener: vi.fn(() => () => {}),
    getParent: () => ({ navigate: vi.fn() }),
  }),
  useRoute: () => ({ params: mockRouteParams() }),
  usePreventRemove: vi.fn(),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useParseRecipeFromPage: () => ({ mutateAsync: mockParsePage }),
}));

vi.mock("@/lib/import-browser/ImportWebView", () => ({
  ImportWebView: (props: Record<string, any>) => {
    webViewProps.current = props;
    useImperativeHandle(props.ref, () => ({
      extract: mockExtract,
      reload: mockReload,
      goBack: vi.fn(),
    }));
    return <div data-testid="import-webview" />;
  },
}));

const RECIPE_BLOCK = JSON.stringify({ "@type": "Recipe", name: "Soup" });
const OTHER_BLOCK = JSON.stringify({ "@type": "WebSite" });
const NO_RECIPE_MESSAGE =
  "No recipe on this page yet — sign in or open the recipe, then try again.";

function sendBlocks(blocks: string[], url: string) {
  act(() => webViewProps.current!.onBlocks(blocks, url));
}

beforeEach(() => {
  vi.clearAllMocks();
  webViewProps.current = null;
  mockGetState.mockReturnValue({ index: 1, routes: [{}, {}] });
  mockRouteParams.mockReturnValue({
    url: "https://example.com/start",
    returnToMealPlan: { mealType: "dinner", plannedDate: "2026-11-09" },
    fromHome: undefined,
  });
});

describe("RecipeImportBrowserScreen", () => {
  it("shows the Recipe found bar only after blocks containing a Recipe arrive", () => {
    renderComponent(<RecipeImportBrowserScreen />);
    expect(screen.queryByText(/Recipe found/)).toBeNull();

    sendBlocks([OTHER_BLOCK], "https://example.com/home");
    expect(screen.queryByText(/Recipe found/)).toBeNull();

    sendBlocks([RECIPE_BLOCK], "https://example.com/soup");
    expect(screen.getByText(/Recipe found/)).toBeTruthy();
  });

  it("Import sends the latest blocks and the current page URL to parse-page and replaces to RecipeCreate", async () => {
    mockParsePage.mockResolvedValue({ title: "Soup" });
    renderComponent(<RecipeImportBrowserScreen />);
    sendBlocks([OTHER_BLOCK], "https://example.com/old");
    sendBlocks([RECIPE_BLOCK], "https://example.com/soup");

    fireEvent.click(screen.getByRole("button", { name: "Import this recipe" }));

    await waitFor(() =>
      expect(mockParsePage).toHaveBeenCalledWith({
        url: "https://example.com/soup",
        ldJson: [RECIPE_BLOCK],
      }),
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("RecipeCreate", {
        prefill: { title: "Soup" },
        returnToMealPlan: { mealType: "dinner", plannedDate: "2026-11-09" },
        fromHome: undefined,
      }),
    );
  });

  it("a double tap sends one parse-page", async () => {
    mockParsePage.mockReturnValue(new Promise(() => {}));
    renderComponent(<RecipeImportBrowserScreen />);
    sendBlocks([RECIPE_BLOCK], "https://example.com/soup");
    const button = screen.getByRole("button", { name: "Import this recipe" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockParsePage).toHaveBeenCalledTimes(1);
  });

  it("manual Import on a page with no recipe shows the message and does not call parse-page", async () => {
    renderComponent(<RecipeImportBrowserScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(mockExtract).toHaveBeenCalled();
    sendBlocks([OTHER_BLOCK], "https://example.com/login");

    await waitFor(() =>
      expect(screen.getByText(NO_RECIPE_MESSAGE)).toBeTruthy(),
    );
    expect(mockParsePage).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("manual Import uses the blocks from its own extraction", async () => {
    mockParsePage.mockResolvedValue({ title: "Soup" });
    renderComponent(<RecipeImportBrowserScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    sendBlocks([RECIPE_BLOCK], "https://example.com/soup");
    await waitFor(() =>
      expect(mockParsePage).toHaveBeenCalledWith({
        url: "https://example.com/soup",
        ldJson: [RECIPE_BLOCK],
      }),
    );
  });

  it("manual Import with no reply shows the message after the timeout", async () => {
    vi.useFakeTimers();
    try {
      renderComponent(<RecipeImportBrowserScreen />);
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(screen.getByText(NO_RECIPE_MESSAGE)).toBeTruthy();
      expect(mockParsePage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("parse-page 422 shows the message and stays on the screen", async () => {
    mockParsePage.mockRejectedValue(
      new ApiError("nope", ErrorCode.NO_RECIPE_DATA, 422),
    );
    renderComponent(<RecipeImportBrowserScreen />);
    sendBlocks([RECIPE_BLOCK], "https://example.com/soup");
    fireEvent.click(screen.getByRole("button", { name: "Import this recipe" }));

    await waitFor(() =>
      expect(screen.getByText(NO_RECIPE_MESSAGE)).toBeTruthy(),
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId("import-webview")).toBeTruthy();
  });

  it("close returns to the previous screen", () => {
    renderComponent(<RecipeImportBrowserScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it("header and Import control have accessibility labels/roles", () => {
    renderComponent(<RecipeImportBrowserScreen />);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
    expect(screen.getByText("example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(mockReload).toHaveBeenCalled();
  });

  it("shows the current domain as the user navigates", () => {
    renderComponent(<RecipeImportBrowserScreen />);
    act(() =>
      webViewProps.current!.onNavigationChange("https://www.other.com/login"),
    );
    expect(screen.getByText("www.other.com")).toBeTruthy();
  });
});
