// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import {
  useClearNotebook,
  useConfirmNotebookEntries,
  useRejectNotebookEntries,
} from "../useNotebook";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApiRequest.mockResolvedValue({ json: () => Promise.resolve({}) });
});

it.each([
  [
    useConfirmNotebookEntries,
    "POST",
    "/api/coach/notebook/confirm",
    { ids: [3] },
  ],
  [
    useRejectNotebookEntries,
    "POST",
    "/api/coach/notebook/reject",
    { ids: [3] },
  ],
] as const)(
  "%o posts ids and refreshes the notebook",
  async (hook, method, url, body) => {
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => hook(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync([3]);
    });
    expect(mockApiRequest).toHaveBeenCalledWith(method, url, body);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/coach/notebook"],
    });
  },
);

it("clear deletes everything and refreshes", async () => {
  const { wrapper } = createQueryWrapper();
  const { result } = renderHook(() => useClearNotebook(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync();
  });
  expect(mockApiRequest).toHaveBeenCalledWith("DELETE", "/api/coach/notebook");
});
