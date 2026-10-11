/**
 * Self-contained HTML for the email-verification browser landing
 * (GET /verify-email, served from api.ocrecipes.com).
 *
 * Why a server-rendered page instead of a universal/deep link: a verification
 * link is tapped from arbitrary mail clients on arbitrary devices. This page
 * works in ANY browser with no app install, no Apple App Site Association, and
 * no deployed web frontend. Inline CSS only — no external assets — so it renders
 * identically regardless of network/CDN state.
 *
 * SECURITY: `renderVerifyEmailPage` interpolates ZERO request input — only
 * static copy and fixed, state-keyed `ocrecipes://` deep links. The one exception
 * is `renderVerifyEmailConfirmPage`, which must carry the token into its form: it
 * accepts only the JWT charset (base64url segments) and HTML-escapes it anyway.
 */
import { escapeHtml } from "./html-escape";

export type VerifyEmailState = "success" | "invalid" | "error";

const COPY: Record<
  VerifyEmailState,
  { title: string; heading: string; body: string; icon: string }
> = {
  success: {
    title: "Email verified",
    heading: "Email verified",
    body: "Your OCRecipes account is confirmed. Return to the app and log in.",
    icon: "✓",
  },
  invalid: {
    title: "Link expired or invalid",
    heading: "Link expired or invalid",
    body: "This verification link is no longer valid. Open OCRecipes and request a new verification email.",
    icon: "!",
  },
  error: {
    title: "Something went wrong",
    heading: "Something went wrong",
    body: "We couldn't verify your email just now. Please try the link again in a moment.",
    icon: "…",
  },
};

const ACCENT: Record<VerifyEmailState, string> = {
  success: "#16a34a",
  invalid: "#dc2626",
  error: "#6b7280",
};

// Per-state CTA target. `success` hands the verified user straight to the in-app
// sign-in screen (ocrecipes://login) instead of the bare scheme, which would just
// foreground the app onto the "Check your inbox" dead-end. This is pure
// navigation — verifying proves address ownership, NOT password possession, so no
// session token is issued here. `invalid`/`error` keep the bare scheme so the app
// opens on its last screen (the resend form). All values are static, keyed by the
// server-determined state — never request input — so the zero-reflection property
// above holds.
const CTA_HREF: Record<VerifyEmailState, string> = {
  success: "ocrecipes://login",
  invalid: "ocrecipes://",
  error: "ocrecipes://",
};

export function renderVerifyEmailPage(state: VerifyEmailState): string {
  const c = COPY[state];
  return page({
    title: c.title,
    heading: c.heading,
    body: c.body,
    icon: c.icon,
    accent: ACCENT[state],
    action: `<a class="btn" href="${CTA_HREF[state]}">Open OCRecipes</a>`,
  });
}

// Three base64url segments — the only shape signVerificationToken produces.
// Capped well above a real token (~300 chars) so nothing unbounded is echoed.
const VERIFY_TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_VERIFY_TOKEN_LENGTH = 4096;

/**
 * The page GET /verify-email shows for a valid link: verifying takes a button
 * press (a POST), so a mail scanner opening the link verifies nothing — the
 * link may be one a squatter's sign-up sent to the victim (auth audit M4). No
 * script, no auto-submit: a real click is the point.
 */
export function renderVerifyEmailConfirmPage(token: string): string {
  if (
    token.length > MAX_VERIFY_TOKEN_LENGTH ||
    !VERIFY_TOKEN_SHAPE.test(token)
  ) {
    throw new Error("refusing to render a malformed verification token");
  }
  return page({
    title: "Confirm your email",
    heading: "Confirm your email",
    body: "Tap the button to confirm this email address for your OCRecipes account. If you didn't create an account, close this page.",
    icon: "@",
    accent: "#2563eb",
    action: `<form method="post" action="/verify-email">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <button class="btn" type="submit">Confirm my email</button>
    </form>`,
  });
}

function page(p: {
  title: string;
  heading: string;
  body: string;
  icon: string;
  accent: string;
  action: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${p.title} · OCRecipes</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#f5f5f7; color:#1d1d1f; padding:24px; }
  @media (prefers-color-scheme: dark){ body{ background:#000; color:#f5f5f7; } .card{ background:#1c1c1e; } }
  .card { background:#fff; border-radius:20px; padding:40px 28px; max-width:380px; width:100%;
    text-align:center; box-shadow:0 10px 40px rgba(0,0,0,.08); }
  .icon { width:64px; height:64px; border-radius:50%; display:flex; align-items:center; justify-content:center;
    margin:0 auto 20px; font-size:32px; font-weight:700; color:#fff; background:${p.accent}; }
  h1 { font-size:22px; margin:0 0 10px; }
  p { font-size:15px; line-height:1.5; margin:0 0 28px; opacity:.85; }
  form { margin:0; }
  .btn { display:inline-block; background:${p.accent}; color:#fff; text-decoration:none; border:0;
    font:inherit; font-weight:600; font-size:16px; padding:14px 28px; border-radius:12px; cursor:pointer; }
</style>
</head>
<body>
  <main class="card">
    <div class="icon" aria-hidden="true">${p.icon}</div>
    <h1>${p.heading}</h1>
    <p>${p.body}</p>
    ${p.action}
  </main>
</body>
</html>`;
}
