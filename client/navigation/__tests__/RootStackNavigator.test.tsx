// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";

type RootStackNavigatorType = typeof import("../RootStackNavigator").default;
let RootStackNavigator: RootStackNavigatorType;

// Every screen and nested navigator the root stack imports is stubbed — read
// from the navigator's own import lines so a new screen needs no edit here.
// Several screens pull in modules (expo's dev runtime, camera) jsdom can't load,
// and the recorder below never mounts a screen component anyway.
beforeAll(async () => {
  const source = readFileSync(join(__dirname, "../RootStackNavigator.tsx"), {
    encoding: "utf8",
  });
  const modules = [
    ...source.matchAll(
      /^import \w+ from "(@\/(?:screens\/[^"]+|navigation\/\w+Navigator))";$/gm,
    ),
  ].map((m) => m[1]);
  expect(modules).toContain("@/screens/VerifyEmailScreen");
  for (const path of modules) {
    vi.doMock(path, () => ({ default: () => null }));
  }
  RootStackNavigator = (await import("../RootStackNavigator")).default;
});

/**
 * Pins which routes each auth state registers. The verify-email deep link
 * resolves by route NAME (linking.test.ts), so whether it works depends only on
 * the mounted branch having a `VerifyEmail` screen — signed in it had none, and
 * a tapped change-email link did nothing (#55).
 *
 * The native stack is replaced by a recorder: each Stack.Screen renders a
 * marker with its name and navigationKey, and no screen component mounts.
 * Deep-link replay (`lastUnhandled`) is router behaviour this cannot observe —
 * it is checked on the simulator.
 */

vi.mock("@react-navigation/native-stack", () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Group: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Screen: ({
      name,
      navigationKey,
    }: {
      name: string;
      navigationKey?: string;
    }) => (
      <div data-testid={`screen-${name}`} data-navigation-key={navigationKey} />
    ),
  }),
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  user: null as { onboardingCompleted: boolean } | null,
}));
vi.mock("@/context/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("@/hooks/useScreenOptions", () => ({ useScreenOptions: () => ({}) }));

const aiSharing = vi.hoisted(() => ({
  status: { allowed: true, answered: true } as
    | { allowed: boolean; answered: boolean }
    | undefined,
  loading: false,
}));
vi.mock("@/hooks/useAiSharing", () => ({
  useAiSharing: () => ({ ...aiSharing, answer: vi.fn() }),
}));

function signIn() {
  auth.isAuthenticated = true;
  auth.user = { onboardingCompleted: true };
}

describe("RootStackNavigator — VerifyEmail in both auth states", () => {
  beforeEach(() => {
    auth.isAuthenticated = false;
    auth.user = null;
  });

  it("registers VerifyEmail for a signed-out user", () => {
    renderComponent(<RootStackNavigator />);

    expect(screen.getByTestId("screen-Login")).toBeTruthy();
    expect(screen.getByTestId("screen-VerifyEmail")).toBeTruthy();
  });

  it("registers VerifyEmail for a signed-in user", () => {
    signIn();
    renderComponent(<RootStackNavigator />);

    expect(screen.getByTestId("screen-Main")).toBeTruthy();
    expect(screen.getByTestId("screen-VerifyEmail")).toBeTruthy();
    expect(screen.queryByTestId("screen-Login")).toBeNull();
  });

  // Without distinct keys the router keeps a same-named route across an auth
  // flip, so a session that ends on VerifyEmail leaves it alone with no Login
  // underneath (StackRouter.getStateForRouteNamesChange).
  it("keys the two registrations apart so an auth flip drops the route", () => {
    const { unmount } = renderComponent(<RootStackNavigator />);
    const signedOutKey = screen
      .getByTestId("screen-VerifyEmail")
      .getAttribute("data-navigation-key");
    unmount();

    signIn();
    renderComponent(<RootStackNavigator />);
    const signedInKey = screen
      .getByTestId("screen-VerifyEmail")
      .getAttribute("data-navigation-key");

    expect(signedOutKey).toBeTruthy();
    expect(signedInKey).toBeTruthy();
    expect(signedInKey).not.toBe(signedOutKey);
  });
});

// Privacy audit H3: the AI-sharing question comes before anything else.
describe("RootStackNavigator — AI-sharing question", () => {
  beforeEach(() => {
    signIn();
    aiSharing.status = { allowed: true, answered: true };
    aiSharing.loading = false;
  });

  it("shows only the question to a signed-in account that never answered", () => {
    aiSharing.status = { allowed: false, answered: false };
    renderComponent(<RootStackNavigator />);

    expect(screen.getByTestId("screen-AiSharing")).toBeTruthy();
    expect(screen.queryByTestId("screen-Main")).toBeNull();
    expect(screen.queryByTestId("screen-Onboarding")).toBeNull();
  });

  it("asks before onboarding too", () => {
    auth.user = { onboardingCompleted: false };
    aiSharing.status = { allowed: false, answered: false };
    renderComponent(<RootStackNavigator />);

    expect(screen.getByTestId("screen-AiSharing")).toBeTruthy();
    expect(screen.queryByTestId("screen-Onboarding")).toBeNull();
  });

  it("opens the app for someone who said no, with the question reachable", () => {
    aiSharing.status = { allowed: false, answered: true };
    renderComponent(<RootStackNavigator />);

    expect(screen.getByTestId("screen-Main")).toBeTruthy();
    expect(
      screen
        .getByTestId("screen-AiSharing")
        .getAttribute("data-navigation-key"),
    ).toBe("re-ask");
  });

  it("opens the app when the status cannot be read (offline)", () => {
    aiSharing.status = undefined;
    renderComponent(<RootStackNavigator />);

    expect(screen.getByTestId("screen-Main")).toBeTruthy();
  });

  it("holds the app back while the status is first read", () => {
    aiSharing.status = undefined;
    aiSharing.loading = true;
    renderComponent(<RootStackNavigator />);

    expect(screen.queryByTestId("screen-Main")).toBeNull();
    expect(screen.queryByTestId("screen-AiSharing")).toBeNull();
  });
});
