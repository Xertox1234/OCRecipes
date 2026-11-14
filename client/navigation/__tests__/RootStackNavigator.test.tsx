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

const reask = vi.hoisted(() => ({ enabled: undefined as boolean | undefined }));
vi.mock("@/navigation/useAiSharingReask", () => ({
  useAiSharingReask: (enabled: boolean) => {
    reask.enabled = enabled;
  },
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

// Privacy audit H3 (owner ruling 2026-11-10): a new account is asked inside
// onboarding; any other account is asked when an AI request is refused.
describe("RootStackNavigator — AI-sharing question", () => {
  beforeEach(() => {
    signIn();
    reask.enabled = undefined;
  });

  it("opens the app without a question in the way, with the question reachable", () => {
    renderComponent(<RootStackNavigator />);

    expect(screen.getByTestId("screen-Main")).toBeTruthy();
    expect(screen.getByTestId("screen-AiSharing")).toBeTruthy();
    expect(reask.enabled).toBe(true);
  });

  it("leaves a new account to the onboarding step", () => {
    auth.user = { onboardingCompleted: false };
    renderComponent(<RootStackNavigator />);

    expect(screen.getByTestId("screen-Onboarding")).toBeTruthy();
    expect(screen.queryByTestId("screen-AiSharing")).toBeNull();
    // The question screen is not registered here, so nothing may navigate
    // to it.
    expect(reask.enabled).toBe(false);
  });
});
