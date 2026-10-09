// Railway Infrastructure as Code for the OCRecipes API service. It replaces
// railway.json, which Railway stops reading on 2026-12-01.
//
// Railway does NOT read this file during deploys. It takes effect only when
// someone runs `railway config apply`; see .railway/README.md before running it.
//
// A named partial owns only the resources declared here. The Postgres service is
// deliberately left out: if this file declared it, a later edit that dropped it
// would delete the production database.
import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "OCRecipes";

export default defineRailway(() => {
  const api = service("OCRecipes", {
    // The live source, declared so the service never compiles as "empty".
    source: github("Xertox1234/OCRecipes", {
      branch: "main",
      checkSuites: false,
    }),
    // Mirrors railway.json one-for-one.
    build: {
      builder: "RAILPACK",
      buildCommand: "npm run server:build",
    },
    deploy: {
      startCommand: "npm run server:prod",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 30,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    // Live placement (railway.json's numReplicas: 1, in us-west2).
    replicas: { "us-west2": 1 },
    domains: [{ domain: "api.ocrecipes.com", port: 8080 }],
    // Values stay on Railway; listing the names keeps an apply from treating
    // them as removed.
    env: {
      AI_INTEGRATIONS_OPENAI_API_KEY: preserve(),
      APPLE_BUNDLE_ID: preserve(),
      APPLE_SIGN_IN_KEY_ID: preserve(),
      APPLE_SIGN_IN_PRIVATE_KEY: preserve(),
      APPLE_TEAM_ID: preserve(),
      DATABASE_URL: preserve(),
      EMAIL_FROM: preserve(),
      EMAIL_VERIFY_BASE_URL: preserve(),
      EXPO_PUBLIC_DOMAIN: preserve(),
      IDENTITY_TOKEN_ENC_KEY: preserve(),
      JWT_SECRET: preserve(),
      NODE_ENV: preserve(),
      OPENROUTER_API_KEY: preserve(),
      R2_ACCESS_KEY_ID: preserve(),
      R2_ACCOUNT_ID: preserve(),
      R2_BUCKET: preserve(),
      R2_PUBLIC_BASE_URL: preserve(),
      R2_SECRET_ACCESS_KEY: preserve(),
      RECIPE_FINDER_ENABLED: preserve(),
      RECIPE_OFFER_ENABLED: preserve(),
      RESEND_API_KEY: preserve(),
      RUNWARE_API_KEY: preserve(),
      SENTRY_DSN: preserve(),
      SPOONACULAR_API_KEY: preserve(),
    },
  });

  return project("OCRecipes", { resources: [api] });
});
