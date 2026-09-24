import { describe, it, expect } from "vitest";
// @react-navigation/core is a hard dependency of @react-navigation/native;
// importing native itself pulls React Native sources the node env cannot load.
import { getStateFromPath } from "@react-navigation/core";
import { linking } from "../linking";

describe("linking config", () => {
  it("includes both custom scheme and universal link prefixes", () => {
    expect(linking.prefixes).toContain("ocrecipes://");
    expect(linking.prefixes).toContain("https://ocrecipes.app");
  });

  it("configures FeaturedRecipeDetail path with numeric parse", () => {
    // Cast: React Navigation's linking config types screen entries as a
    // discriminated union of `string | { path; parse?; screens? }`; narrow to
    // the object variant to read `.path` and `.parse`.
    const recipeDetail = linking.config!.screens
      .FeaturedRecipeDetail as unknown as {
      path: string;
      parse: Record<string, (v: string) => number>;
    };

    expect(recipeDetail.path).toBe("recipe/:recipeId");
    expect(recipeDetail.parse.recipeId("42")).toBe(42);
  });

  it("configures Chat path with numeric parse", () => {
    const chat =
      // @ts-expect-error — nested screen config typing is loosely indexed
      linking.config!.screens.Main.screens.CoachTab.screens.Chat;

    expect(chat.path).toBe("chat/:conversationId");
    expect(chat.parse.conversationId("7")).toBe(7);
  });

  it("configures NutritionDetail as a path string", () => {
    expect(linking.config!.screens.NutritionDetail).toBe("nutrition/:barcode");
  });

  // Query params on a deep link land in route.params unfiltered unless the
  // screen's `parse` config transforms them. ScanScreen forwards
  // verifyBarcode into FrontLabelConfirm and the verification submit, so a
  // link must not be able to pick the barcode a user's label photo is
  // credited to. Run through React Navigation's own parser, not the config
  // shape, so the assertion is on what the app actually receives.
  it("opens Scan from a deep link but drops a link-supplied verifyBarcode", () => {
    const state = getStateFromPath(
      "scan?mode=label&verifyBarcode=0778918011332",
      linking.config,
    );
    const route = state?.routes[0];
    expect(route?.name).toBe("Scan");
    expect(route?.params).toMatchObject({ mode: "label" });
    expect(
      (route?.params as Record<string, unknown> | undefined)?.verifyBarcode,
    ).toBeUndefined();
  });

  // Query values are decoded by query-string → decode-uri-component. Its
  // fallback decoder for malformed input (GHSA-vcc3-ghjq-m6fr, <= 0.4.2) is
  // super-linear: 400 invalid `%C0` tokens took ~2.4s under Node's JIT, so a
  // crafted link could freeze the app. Pin both the fix and that ordinary
  // percent-encoding still decodes after the ESM-only 0.5.0 bump.
  it("decodes a percent-encoded query param from a deep link", () => {
    const state = getStateFromPath(
      "verify-email?token=caf%C3%A9%20au%20lait",
      linking.config,
    );
    expect(state?.routes[0]?.params).toMatchObject({ token: "café au lait" });
  });

  it("parses a deep link with a long malformed percent-encoded query quickly", () => {
    const start = performance.now();
    const state = getStateFromPath(
      `verify-email?token=${"%C0".repeat(400)}`,
      linking.config,
    );
    const elapsedMs = performance.now() - start;
    expect(state?.routes[0]?.name).toBe("VerifyEmail");
    expect(elapsedMs).toBeLessThan(250);
  });

  it("configures AllConversations as a path string", () => {
    expect(linking.config!.screens.AllConversations).toBe("conversation-list");
  });

  it("configures Login as a path string so ocrecipes://login routes to sign-in", () => {
    // Drives the verify-email landing's "Open OCRecipes" success CTA
    // (ocrecipes://login) straight to the Login screen instead of foregrounding
    // the app onto the dead-end "Check your inbox" screen.
    expect(linking.config!.screens.Login).toBe("login");
  });

  it("returns 0 when recipeId parse receives a non-numeric string", () => {
    // Cast: see above — narrow union to the object variant for `.parse`.
    const recipeDetail = linking.config!.screens
      .FeaturedRecipeDetail as unknown as {
      path: string;
      parse: Record<string, (v: string) => number>;
    };

    expect(recipeDetail.parse.recipeId("abc")).toBe(0);
  });

  it("returns 0 when conversationId parse receives a non-numeric string", () => {
    const chat =
      // @ts-expect-error — nested screen config typing is loosely indexed
      linking.config!.screens.Main.screens.CoachTab.screens.Chat;

    expect(chat.parse.conversationId("abc")).toBe(0);
  });
});
