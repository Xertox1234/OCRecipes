import { expect, test, type TestBody } from "claude-code/testing";

const BAND = {
  plugin: "nightly-band",
  component: "AbovePrompt",
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const;

const OURS = "git@github.com:Xertox1234/OCRecipes.git";

type On = Parameters<TestBody>[1];
type Run = { databaseId: number; conclusion: string };

const ok = (stdout: string) => ({
  value: {
    exitCode: 0,
    stdout,
    stderr: "",
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
});

// Stands in for the engine: the repo the session is in, gh's answers, and the clock.
function world(
  on: On,
  opts: {
    runs?: Run[];
    remote?: string | null;
    listFails?: boolean;
    jobs?: { name: string; conclusion: string }[];
    log?: string[];
  } = {},
) {
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("session.repo", () => ({
    value:
      opts.remote === null
        ? null
        : {
            root: "/r",
            remote: opts.remote ?? OURS,
            internal: false,
            name: null,
          },
  }));
  on("clock.every", () => ({ value: undefined }));
  // the engine's own band is empty, and its context is what it was given
  on("ui.render", ($, e) => {
    const { Box } = $.ui.resolve(e);
    return <Box />;
  });
  on("prompt.context", (_, e) => ({ blocks: e.blocks }));
  on("process.run", (_, e) => {
    const argv = e.argv.join(" ");
    opts.log?.push(argv);
    if (argv.startsWith("gh run list")) {
      if (opts.listFails)
        return {
          value: {
            exitCode: 1,
            stdout: "",
            stderr: "error connecting to api.github.com\nmore",
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        };
      return ok(JSON.stringify(opts.runs ?? []));
    }
    if (argv.startsWith("gh run view"))
      return ok(JSON.stringify({ jobs: opts.jobs ?? [] }));
    throw new Error(`unexpected: ${argv}`);
  });
}

const start = ($: Parameters<TestBody>[0]) =>
  $.session.start({ cwd: "/r", surface: "terminal", isInteractive: true });

async function bandText(
  $: Parameters<TestBody>[0],
  surface: "terminal" | "desktop",
) {
  const ui = await $.ui.mount({ ...BAND, surface });
  const t = (await ui.find({ type: "Text" }))?.text ?? null;
  await ui.unmount();
  return t;
}

const red = (n: number): Run[] =>
  Array.from({ length: n }, (_, i) => ({
    databaseId: 100 - i,
    conclusion: "failure",
  }));

test("red nights are counted from the newest run and named in the band", async ($, on) => {
  const log: string[] = [];
  world(on, {
    runs: [...red(3), { databaseId: 90, conclusion: "success" }, ...red(2)],
    jobs: [
      { name: "Maestro regression (iOS simulator)", conclusion: "failure" },
      { name: "Maestro regression (Android emulator)", conclusion: "success" },
      { name: "Notify on regression failure", conclusion: "success" },
    ],
    log,
  });
  await start($);
  for (const surface of ["terminal", "desktop"] as const)
    expect(await bandText($, surface)).toBe(
      "Nightly E2E red for 3 nights: Maestro regression (iOS simulator) failed · gh run view 100",
    );
  // only scheduled runs on main count: a fix branch's hand-started run says nothing about main
  expect(log[0]).toContain("--branch main --event schedule --status completed");
});

test("a cancelled run is skipped, neither red nor green", async ($, on) => {
  world(on, {
    runs: [
      { databaseId: 9, conclusion: "failure" },
      { databaseId: 8, conclusion: "cancelled" },
      { databaseId: 7, conclusion: "timed_out" },
      { databaseId: 6, conclusion: "success" },
    ],
    jobs: [
      { name: "Maestro regression (iOS simulator)", conclusion: "failure" },
    ],
  });
  await start($);
  expect(await bandText($, "terminal")).toBe(
    "Nightly E2E red for 2 nights: Maestro regression (iOS simulator) failed · gh run view 9",
  );
});

test("every listed run red reads as at least that many", async ($, on) => {
  world(on, { runs: red(14) });
  await start($);
  expect(await bandText($, "terminal")).toBe(
    "Nightly E2E red for 14+ nights · gh run view 100",
  );
});

test("green draws nothing", async ($, on) => {
  world(on, { runs: [{ databaseId: 5, conclusion: "success" }, ...red(4)] });
  await start($);
  expect(await bandText($, "terminal")).toBe(null);
});

test("a failed check says so instead of looking green", async ($, on) => {
  world(on, { listFails: true });
  await start($);
  expect(await bandText($, "terminal")).toBe(
    "Nightly E2E status unknown: error connecting to api.github.com",
  );
});

test("no scheduled runs is unknown, not green", async ($, on) => {
  world(on, { runs: [] });
  await start($);
  expect(await bandText($, "terminal")).toBe(
    "Nightly E2E status unknown: no completed scheduled run on main",
  );
});

test("outside OCRecipes the mod stays silent and never calls gh", async ($, on) => {
  const log: string[] = [];
  world(on, { remote: "git@github.com:someone/else.git", runs: red(2), log });
  await start($);
  expect(await bandText($, "terminal")).toBe(null);
  expect(log).toEqual([]);
});

test("the agent is told once, at the start of the conversation, when red", async ($, on) => {
  world(on, {
    runs: red(1),
    jobs: [
      { name: "Maestro regression (iOS simulator)", conclusion: "failure" },
    ],
  });
  await start($);
  const r = await $.prompt.context({
    blocks: [{ name: "currentDate", text: "today" }],
  });
  const block = r.blocks.find((b) => b.name === "nightlyE2E");
  expect(block?.text).toContain("Nightly E2E red for 1 night");
  expect(block?.text).toContain("tell the owner");
  expect(r.blocks[0]?.name).toBe("currentDate");
});

test("green or unknown adds nothing for the agent", async ($, on) => {
  world(on, { runs: [{ databaseId: 1, conclusion: "success" }] });
  await start($);
  const r = await $.prompt.context({ blocks: [] });
  expect(r.blocks.length).toBe(0);
});
