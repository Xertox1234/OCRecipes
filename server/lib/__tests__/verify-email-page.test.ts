import { describe, it, expect } from "vitest";
import {
  renderVerifyEmailConfirmPage,
  renderVerifyEmailPage,
  type VerifyEmailState,
} from "../verify-email-page";

describe("renderVerifyEmailPage — success CTA hand-off to Login", () => {
  it("points the success-state button at the ocrecipes://login deep link", () => {
    const html = renderVerifyEmailPage("success");
    // The login deep link routes the app straight to the sign-in screen
    // instead of foregrounding it onto the "Check your inbox" dead-end.
    expect(html).toContain('href="ocrecipes://login"');
    // And must NOT fall back to the bare scheme (which just foregrounds the app).
    expect(html).not.toContain('href="ocrecipes://"');
  });

  it("keeps the bare ocrecipes:// scheme on the invalid and error states", () => {
    // invalid/error tell the user to request a new link in-app, so they should
    // foreground the app (landing on the resend form), not jump to Login.
    for (const state of ["invalid", "error"] as VerifyEmailState[]) {
      const html = renderVerifyEmailPage(state);
      expect(html).toContain('href="ocrecipes://"');
      expect(html).not.toContain("ocrecipes://login");
    }
  });
});

describe("renderVerifyEmailConfirmPage — a button, not a page load, verifies", () => {
  const TOKEN = "aaa.bbb-_.ccc";

  it("renders a form that POSTs the token to /verify-email", () => {
    const html = renderVerifyEmailConfirmPage(TOKEN);
    expect(html).toContain('<form method="post" action="/verify-email">');
    expect(html).toContain(
      `<input type="hidden" name="token" value="${TOKEN}" />`,
    );
    expect(html).toMatch(/<button[^>]*type="submit"/);
  });

  it("reflects the token exactly once, and only inside the hidden input", () => {
    const html = renderVerifyEmailConfirmPage(TOKEN);
    expect(html.split(TOKEN)).toHaveLength(2);
  });

  it("never auto-submits — no script on the page", () => {
    expect(renderVerifyEmailConfirmPage(TOKEN)).not.toMatch(/<script/i);
  });

  // The route only renders a token jwt.verify accepted, so these shapes can't
  // reach the renderer today — the renderer guards itself anyway.
  it.each([
    ['"><script>alert(1)</script>.a.b'],
    ["a.b.c<"],
    ["a.b"],
    ["a.b.c.d"],
    [""],
    ["a".repeat(4097) + ".b.c"],
  ])("refuses a token outside the JWT charset: %s", (bad) => {
    expect(() => renderVerifyEmailConfirmPage(bad)).toThrow(/malformed/);
  });
});

describe("renderVerifyEmailPage — security regression guard", () => {
  // Forward-compat guard, not a test of current logic: the function takes only
  // the state enum, so request input (the ?token=) is structurally unable to
  // reach the HTML today. This pins that property — if someone later threads a
  // value through, these assertions break before a reflected-XSS surface ships.
  it("renders deterministically from state alone with no interpolated input", () => {
    for (const state of ["success", "invalid", "error"] as VerifyEmailState[]) {
      expect(renderVerifyEmailPage(state)).toBe(renderVerifyEmailPage(state));
    }
    // The only deep links present are the two fixed scheme strings — never a
    // templated token or query value.
    const success = renderVerifyEmailPage("success");
    const schemeMatches = success.match(/ocrecipes:\/\/[^"]*/g) ?? [];
    expect(schemeMatches).toEqual(["ocrecipes://login"]);
  });
});
