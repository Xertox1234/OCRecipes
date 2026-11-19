/**
 * Vertex AI's OpenAI-compatible endpoint, driven by the same `openai` SDK as
 * OpenRouter (spec 2026-10-19-vision-rows-vertex-direct §2.2). Login: a
 * dedicated service account (NOT the Play IAP one); google-auth-library
 * caches the ~1h access token and renews it, and the SDK asks for it before
 * every request via the async apiKey setter.
 */
import OpenAI from "openai";
import { GoogleAuth, JWT, gaxios } from "google-auth-library";
import type { AiChatClient } from "./ai-client";
import { VertexAuthError } from "./ai-failure";

export const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export function vertexBaseUrl(project: string): string {
  return `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/endpoints/openapi`;
}

/**
 * Per attempt of the access-token POST to oauth2.googleapis.com. gaxios has no
 * timeout by default, and the token fetch runs before the OpenAI SDK's own
 * deadline, so a stalled endpoint used to hang the AI call unbounded
 * (reliability audit 2026-11-19, M-rel-2). It normally answers in well under a
 * second. With one retry (below) the worst case is ~10 s plus a short backoff.
 */
export const VERTEX_TOKEN_TIMEOUT_MS = 5_000;

/**
 * The token POST retries 3 times by default (2 when no response came back).
 * Cap both counters at 1: two attempts in all.
 */
const TOKEN_RETRY = { retry: 1, noResponseRetries: 1 };

export interface VertexClientOptions {
  tokenTimeoutMs?: number;
  /** Tests only: gaxios uses its own node-fetch in Node, not the global fetch. */
  tokenFetch?: typeof fetch;
}

/**
 * True when the token request never got a usable answer: a timeout or network
 * error (no response), or a 408 / 429 / 5xx from Google. That is an outage,
 * not a bad key, so it must reach the breaker as transport. Anything else (a
 * 400 invalid_grant, a 401, a key that fails at signing) stays a login failure.
 */
function isTokenTransportFailure(err: unknown): boolean {
  if (!(err instanceof gaxios.GaxiosError)) return false;
  const status = err.response?.status;
  return (
    status === undefined || status === 408 || status === 429 || status >= 500
  );
}

export function createVertexClient(
  env: Record<string, string | undefined> = process.env,
  options: VertexClientOptions = {},
): AiChatClient | null {
  const project = env.GOOGLE_VERTEX_PROJECT?.trim();
  const email = env.GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = env.GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY?.trim();
  if (!project || !email || !key) return null;

  // A ready JWT client, not GoogleAuth's `credentials` option (deprecated,
  // warns since google-auth-library 11.3.2). GoogleAuth keeps the
  // string-returning getAccessToken the setter below relies on.
  const auth = new GoogleAuth({
    authClient: new JWT({
      email,
      key: key.replace(/\\n/g, "\n"),
      scopes: [VERTEX_SCOPE],
      transporterOptions: {
        timeout: options.tokenTimeoutMs ?? VERTEX_TOKEN_TIMEOUT_MS,
        retryConfig: TOKEN_RETRY,
        ...(options.tokenFetch && { fetchImplementation: options.tokenFetch }),
      },
    }),
  });
  const loginFailed = (cause?: unknown) =>
    new VertexAuthError(
      "Vertex login failed — check GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL / _KEY",
      { cause },
    );

  // `as unknown` (TS2352): the SDK's overloaded create() takes typed params,
  // AiChatClient takes the adapted Record body — same cast as ai-client.ts.
  return new OpenAI({
    baseURL: vertexBaseUrl(project),
    maxRetries: 0, // the fallback provider is the retry
    apiKey: async () => {
      let token: string | null | undefined;
      try {
        token = await auth.getAccessToken();
      } catch (err) {
        // A plain Error: the SDK wraps it in a generic OpenAIError, which
        // classifies as transport (counts toward vertexBreaker). A
        // VertexAuthError would read as "check your key" and skip the breaker.
        if (isTokenTransportFailure(err)) {
          throw new Error("Vertex login request failed or timed out", {
            cause: err,
          });
        }
        throw loginFailed(err);
      }
      if (!token) throw loginFailed();
      return token;
    },
  }) as unknown as AiChatClient;
}
