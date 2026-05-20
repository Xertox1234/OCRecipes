import { createSerialQueue } from "../serial-queue";

describe("createSerialQueue", () => {
  describe("serial analysis queue — concurrent analyses process sequentially", () => {
    it("runs tasks one at a time in FIFO order", async () => {
      const queue = createSerialQueue();
      const executionLog: string[] = [];

      const task = (label: string, delayMs: number) =>
        queue.enqueue(async () => {
          executionLog.push(`start:${label}`);
          await new Promise((r) => setTimeout(r, delayMs));
          executionLog.push(`end:${label}`);
          return label;
        });

      // Enqueue three tasks concurrently
      const p1 = task("A", 30);
      const p2 = task("B", 10);
      const p3 = task("C", 20);

      const results = await Promise.all([p1, p2, p3]);

      expect(results).toEqual(["A", "B", "C"]);

      // Even though B is faster, it should wait for A to finish
      expect(executionLog).toEqual([
        "start:A",
        "end:A",
        "start:B",
        "end:B",
        "start:C",
        "end:C",
      ]);
    });

    it("does not block subsequent tasks when one fails", async () => {
      const queue = createSerialQueue();
      const executionLog: string[] = [];

      const p1 = queue.enqueue(async () => {
        executionLog.push("task1");
        throw new Error("task1 failed");
      });

      const p2 = queue.enqueue(async () => {
        executionLog.push("task2");
        return "ok";
      });

      await expect(p1).rejects.toThrow("task1 failed");
      const result = await p2;

      expect(result).toBe("ok");
      expect(executionLog).toEqual(["task1", "task2"]);
    });

    it("drain() resolves after all tasks complete", async () => {
      const queue = createSerialQueue();
      const results: number[] = [];

      void queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(1);
      });
      void queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(2);
      });

      await queue.drain();

      expect(results).toEqual([1, 2]);
    });

    it("simulates concurrent photo analyses processing sequentially", async () => {
      const queue = createSerialQueue();
      const analysisOrder: string[] = [];
      let activeAnalyses = 0;
      let maxConcurrentAnalyses = 0;

      const analyzePhoto = (photoUri: string) =>
        queue.enqueue(async () => {
          activeAnalyses++;
          maxConcurrentAnalyses = Math.max(
            maxConcurrentAnalyses,
            activeAnalyses,
          );
          analysisOrder.push(photoUri);

          // Simulate API call to analyze ingredients
          await new Promise((r) => setTimeout(r, 20));

          activeAnalyses--;
          return { ingredients: [{ name: `from-${photoUri}` }] };
        });

      // User takes 4 photos in rapid succession
      const promises = [
        analyzePhoto("photo1.jpg"),
        analyzePhoto("photo2.jpg"),
        analyzePhoto("photo3.jpg"),
        analyzePhoto("photo4.jpg"),
      ];

      const results = await Promise.all(promises);

      // All photos processed
      expect(results).toHaveLength(4);
      // Processed in order
      expect(analysisOrder).toEqual([
        "photo1.jpg",
        "photo2.jpg",
        "photo3.jpg",
        "photo4.jpg",
      ]);
      // Never more than 1 analysis running at a time
      expect(maxConcurrentAnalyses).toBe(1);
    });

    it("returns individual results even when processing serially", async () => {
      const queue = createSerialQueue();

      const p1 = queue.enqueue(async () => "result-A");
      const p2 = queue.enqueue(async () => 42);
      const p3 = queue.enqueue(async () => ({ data: true }));

      expect(await p1).toBe("result-A");
      expect(await p2).toBe(42);
      expect(await p3).toEqual({ data: true });
    });
  });
});
