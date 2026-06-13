import { Pool } from "pg";

/** Lazy factory — never call at module top level (would connect at import). */
export function createPool(connectionString: string | undefined): Pool {
  if (!connectionString) throw new Error("connection string is required");
  return new Pool({ connectionString });
}

/** pgvector accepts a bracketed literal; cast the bound param with `::vector`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
