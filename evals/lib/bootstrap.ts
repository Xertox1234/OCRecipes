/**
 * Seeded percentile bootstrap for eval score confidence intervals. Kept free
 * of imports so scripts/ci/eval-compare.ts can use it without loading
 * runner-core.ts's import graph (dotenv, an Anthropic client, pg, the server
 * logger). Moved verbatim from runner-core.ts on 2026-10-01.
 */
export const BOOTSTRAP_ITERATIONS = 1000;
export const BOOTSTRAP_SEED = 42;

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function (): number {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapMeanCI(values: number[]): {
  mean: number;
  lower: number;
  upper: number;
} {
  if (values.length === 0) return { mean: 0, lower: 0, upper: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, lower: mean, upper: mean };

  const rng = mulberry32(BOOTSTRAP_SEED);
  const means: number[] = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) {
      sum += values[Math.floor(rng() * values.length)];
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return {
    mean,
    lower: means[Math.floor(BOOTSTRAP_ITERATIONS * 0.025)],
    upper: means[Math.floor(BOOTSTRAP_ITERATIONS * 0.975)],
  };
}
