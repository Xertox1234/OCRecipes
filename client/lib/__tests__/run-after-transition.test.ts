import { runAfterTransition } from "../run-after-transition";

describe("runAfterTransition", () => {
  it("does not run the task synchronously", () => {
    const task = vi.fn();
    runAfterTransition(task);
    expect(task).not.toHaveBeenCalled();
  });

  it("runs the task on the next setImmediate turn", async () => {
    const task = vi.fn();
    runAfterTransition(task);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(task).toHaveBeenCalledTimes(1);
  });
});
