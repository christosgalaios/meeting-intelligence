/** Tracks background jobs (extraction) so tests and shutdown can wait for them. */
export class ExtractionQueue {
  private readonly running = new Set<Promise<void>>();

  add(job: () => Promise<void>): void {
    const p: Promise<void> = job()
      .catch(() => {
        // Jobs record their own failure; nothing is allowed to escape as an unhandled rejection.
      })
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }

  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }
}
