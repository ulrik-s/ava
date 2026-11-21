/**
 * `MutationLock` (#1265, #1794) — in-process-länkens lås. ALLA mutationer körs
 * exklusivt, en i taget och i den ordning de kom, i både demo och self-hosted.
 * Frågor läser bara och går förbi låset.
 *
 * ## Varför exklusivt
 *
 * Mutationerna delar `LocalStore`:s transaktionsbuffert. En transaktion som
 * startar medan en annan pågår tar den reentranta grenen och körs som om den
 * vore nästlad: kastar den ena rullas båda tillbaka, eller så köas halva
 * skrivningar. Köbara procedurer (#1265, ADR 0037) behöver dessutom att deras
 * lokala skrivningar, anropets `touches`, inte blandas med någon annans.
 *
 * ## Varför det inte ger dödläge
 *
 * Ett exklusivt lås låser sig bara om en mutation, medan den håller låset,
 * anropar länken och VÄNTAR på en annan mutation. Det gör ingen: routrarna
 * anropar aldrig länken inifrån. De två serverfiler som får importera klientkod
 * (undantagen i `server-contracts-must-not-import-client` i dependency-cruiser)
 * väntar inte heller på någon mutation:
 *
 * - `adapters/demo-document-analyzer.ts` köar bara ett klientjobb synkront
 *   (`jobQueue.enqueue`) och väntar inte på det. Jobbets egen mutation
 *   (`document.updateMetadata`) ställer sig i kön och körs när den pågående
 *   mutationen släppt låset. `uploadContent` väntar inte heller på analysen
 *   (`analyze(...)` anropas utan `await`).
 * - `adapters/demo-search-index.ts` läser bara (dataStore och innehållscachen)
 *   och anropar ingen mutation.
 */
export class MutationLock {
  /** Kedjan av uppgifter (klar = inget i kö). */
  private tail: Promise<void> = Promise.resolve();

  /** Kör `task` exklusivt: efter alla tidigare uppgifter, även de som kastat. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}
