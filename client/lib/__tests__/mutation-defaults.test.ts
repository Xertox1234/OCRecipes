import {
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
} from "@tanstack/react-query";

import { queryClient } from "../query-client";
import { shouldDehydrateResumableMutation } from "../query-client-persistence";
import {
  TOGGLE_GROCERY_ITEM_KEY,
  TOGGLE_FAVOURITE_RECIPE_KEY,
  TOGGLE_FAVOURITE_ITEM_KEY,
  PIN_CONVERSATION_KEY,
  registerMutationDefaults,
} from "../mutation-defaults";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

// Keep the real module (the singleton registers the defaults on import) but
// stub only the network call the registered mutationFns make.
vi.mock("../query-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../query-client")>()),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const okResponse = { json: async () => ({}) };

describe("durable-resume mutation defaults", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue(okResponse);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    queryClient.getMutationCache().clear();
  });

  it.each([
    [TOGGLE_GROCERY_ITEM_KEY],
    [TOGGLE_FAVOURITE_RECIPE_KEY],
    [TOGGLE_FAVOURITE_ITEM_KEY],
    [PIN_CONVERSATION_KEY],
  ])(
    "registers a default mutationFn for %s once query-client-persistence loads",
    (key) => {
      expect(queryClient.getMutationDefaults(key).mutationFn).toBeDefined();
    },
  );

  it("a keyed toggle paused offline is dehydrated, restored into a fresh client, and replayed with its variables", async () => {
    // 1. Offline: the toggle pauses before its first attempt.
    onlineManager.setOnline(false);
    const vars = { listId: 3, itemId: 9, isChecked: true };
    void queryClient
      .getMutationCache()
      .build(queryClient, { mutationKey: TOGGLE_GROCERY_ITEM_KEY })
      .execute(vars)
      .catch(() => {});
    await vi.waitFor(() => {
      const [m] = queryClient.getMutationCache().getAll();
      expect(m.state.isPaused).toBe(true);
    });
    expect(mockApiRequest).not.toHaveBeenCalled();

    // 2. Persist with the app's gate, through JSON like AsyncStorage does.
    const persisted = JSON.parse(
      JSON.stringify(
        dehydrate(queryClient, {
          shouldDehydrateMutation: shouldDehydrateResumableMutation,
        }),
      ),
    );
    expect(persisted.mutations).toHaveLength(1);

    // 3. "Restart": a fresh client with the defaults registered, then restore.
    const fresh = new QueryClient();
    registerMutationDefaults(fresh);
    hydrate(fresh, persisted);

    // 4. Back online, the resume runs the default mutationFn with the variables.
    onlineManager.setOnline(true);
    await fresh.resumePausedMutations();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "PUT",
      "/api/meal-plan/grocery-lists/3/items/9",
      { isChecked: true },
    );
  });

  it("a restored mutation reconciles the cache through the default onSettled", async () => {
    const fresh = new QueryClient();
    registerMutationDefaults(fresh);
    const invalidate = vi.spyOn(fresh, "invalidateQueries");
    hydrate(fresh, {
      queries: [],
      mutations: [
        {
          mutationKey: [...PIN_CONVERSATION_KEY],
          state: {
            context: undefined,
            data: undefined,
            error: null,
            failureCount: 0,
            failureReason: null,
            isPaused: true,
            status: "pending",
            variables: { id: 4, isPinned: true },
            submittedAt: Date.now(),
          },
        },
      ],
    });
    await fresh.resumePausedMutations();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/chat/conversations/4/pin",
      { isPinned: true },
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations"],
    });
  });

  it("queryClient.clear() (the auth-teardown sweep) drops paused mutations so the next user never replays them", async () => {
    onlineManager.setOnline(false);
    void queryClient
      .getMutationCache()
      .build(queryClient, { mutationKey: TOGGLE_FAVOURITE_ITEM_KEY })
      .execute(5)
      .catch(() => {});
    await vi.waitFor(() =>
      expect(queryClient.getMutationCache().getAll()).toHaveLength(1),
    );

    queryClient.clear();

    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(
      dehydrate(queryClient, {
        shouldDehydrateMutation: shouldDehydrateResumableMutation,
      }).mutations,
    ).toHaveLength(0);
  });
});
