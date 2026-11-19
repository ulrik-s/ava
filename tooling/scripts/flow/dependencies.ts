/**
 * Beroendenätet mellan arbetsorder (#1720). Kräver en ändring att koden ser ut
 * på ett visst sätt, beror den på issuen som bygger det: loop 2 skriver
 * `Beror på #N`, och flödesvakten speglar raderna som GitHub-beroenden
 * (blocked by), så att nätet syns och kan räknas. GitHub vägrar själv cirklar.
 *
 * Prioriteten ärvs nedåt: en grund får den högsta prioriteten bland det som
 * väntar på den, direkt eller längre upp i kedjan. Rena funktioner här;
 * GitHub-anropen ligger i `flow-deps.ts`.
 */

/** Ett beroende: `blocked` kan inte byggas förrän `blocker` är klar. */
export interface Edge { blocker: number; blocked: number }

/** Issuenumren som brödtexten säger att arbetsordern beror på (`Beror på #N`), utan dubbletter. */
export function dependsOn(body: string): number[] {
  return [...new Set([...body.matchAll(/Beror på #(\d+)\b/g)].map((m) => Number(m[1])))];
}

/** Ett beroende att lägga till, med blockerarens id (GitHub vill ha id, inte nummer). */
export interface NewEdge extends Edge { blockerId: number }

/**
 * `Beror på #N`-rader som ännu inte är GitHub-beroenden. `openIds` är de öppna
 * issuernas id per nummer: en stängd blockerare är redan klar och hoppas över.
 */
export function missingEdges(item: { number: number; body: string }, existing: readonly Edge[], openIds: ReadonlyMap<number, number>): NewEdge[] {
  const has = (blocker: number): boolean => existing.some((e) => e.blocker === blocker && e.blocked === item.number);
  return dependsOn(item.body).flatMap((n) => {
    const id = openIds.get(n);
    return id === undefined || n === item.number || has(n) ? [] : [{ blocker: n, blocked: item.number, blockerId: id }];
  });
}

/** Den egna prioriteten ur raden `Prioritet: <p>` (loop 2) som etikett (`prio-<p>`), eller null. */
export function ownPrio(body: string, order: readonly string[]): string | null {
  const p = /^Prioritet:\s*(\S+)\s*$/m.exec(body)?.[1];
  return p !== undefined && order.includes(`prio-${p}`) ? `prio-${p}` : null;
}

/**
 * Den effektiva prioriteten: den egna, eller den högsta bland det som väntar
 * på saken om den är högre. `order` är prioritetsetiketterna, högst först.
 */
export function effectivePrio(own: ReadonlyMap<number, string>, edges: readonly Edge[], order: readonly string[]): Map<number, string> {
  const rank = (p: string | undefined): number => (p === undefined ? order.length : order.indexOf(p));
  const eff = new Map(own);
  // ponytail: fixpunkt över alla kanter — nätet är några tiotal issues. Varje
  // ändring höjer en prioritet, så slingan tar slut även med en cirkel.
  for (let changed = true; changed;) {
    changed = false;
    for (const { blocker, blocked } of edges) {
      const p = eff.get(blocked);
      if (p !== undefined && rank(p) < rank(eff.get(blocker))) {
        eff.set(blocker, p);
        changed = true;
      }
    }
  }
  return eff;
}

/** Etikettändringen som ger saken prioriteten `want`. */
export function prioChange(labels: readonly string[], want: string, order: readonly string[]): { add: string | null; remove: string[] } {
  return { add: labels.includes(want) ? null : want, remove: labels.filter((l) => order.includes(l) && l !== want) };
}

/** Är felet GitHubs vägran att skapa en cirkel (HTTP 422)? */
export const isCycleError = (e: unknown): boolean => e instanceof Error && e.message.includes("would create a cycle");
