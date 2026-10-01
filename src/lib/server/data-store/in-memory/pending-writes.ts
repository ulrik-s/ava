/**
 * `PendingWrites` (#1386) — räknar lokala skrivningar som ännu inte nått
 * IndexedDB (kö-poster och snapshot). En mutation svarar först när dess
 * skrivningar är klara, så en ändring som visas som sparad finns kvar efter en
 * omladdning. Under själva skrivningen kan fliken ändå stängas; räknaren låter
 * sidan varna just då (`beforeunload`), och bara då.
 */

/** Läsvyn: pågår en skrivning, och meddela när det ändras. */
export interface PendingWritesView {
  /** Pågår minst en lokal skrivning just nu? */
  busy(): boolean;
  /** `listener(busy)` när läget går från ledigt till upptaget eller tillbaka. Returnerar en avregistrering. */
  subscribe(listener: (busy: boolean) => void): () => void;
}

export class PendingWrites implements PendingWritesView {
  private count = 0;
  private readonly listeners = new Set<(busy: boolean) => void>();

  /** Kör `work` som en pågående skrivning (även när den kastar räknas den av). */
  async track<T>(work: () => Promise<T>): Promise<T> {
    this.change(1);
    try {
      return await work();
    } finally {
      this.change(-1);
    }
  }

  busy(): boolean {
    return this.count > 0;
  }

  subscribe(listener: (busy: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private change(delta: number): void {
    const before = this.busy();
    this.count += delta;
    const after = this.busy();
    if (before !== after) for (const listener of this.listeners) listener(after);
  }
}
