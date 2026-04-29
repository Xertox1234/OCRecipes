import { describe, it, expect } from "vitest";
import { createSessionStore, type SessionStoreOptions } from "../sessions";

interface TestSession {
  userId: string;
  createdAt: number;
  data: string;
}

const defaultOpts: SessionStoreOptions = {
  maxPerUser: 2,
  maxGlobal: 5,
  timeoutMs: 60_000,
  label: "test",
};

function makeStore(opts: Partial<SessionStoreOptions> = {}) {
  return createSessionStore<TestSession>({ ...defaultOpts, ...opts });
}

function makeSession(userId: string, data = "payload"): TestSession {
  return { userId, createdAt: Date.now(), data };
}

describe("createSessionStore", () => {
  describe("createIfAllowed", () => {
    it("creates a session and returns ok:true with an id when under all caps", () => {
      const store = makeStore();
      const result = store.createIfAllowed(makeSession("user-1"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.id).toBe("string");
        expect(result.id).toHaveLength(36); // UUID
        expect(store.get(result.id)).toBeDefined();
      }
    });

    it("returns ok:false with USER_SESSION_LIMIT when per-user cap is exceeded", () => {
      const store = makeStore({ maxPerUser: 2 });
      // Fill the per-user cap first
      store.createIfAllowed(makeSession("user-1"));
      store.createIfAllowed(makeSession("user-1"));
      // Third attempt should fail
      const result = store.createIfAllowed(makeSession("user-1"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("USER_SESSION_LIMIT");
      }
    });

    it("returns ok:false with SESSION_LIMIT_REACHED when global cap is exceeded", () => {
      const store = makeStore({ maxGlobal: 3, maxPerUser: 10 });
      store.createIfAllowed(makeSession("user-1"));
      store.createIfAllowed(makeSession("user-2"));
      store.createIfAllowed(makeSession("user-3"));
      // Fourth attempt — different user, global cap hit
      const result = store.createIfAllowed(makeSession("user-4"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("SESSION_LIMIT_REACHED");
      }
    });

    it("increments the user count atomically — no gap between check and increment", () => {
      // Simulate a pseudo-concurrent scenario: two calls with user at cap-1.
      // Both "read" the count before either increments (TOCTOU). With the
      // old canCreate→create pattern they'd both succeed. createIfAllowed
      // fixes this by doing check+increment in one synchronous operation.
      const store = makeStore({ maxPerUser: 1, maxGlobal: 10 });
      const r1 = store.createIfAllowed(makeSession("user-1"));
      const r2 = store.createIfAllowed(makeSession("user-1")); // immediate second call
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(false);
      if (!r2.ok) {
        expect(r2.code).toBe("USER_SESSION_LIMIT");
      }
      // Exactly one session was created
      expect(store._internals.store.size).toBe(1);
    });

    it("counts sessions per user independently", () => {
      const store = makeStore({ maxPerUser: 2, maxGlobal: 10 });
      // user-1 fills their cap
      store.createIfAllowed(makeSession("user-1"));
      store.createIfAllowed(makeSession("user-1"));
      // user-2 still has capacity
      const result = store.createIfAllowed(makeSession("user-2"));
      expect(result.ok).toBe(true);
    });

    it("clears the user count when the session expires via clear()", () => {
      const store = makeStore({ maxPerUser: 1, maxGlobal: 10 });
      const r1 = store.createIfAllowed(makeSession("user-1"));
      expect(r1.ok).toBe(true);
      // Cap is now full for user-1
      const r2 = store.createIfAllowed(makeSession("user-1"));
      expect(r2.ok).toBe(false);
      // Clear the session → should free the slot
      if (r1.ok) store.clear(r1.id);
      const r3 = store.createIfAllowed(makeSession("user-1"));
      expect(r3.ok).toBe(true);
    });
  });

  describe("canCreate vs createIfAllowed atomicity", () => {
    it("createIfAllowed is safe even when canCreate would have returned allowed", () => {
      const store = makeStore({ maxPerUser: 1, maxGlobal: 10 });
      // canCreate says allowed
      const check = store.canCreate("user-1");
      expect(check.allowed).toBe(true);
      // createIfAllowed succeeds the first time
      const r1 = store.createIfAllowed(makeSession("user-1"));
      expect(r1.ok).toBe(true);
      // createIfAllowed fails the second time (cap enforced atomically)
      const r2 = store.createIfAllowed(makeSession("user-1"));
      expect(r2.ok).toBe(false);
    });
  });

  describe("createWithKey", () => {
    it("stores a session under the supplied key and returns ok:true", () => {
      const store = makeStore();
      const result = store.createWithKey("my-key", makeSession("user-1"));
      expect(result.ok).toBe(true);
      expect(store.get("my-key")).toBeDefined();
      expect(store.get("my-key")?.userId).toBe("user-1");
    });

    it("replaces an existing session at the same key for the same user without tripping the per-user cap", () => {
      const store = makeStore({ maxPerUser: 1, maxGlobal: 10 });
      // Create the first entry — fills the per-user slot
      const r1 = store.createWithKey("key-a", makeSession("user-1"));
      expect(r1.ok).toBe(true);
      expect(store._internals.userCount.get("user-1")).toBe(1);

      // Replace it — should not reject because the freed slot nets to 0
      const r2 = store.createWithKey("key-a", makeSession("user-1"));
      expect(r2.ok).toBe(true);
      // Count stays at 1 after the replacement (old slot freed, new slot added)
      expect(store._internals.userCount.get("user-1")).toBe(1);
      expect(store.get("key-a")?.data).toBe("payload");
    });

    it("returns ok:false with SESSION_LIMIT_REACHED when global cap would be exceeded after accounting for freed slot", () => {
      // maxGlobal: 2, two sessions already held by different users.
      // A third createWithKey for a brand-new key should fail.
      const store = makeStore({ maxPerUser: 5, maxGlobal: 2 });
      store.createWithKey("key-a", makeSession("user-1"));
      store.createWithKey("key-b", makeSession("user-2"));

      const result = store.createWithKey("key-c", makeSession("user-3"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("SESSION_LIMIT_REACHED");
      }
    });

    it("allows a replacement at an existing key even when global cap is at maxGlobal (net session count stays the same)", () => {
      const store = makeStore({ maxPerUser: 5, maxGlobal: 2 });
      store.createWithKey("key-a", makeSession("user-1"));
      store.createWithKey("key-b", makeSession("user-2"));

      // Replacing key-a: evict 1, add 1 → net global unchanged → should succeed
      const result = store.createWithKey(
        "key-a",
        makeSession("user-1", "updated"),
      );
      expect(result.ok).toBe(true);
      expect(store.get("key-a")?.data).toBe("updated");
    });

    it("returns ok:false with USER_SESSION_LIMIT when the per-user cap would be exceeded by a different user replacing an existing key", () => {
      // user-1 has maxPerUser sessions already (under a different key).
      // user-2 tries to replace key-a (previously owned by user-1).
      // After the replacement user-2 would own 1 new session which is fine,
      // but this test checks the per-user cap for the incoming data.userId.
      const store = makeStore({ maxPerUser: 1, maxGlobal: 10 });
      // user-2 already has 1 session at key-b (fills their cap)
      store.createWithKey("key-b", makeSession("user-2"));
      // user-1 owns key-a
      store.createWithKey("key-a", makeSession("user-1"));

      // user-2 tries to take key-a — their slot is full
      const result = store.createWithKey("key-a", makeSession("user-2"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("USER_SESSION_LIMIT");
      }
    });
  });
});
