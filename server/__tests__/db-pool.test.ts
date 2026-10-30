import { describe, it, expect } from "vitest";
import { pool } from "../db";

// pg.Pool defaults: connectionTimeoutMillis 0 (wait forever for a client)
// and no statement timeout, so pool exhaustion or a runaway query queues
// every request indefinitely instead of failing fast.
describe("db pool timeouts (R11)", () => {
  it("bounds how long a request waits to acquire a connection", () => {
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it("sessions carry a server-enforced statement_timeout", async () => {
    const { rows } = await pool.query<{ statement_timeout: string }>(
      "SHOW statement_timeout",
    );
    expect(rows[0].statement_timeout).not.toBe("0");
  });

  it("keeps the UTC session timezone pin", async () => {
    const { rows } = await pool.query<{ TimeZone: string }>("SHOW timezone");
    expect(rows[0].TimeZone).toBe("UTC");
  });
});
