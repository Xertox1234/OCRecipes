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
 * SECURITY: interpolates ZERO request input. Only static copy and a fixed
 * `ocrecipes://` deep link are rendered, so the attacker-controllable `?token=`
 * query string is never reflected into the HTML (no reflected-XSS surface).
 */
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

export function renderVerifyEmailPage(state: VerifyEmailState): string {
  const c = COPY[state];
  const accent = ACCENT[state];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${c.title} · OCRecipes</title>
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
    margin:0 auto 20px; font-size:32px; font-weight:700; color:#fff; background:${accent}; }
  h1 { font-size:22px; margin:0 0 10px; }
  p { font-size:15px; line-height:1.5; margin:0 0 28px; opacity:.85; }
  .btn { display:inline-block; background:${accent}; color:#fff; text-decoration:none;
    font-weight:600; font-size:16px; padding:14px 28px; border-radius:12px; }
</style>
</head>
<body>
  <main class="card">
    <div class="icon" aria-hidden="true">${c.icon}</div>
    <h1>${c.heading}</h1>
    <p>${c.body}</p>
    <a class="btn" href="ocrecipes://">Open OCRecipes</a>
  </main>
</body>
</html>`;
}
