import type { EngineInterface, Register } from "claude-code";

// Compact and continue (harness diagnosis 2026-10-30, N9; owner approved 2026-11-02). In 20
// days the owner typed /compact 158 times and followed about 140 of them with "please
// continue". `/cc [instructions]` does both:
//   - it runs the built-in /compact as if typed, rather than $.session.compact(), so the
//     PreCompact ledger and the SessionStart payload see an ordinary manual compaction;
//   - then it sends "please continue" as the owner's words (asUser): typing /cc is the owner
//     saying continue. The transcript still names this plugin.
// If /compact is refused, nothing is sent and a toast says so. Plain /compact is unchanged,
// for when the next step is the owner's.

const COMMAND = "cc";
const CONTINUE = "please continue";

type Dollar = EngineInterface;

async function compactThenContinue($: Dollar, args: string): Promise<void> {
  try {
    await $.command.run({ command: "compact", args });
  } catch (err) {
    $.ui.toast(
      `/cc: compaction did not run (${String(err)}); nothing was sent.`,
    );
    return;
  }
  try {
    await $.prompt.submit({ text: CONTINUE, asUser: true });
  } catch (err) {
    $.ui.toast(
      `/cc: compacted, but "${CONTINUE}" was not sent (${String(err)}).`,
    );
  }
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "Compact the conversation, then continue",
      argumentHint: "[instructions for the summary]",
    });
    return next(e);
  });

  on("command.run", { command: COMMAND }, ($, e) => {
    // From a timer, not from this hook: the host refuses $.command.run made inside a
    // command.run hook (it would wait on the turn the hook holds), awaited or not.
    const args = e.args;
    $.clock.after(0, () => void compactThenContinue($, args));
    return { text: "Compacting, then continuing." };
  });
};
