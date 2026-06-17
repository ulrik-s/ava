/**
 * `LruBudget` (#418, ADR 0022) — håller koll på touch-ordning för ärenden i den
 * lokala store:n och avgör vilka som ska vräkas när budgeten överskrids.
 *
 * Vräknings-regler (ADR 0022): **pinnade** ärenden (mina aktiva + kalenderfönstret)
 * OCH ärenden med icke-uppspelad lokal mutation vräks ALDRIG — de skickas in som
 * `pinned`. Bland resten vräks minst-nyligen-rörda först (LRU).
 */
export class LruBudget {
  /** Touch-ordning: index 0 = minst nyligen rörd, sist = nyast. */
  private order: string[] = [];

  constructor(private readonly capacity: number) {}

  /** Markera ett ärende som nyss rört (flyttar det sist i LRU-ordningen). */
  touch(id: string): void {
    const i = this.order.indexOf(id);
    if (i >= 0) this.order.splice(i, 1);
    this.order.push(id);
  }

  /** Glöm ett ärende (efter vräkning). */
  forget(id: string): void {
    const i = this.order.indexOf(id);
    if (i >= 0) this.order.splice(i, 1);
  }

  has(id: string): boolean {
    return this.order.includes(id);
  }

  size(): number {
    return this.order.length;
  }

  /**
   * Vilka ärenden ska vräkas för att rymmas inom `capacity`? Vräker minst-
   * nyligen-rörda icke-pinnade först. Pinnade räknas mot kapaciteten men vräks
   * aldrig — om de ensamma överstiger budgeten vräks inget (de är okränkbara).
   */
  overflow(pinned: ReadonlySet<string>): string[] {
    const evict: string[] = [];
    let total = this.order.length;
    for (const id of this.order) {
      if (total <= this.capacity) break;
      if (pinned.has(id)) continue;
      evict.push(id);
      total--;
    }
    return evict;
  }
}
