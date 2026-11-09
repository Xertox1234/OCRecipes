// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { useNotebookSaves } from "../useNotebookSaves";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockToastError } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

const ok = (body: unknown) => ({ json: () => Promise.resolve(body) });
const saves = [
  { id: 4, type: "preference", content: "You avoid dairy", label: null },
  { id: 5, type: "goal", content: "You aim for 120 g protein", label: null },
];

function setup() {
  const { wrapper, queryClient } = createQueryWrapper();
  const hook = renderHook(() => useNotebookSaves(), { wrapper });
  return { ...hook, queryClient };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useNotebookSaves", () => {
  it("shows new saves together and marks them shown", async () => {
    mockApiRequest.mockImplementation(async (method: string, url: string) =>
      url.endsWith("/unseen") ? ok({ entries: saves }) : ok({}),
    );
    const { result } = setup();
    act(() => result.current.checkForSaves());
    await flush();
    expect(result.current.saves.map((s) => s.id)).toEqual([4, 5]);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/coach/notebook/shown",
      { ids: [4, 5] },
    );
  });

  it("retries at 4 s and 10 s when nothing has landed yet, then stops", async () => {
    mockApiRequest.mockResolvedValue(ok({ entries: [] }));
    const { result } = setup();
    act(() => result.current.checkForSaves());
    await flush();
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    await flush();
    expect(mockApiRequest).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await flush();
    expect(mockApiRequest).toHaveBeenCalledTimes(3);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mockApiRequest).toHaveBeenCalledTimes(3);
  });

  it("confirm keeps the saves and clears the popup", async () => {
    mockApiRequest.mockImplementation(async (method: string, url: string) =>
      url.endsWith("/unseen") ? ok({ entries: saves }) : ok({ confirmed: 2 }),
    );
    const { result } = setup();
    act(() => result.current.checkForSaves());
    await flush();
    await act(async () => {
      result.current.confirm();
    });
    await flush();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/coach/notebook/confirm",
      { ids: [4, 5] },
    );
    expect(result.current.saves).toEqual([]);
  });

  it("undo rejects the saves; a zero count after Clear everything is not an error", async () => {
    mockApiRequest.mockImplementation(async (method: string, url: string) =>
      url.endsWith("/unseen") ? ok({ entries: saves }) : ok({ rejected: 0 }),
    );
    const { result } = setup();
    act(() => result.current.checkForSaves());
    await flush();
    await act(async () => {
      result.current.undo();
    });
    await flush();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/coach/notebook/reject",
      { ids: [4, 5] },
    );
    expect(result.current.saves).toEqual([]);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("a failed Undo says so", async () => {
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (url.endsWith("/unseen")) return ok({ entries: saves });
      if (url.endsWith("/reject")) throw new Error("500: boom");
      return ok({});
    });
    const { result } = setup();
    act(() => result.current.checkForSaves());
    await flush();
    await act(async () => {
      result.current.undo();
    });
    await flush();
    expect(mockToastError).toHaveBeenCalledWith("Couldn't undo. Try again.");
  });

  it("a failed or missing feed means no popup and no toast", async () => {
    mockApiRequest.mockRejectedValue(new Error("404: Not Found"));
    const { result } = setup();
    act(() => result.current.checkForSaves());
    await flush();
    expect(result.current.saves).toEqual([]);
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
