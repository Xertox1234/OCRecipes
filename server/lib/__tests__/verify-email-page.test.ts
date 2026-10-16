import { describe, it, expect } from "vitest";
import {
  renderVerifyEmailConfirmPage,
  renderVerifyEmailPage,
  type VerifyEmailState,
} from "../verify-email-page";

const STATES: VerifyEmailState[] = ["success", "invalid", "error"];

describe("renderVerifyEmailPage — the button just opens the app", () => {
  it("points every state's button at the bare ocrecipes:// scheme", () => {
    // A change-email link is confirmed by a SIGNED-IN user, where the signed-in
    // stack has no Login route: ocrecipes://login goes unhandled and is replayed
    // later, on sign-out. The bare scheme reopens the app where the user was —
    // every screen it can be on (incl. "Check your inbox") has its own exit.
    for (const state of STATES) {
      const html = renderVerifyEmailPage(state);
      expect(html).toContain('href="ocrecipes://"');
      expect(html).not.toContain("ocrecipes://login");
    }
  });

  it("doesn't tell the user to log in after a confirm — they may be signed in", () => {
    expect(renderVerifyEmailPage("success")).not.toMatch(/log ?in/i);
  });
});

describe("page styles — dark mode", () => {
  // Same specificity, so the LATER rule wins: a dark `.card` override placed
  // before the base `.card` rule is dead, leaving light text on a white card.
  it("puts the dark-mode overrides after the base rules they override", () => {
    for (const html of [
      renderVerifyEmailPage("invalid"),
      renderVerifyEmailConfirmPage("aaa.bbb.ccc"),
    ]) {
      const dark = html.indexOf("@media (prefers-color-scheme: dark)");
      expect(dark).toBeGreaterThan(-1);
      expect(dark).toBeGreaterThan(html.indexOf(".card {"));
      expect(dark).toBeGreaterThan(html.indexOf("body {"));
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
    for (const state of STATES) {
      expect(renderVerifyEmailPage(state)).toBe(renderVerifyEmailPage(state));
    }
    // The only deep link present is the fixed scheme string — never a
    // templated token or query value.
    const success = renderVerifyEmailPage("success");
    const schemeMatches = success.match(/ocrecipes:\/\/[^"]*/g) ?? [];
    expect(schemeMatches).toEqual(["ocrecipes://"]);
  });
});
