/**
 * `SharedExclusiveLock` (#1265) — ett läs/skriv-lås för in-process-länkens
 * mutationer. Köbara procedurer körs EXKLUSIVT: deras lokala skrivningar
 * fångas som anropets `touches` och får inte blandas med en samtidig
 * mutations. Övriga mutationer körs DELAT — de överlappar varandra som förut
 * (en mutation som väntar på en annan kan inte låsa sig), men aldrig en
 * exklusiv.
 */
export class SharedExclusiveLock {
  /** Kedjan av exklusiva uppgifter (klar = inga väntande exklusiva). */
  private exclusiveTail: Promise<void> = Promise.resolve();
  private readonly running = new Set<Promise<unknown>>();

  /** Kör `task` delat: väntar in exklusiva som redan står i kö. */
  async shared<T>(task: () => Promise<T>): Promise<T> {
    await this.exclusiveTail;
    const run = task();
    this.running.add(run);
    try {
      return await run;
    } finally {
      this.running.delete(run);
    }
  }

  /** Kör `task` exklusivt: efter tidigare exklusiva och pågående delade. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.exclusiveTail;
    const run = (async () => {
      await previous;
      await Promise.allSettled([...this.running]);
      return task();
    })();
    this.exclusiveTail = run.then(() => undefined, () => undefined);
    return run;
  }
}
