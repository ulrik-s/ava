/**
 * `Mutex` — ett minimalt async-lås (FIFO) för att serialisera åtkomst till en
 * delad resurs (#83, ADR 0013, concurrency-beslut A).
 *
 * Server-runtime:ns HTTP-API och dess PeerLoop (15s pull→act→push) arbetar mot
 * SAMMA `firma.git`-working-copy på disk. Två samtidiga skrivare = trasigt
 * git-index. Lösningen (Option A) är att båda tar samma lås: en HTTP-mutation
 * och en peer-tick kan aldrig köra överlappande. Add-in-trafik är låg-QPS, så
 * serialiseringen är i praktiken gratis.
 *
 * Avsiktligt beroendefritt (ingen `async-mutex`-dep): `runExclusive` köar
 * callbacks och kör dem en i taget i anropsordning. Ett kast i en callback
 * släpper låset (nästa väntare körs) och propagerar till just den anroparen.
 */

export class Mutex {
  /** Svansen i kön: löftet den senast schemalagda väntaren väntar på. */
  private tail: Promise<void> = Promise.resolve();

  /**
   * Kör `fn` exklusivt: väntar tills alla tidigare köade jobb är klara, kör
   * `fn`, och släpper låset (även vid kast) så nästa väntare kan köra.
   * Returnerar `fn`:s resultat (eller kastar dess fel) till just denna anropare.
   */
  runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    // Skapa "released"-löftet som nästa väntare kedjar på FÖRE vi kör fn, så
    // ordningen blir strikt FIFO även om fn är synkron.
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => { release = resolve; });
    const prior = this.tail;
    this.tail = prior.then(() => released);

    return prior.then(async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
  }
}
