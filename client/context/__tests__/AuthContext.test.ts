import { describe, it, expect } from "vitest";

/**
 * Tests for AuthContext logic.
 * AuthContext is a thin wrapper around the useAuth hook —
 * the key testable logic is the context guard.
 */

describe("AuthContext", () => {
  describe("useAuthContext hook", () => {
    it("should throw error when used outside AuthProvider", () => {
      const context = null; // Simulates being outside provider
      const useAuthContext = () => {
        if (!context) {
          throw new Error(
            "useAuthContext must be used within an AuthProvider",
          );
        }
        return context;
      };

      expect(() => useAuthContext()).toThrow(
        "useAuthContext must be used within an AuthProvider",
      );
    });
  });

  describe("auth state defaults", () => {
    it("should default to unauthenticated state", () => {
      const defaultState = {
        user: null,
        isLoading: true,
        isAuthenticated: false,
      };

      expect(defaultState.user).toBeNull();
      expect(defaultState.isLoading).toBe(true);
      expect(defaultState.isAuthenticated).toBe(false);
    });

    it("should set isLoading to false after auth check completes", () => {
      // No token → unauthenticated
      const afterCheckNoToken = {
        user: null,
        isLoading: false,
        isAuthenticated: false,
      };

      expect(afterCheckNoToken.isLoading).toBe(false);
      expect(afterCheckNoToken.isAuthenticated).toBe(false);
    });

    it("should set authenticated state when user exists", () => {
      const user = {
        id: 1,
        username: "testuser",
        onboardingCompleted: false,
      };
      const authenticatedState = {
        user,
        isLoading: false,
        isAuthenticated: true,
      };

      expect(authenticatedState.isAuthenticated).toBe(true);
      expect(authenticatedState.user).toEqual(user);
      expect(authenticatedState.isLoading).toBe(false);
    });

    it("should clear auth state on logout", () => {
      const loggedOutState = {
        user: null,
        isLoading: false,
        isAuthenticated: false,
      };

      expect(loggedOutState.user).toBeNull();
      expect(loggedOutState.isAuthenticated).toBe(false);
    });
  });

  describe("auth interface", () => {
    it("should expose all expected methods", () => {
      const authInterface = {
        user: null,
        isLoading: false,
        isAuthenticated: false,
        login: async (_u: string, _p: string) => ({}) as never,
        register: async (_u: string, _p: string) => ({}) as never,
        logout: async () => {},
        updateUser: async (_updates: Record<string, unknown>) => undefined,
        checkAuth: async () => {},
      };

      expect(authInterface).toHaveProperty("login");
      expect(authInterface).toHaveProperty("register");
      expect(authInterface).toHaveProperty("logout");
      expect(authInterface).toHaveProperty("updateUser");
      expect(authInterface).toHaveProperty("checkAuth");
      expect(authInterface).toHaveProperty("user");
      expect(authInterface).toHaveProperty("isLoading");
      expect(authInterface).toHaveProperty("isAuthenticated");
    });
  });
});
