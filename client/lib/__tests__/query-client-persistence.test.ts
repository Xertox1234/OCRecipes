// N4: the persister dehydrates paused mutations by default, but a restored
// mutation only has a mutationFn if one was registered via setMutationDefaults
// for its key — otherwise resuming it rejects "No mutationFn found" (a
// spurious global error toast). So persist only RESUMABLE paused mutations, and
// resume them once the restore settles.
describe("persisted paused mutations (N4)", () => {
  it("persists a paused mutation only when its key has a default mutationFn", async () => {
    const { queryClient: client } = await import("../query-client");
    const { shouldDehydrateResumableMutation } = await import(
      "../query-client-persistence"
    );
    client.setMutationDefaults(["n4-resumable"], {
      mutationFn: async () => "ok",
    });
    const build = (key: string[] | undefined, isPaused: boolean) => {
      const m = client.getMutationCache().build(client, { mutationKey: key });
      m.state.isPaused = isPaused;
      return m;
    };

    expect(
      shouldDehydrateResumableMutation(build(["n4-resumable"], true)),
    ).toBe(true);
    // Paused, but nothing could resume it after a restart.
    expect(shouldDehydrateResumableMutation(build(["n4-orphan"], true))).toBe(
      false,
    );
    expect(shouldDehydrateResumableMutation(build(undefined, true))).toBe(
      false,
    );
    // Not paused (already settled / in flight) — never persisted.
    expect(
      shouldDehydrateResumableMutation(build(["n4-resumable"], false)),
    ).toBe(false);
  });

  it("releases the restore gate and resumes paused mutations once the cache is restored", async () => {
    const mod = await import("../query-client");
    const { handleQueryCacheRestored } = await import(
      "../query-client-persistence"
    );
    const resume = vi
      .spyOn(mod.queryClient, "resumePausedMutations")
      .mockResolvedValue(undefined);
    try {
      handleQueryCacheRestored();
      expect(resume).toHaveBeenCalledOnce();
      await expect(mod.whenQueryCacheRestored()).resolves.toBeUndefined();
    } finally {
      resume.mockRestore();
    }
  });
});

// R47: a failed persisted-cache restore (corrupt/oversized blob — the library
// discards the cache) was invisible off-device. The provider's onError gets no
// error argument, so report a fixed one, and still release the restore gate.
describe("query cache restore failure (R47)", () => {
  it("reports the failed restore and still releases the restore gate", async () => {
    const mod = await import("../query-client");
    const { handleQueryCacheRestoreFailed } = await import(
      "../query-client-persistence"
    );
    const { logger } = await import("../logger");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      handleQueryCacheRestoreFailed();
      expect(errorSpy).toHaveBeenCalledWith(
        "Persisted query cache restore failed; cache discarded",
        expect.any(Error),
      );
      await expect(mod.whenQueryCacheRestored()).resolves.toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// R19: a non-queue-backed mutation fired offline is PAUSED (default
// networkMode "online") — its button sits pending with no explanation. Signal
// the pause once per offline stretch so the bridge can say what is happening.
describe("paused-mutation signal (R19)", () => {
  afterEach(async () => {
    const { onlineManager } = await import("@tanstack/react-query");
    onlineManager.setOnline(true);
  });

  it("notifies once per offline stretch when a mutation pauses", async () => {
    const { onlineManager, MutationObserver } = await import(
      "@tanstack/react-query"
    );
    const { queryClient: client } = await import("../query-client");
    const { subscribeToPausedMutations } = await import(
      "../query-client-persistence"
    );
    const listener = vi.fn();
    const off = subscribeToPausedMutations(listener);
    const fire = () =>
      void new MutationObserver(client, {
        mutationFn: async () => "ok",
      })
        .mutate()
        .catch(() => {});
    try {
      onlineManager.setOnline(false);
      fire();
      fire();
      await vi.waitFor(() => expect(listener).toHaveBeenCalled());
      expect(listener).toHaveBeenCalledOnce();

      // Back online, then offline again: a new stretch notifies again.
      onlineManager.setOnline(true);
      onlineManager.setOnline(false);
      fire();
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    } finally {
      off();
      onlineManager.setOnline(true);
      client.getMutationCache().clear();
    }
  });
});
