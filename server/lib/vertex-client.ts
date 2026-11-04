/**
 * Vertex AI's OpenAI-compatible endpoint, driven by the same `openai` SDK as
 * OpenRouter (spec 2026-10-19-vision-rows-vertex-direct §2.2). Login: a
 * dedicated service account (NOT the Play IAP one); google-auth-library
 * caches the ~1h access token and renews it, and the SDK asks for it before
 * every request via the async apiKey setter.
 */
import OpenAI from "openai";
import { GoogleAuth } from "google-auth-library";
import type { AiChatClient } from "./ai-client";
import { VertexAuthError } from "./ai-failure";

export const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export function vertexBaseUrl(project: string): string {
  return `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/endpoints/openapi`;
}

export function createVertexClient(
  env: Record<string, string | undefined> = process.env,
): AiChatClient | null {
  const project = env.GOOGLE_VERTEX_PROJECT?.trim();
  const email = env.GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = env.GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY?.trim();
  if (!project || !email || !key) return null;

  const auth = new GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    },
    scopes: [VERTEX_SCOPE],
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
        throw loginFailed(err);
      }
      if (!token) throw loginFailed();
      return token;
    },
  }) as unknown as AiChatClient;
}
