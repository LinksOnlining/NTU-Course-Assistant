import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export default class FailureContextReporter implements Reporter {
  private readonly completedByWorker = new Map<number, number>();
  private readonly previousByWorker = new Map<number, string>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const worker = result.workerIndex;
    const ordinal = (this.completedByWorker.get(worker) ?? 0) + 1;
    const title = test.titlePath().join(" › ");

    if (result.status === "failed" || result.status === "timedOut") {
      console.error(
        `[PW_FAILURE_CONTEXT] worker=${worker} ordinal=${ordinal} previous=${JSON.stringify(this.previousByWorker.get(worker) ?? null)} test=${JSON.stringify(title)}`,
      );
    }

    this.completedByWorker.set(worker, ordinal);
    this.previousByWorker.set(worker, title);
  }
}
