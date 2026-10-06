// @vitest-environment jsdom
import React from "react";
import { Alert } from "react-native";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";

import TasteProfileScreen from "../TasteProfileScreen";

const { mockGoBack, mockApiRequest, mockToastSuccess, mockToastError } =
  vi.hoisted(() => ({
    mockGoBack: vi.fn(),
    mockApiRequest: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastError: vi.fn(),
  }));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  }),
}));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
// The grid's rendering is irrelevant here; one button stands in for a tap on
// a recipe tile so the Save button becomes enabled (it needs a dirty pick).
vi.mock("@/components/TastePicksGrid", () => ({
  TastePicksGrid: ({ onToggle }: { onToggle: (id: number) => void }) => (
    <button aria-label="Toggle recipe 1" onClick={() => onToggle(1)} />
  ),
}));

function mockRequests(putResult: "ok" | "fail") {
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === "GET" && url === "/api/taste-picks") {
      return { json: async () => ({ picks: [] }) };
    }
    if (method === "GET" && url.startsWith("/api/taste-picks/candidates")) {
      return { json: async () => ({ candidates: [], total: 0, page: 1 }) };
    }
    if (method === "PUT" && url === "/api/taste-picks") {
      if (putResult === "fail") throw new Error("500");
      return { json: async () => ({}) };
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
}

async function pickAndSave() {
  renderComponent(<TasteProfileScreen />);
  fireEvent.click(await screen.findByLabelText("Toggle recipe 1"));
  fireEvent.click(screen.getByLabelText("Save Changes"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TasteProfileScreen — save feedback", () => {
  it("a successful save toasts once and closes", async () => {
    mockRequests("ok");

    await pickAndSave();

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledOnce();
    });
    expect(mockToastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Taste picks saved",
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("a failed save shows an error toast, stays open, and no Alert", async () => {
    mockRequests("fail");
    const alertSpy = vi.spyOn(Alert, "alert");

    await pickAndSave();

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledExactlyOnceWith(
        "Couldn't save your picks. Please try again.",
      );
    });
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
