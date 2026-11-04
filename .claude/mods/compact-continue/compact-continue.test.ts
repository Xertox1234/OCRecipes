import { expect, test, type TestBody } from "claude-code/testing";

type On = Parameters<TestBody>[1];

// Stands in for the engine: registers the command, records the built-in /compact run, the
// prompt submitted after it, and any toast. `compact` decides how /compact answers.
function world(on: On, log: string[], compact: "ok" | "rejects" = "ok") {
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  // the timer fires at once
  on("clock.after", () => ({ value: undefined }));
  on("command.run", { command: "compact" }, (_, e) => {
    log.push(`compact:${e.args}`);
    if (compact === "rejects") throw new Error("a turn is running");
    return { text: "Compacted" };
  });
  on("prompt.submit", (_, e) => {
    const asOwner = "asUser" in e.origin && e.origin.asUser === true;
    log.push(`submit:${e.text}${asOwner ? " (as owner)" : ""}`);
    return { text: e.text };
  });
  on("ui.toast", (_, e) => {
    log.push(`toast:${e.text}`);
    return { value: undefined };
  });
}

// The mod does its work from a timer after /cc returns, so give that work a few
// microtask turns to land.
async function settle(log: string[], n: number) {
  for (let i = 0; i < 500 && log.length < n; i++) await Promise.resolve();
}

// What the person typing `/cc <args>` sends.
const typed = (args: string) => ({
  command: "cc",
  args,
  origin: { kind: "composer" } as const,
  presentation: { isFullscreen: false, columns: 100 },
});

test("/cc compacts with its instructions, then sends 'please continue' as the owner", async ($, on) => {
  const log: string[] = [];
  world(on, log);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });

  const out = await $.command.run(typed("keep the plan"));
  expect(out.text).toBe("Compacting, then continuing.");

  await settle(log, 2);
  expect(log).toEqual([
    "compact:keep the plan",
    "submit:please continue (as owner)",
  ]);
});

test("/cc with no instructions runs a plain /compact", async ($, on) => {
  const log: string[] = [];
  world(on, log);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });

  await $.command.run(typed(""));
  await settle(log, 2);
  expect(log).toEqual(["compact:", "submit:please continue (as owner)"]);
});

test("when /compact is refused, nothing is sent and a toast says so", async ($, on) => {
  const log: string[] = [];
  world(on, log, "rejects");
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });

  await $.command.run(typed(""));
  await settle(log, 2);
  expect(log[0]).toBe("compact:");
  expect(log.some((l) => l.startsWith("submit:"))).toBe(false);
  expect(log[1]).toMatch(
    /^toast:\/cc: compaction did not run .*nothing was sent/,
  );
});
