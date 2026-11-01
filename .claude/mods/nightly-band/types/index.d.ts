// What the last check of the nightly E2E run found. `unknown` is its own state so a
// failed check never reads as green.
export type Nightly =
  | {
      kind: "red";
      nights: number;
      capped: boolean;
      runId: number;
      failedJobs: string[];
    }
  | { kind: "green" }
  | { kind: "unknown"; why: string };

declare module "claude-code" {
  interface PluginState {
    "nightly-band": { nightly: Nightly | null };
  }
}
