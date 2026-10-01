/**
 * Avvisade ändringar (#1266, ADR 0037) — ingen avvisad ändring får försvinna
 * tyst.
 *
 * När servern avvisar en köad ändring (en kollega hann fakturera posterna, en
 * låst post, en rad någon annan ändrat) kvitteras den i kön och serverns läge
 * ersätter det lokala (#1348). Här sparas den i stället för att glömmas: vad
 * det var, varför, och vad som gällde på servern. Juristen kan **kasta** den —
 * raderna den rörde hämtas då från servern igen — eller **försöka igen**, men
 * bara när ett nytt försök kan lyckas (`retryable`): en deterministisk
 * avvisning avvisas likadant igen.
 *
 * Persisteras i IndexedDB (överlever omladdning), en post i taget (#1346):
 * flera flikar delar lagringen, och ingen flik skriver tillbaka sin kopia av
 * hela listan. En modul-global instans — det finns en server-synk per flik;
 * `ServerFirstSync` registrerar hur ett nytt försök köas och hur serverns
 * läge återställs (`setHandlers`).
 */

import { z } from "zod";
import type { ChangeChannel } from "@/lib/server/data-store/in-memory/change-channel";
import { IdbEntryStore } from "@/lib/server/data-store/in-memory/idb-entry-store";
import { queueEntrySchema } from "@/lib/server/data-store/in-memory/mutation-queue";
import { rowConflictRetryable, type ConflictRecord } from "@/lib/server/data-store/in-memory/reconcile-engine";
import { describeQueueEntry } from "./describe-queue-entry";

/** En avvisad ändring så som den sparas: tolkas strikt när den läses ur IndexedDB. */
const rejectedChangeSchema = z.object({
  /** Köpostens mutationId. */
  id: z.string(),
  /** Epoch-ms när servern avvisade den. */
  rejectedAt: z.number(),
  /** Vad ändringen var, på svenska ("Ny tidspost", "Ändring av faktura"). */
  label: z.string(),
  /** Serverns skäl. */
  reason: z.string(),
  /** Köposten — det som skickas igen vid ett nytt försök. */
  entry: queueEntrySchema,
  /** Serverns rad när ändringen avvisades (radkonflikter). */
  current: z.record(z.string(), z.unknown()).exactOptional(),
  /** Kan ett nytt försök lyckas (#1348)? Saknas på avvisningar sparade före fältet. */
  retryable: z.boolean().exactOptional(),
});

/** En avvisad ändring som väntar på att användaren tar ställning. */
export type RejectedChange = z.infer<typeof rejectedChangeSchema>;

/** Var avvisningarna sparas (#1346): en post i taget, aldrig hela listan. */
export interface RejectedChangesPersistence {
  /** Alla avvisningar i den ordning de sparades. */
  load(): Promise<RejectedChange[]>;
  /** Spara avvisningen sist. Finns id:t redan händer ingenting. */
  add(change: RejectedChange): Promise<void>;
  /** Ta bort avvisningen (finns den inte händer ingenting). */
  delete(id: string): Promise<void>;
  /** Lyssna på andra flikars ändringar. Returnerar avregistreringen. */
  subscribe?(listener: () => void): () => void;
}

/**
 * IndexedDB (webbläsaren) — en rad per avvisning. Raderna ligger i `<dbName>-v2`; den gamla
 * databasens lista (allt under nyckeln `items`) flyttas hit vid varje läsning
 * — utan att den gamla databasen uppgraderas (se `idb-entry-store.ts`).
 */
export class IndexedDbRejectedChangesPersistence implements RejectedChangesPersistence {
  private readonly entries: IdbEntryStore<RejectedChange>;
  constructor(factory: IDBFactory = globalThis.indexedDB, dbName = "ava-rejected-changes", channel?: ChangeChannel) {
    this.entries = new IdbEntryStore({
      factory, dbName, schema: rejectedChangeSchema,
      legacy: { storeName: "rejected", key: "items", idField: "id" },
      ...(channel ? { channel } : {}),
    });
  }
  load(): Promise<RejectedChange[]> { return this.entries.load(); }
  add(change: RejectedChange): Promise<void> { return this.entries.add(change.id, change); }
  delete(id: string): Promise<void> { return this.entries.delete(id); }
  subscribe(listener: () => void): () => void { return this.entries.subscribe(listener); }
}

/** Minnet (tester, demo). */
export class InMemoryRejectedChangesPersistence implements RejectedChangesPersistence {
  private items: RejectedChange[] = [];
  async load(): Promise<RejectedChange[]> { return [...this.items]; }
  async add(change: RejectedChange): Promise<void> {
    if (!this.items.some((i) => i.id === change.id)) this.items.push(change);
  }
  async delete(id: string): Promise<void> { this.items = this.items.filter((i) => i.id !== id); }
}

/**
 * Kan ett nytt försök med ändringen lyckas? En avvisning sparad före #1348
 * saknar svaret — då bara en versionskonflikt på en rad radkön får skriva.
 */
export function canRetry(change: RejectedChange): boolean {
  return change.retryable ?? rowConflictRetryable(change.entry, change.current);
}

/** Det synken gör med en avvisad ändring (registreras av `ServerFirstSync`). */
export interface RejectedChangeHandlers {
  /** Köa ändringen på nytt. */
  retry: (change: RejectedChange) => Promise<void>;
  /** Återställ raderna ändringen rörde till serverns läge (#1348). */
  restore: (change: RejectedChange) => Promise<void>;
}

const NO_SYNC = "Ingen synk mot servern — försök igen när du är ansluten.";

type Listener = (items: readonly RejectedChange[]) => void;

function toRejected(c: ConflictRecord, now: number): RejectedChange {
  return {
    id: c.mutation.mutationId,
    rejectedAt: now,
    label: describeQueueEntry(c.mutation),
    reason: c.reason,
    entry: c.mutation,
    ...(c.current ? { current: c.current } : {}),
    retryable: c.retryable,
  };
}

export class RejectedChanges {
  private items: RejectedChange[] = [];
  private readonly listeners = new Set<Listener>();
  private handlers: RejectedChangeHandlers | null = null;
  /** Avregistrerar den nuvarande lagringens signal (om den har någon). */
  private detach: (() => void) | undefined;

  constructor(private persistence: RejectedChangesPersistence = new InMemoryRejectedChangesPersistence()) {}

  /**
   * Byt lagring och läs in det som sparats (vid start). En annan fliks
   * ändringar i lagringen läses in när de sker (#1346).
   */
  async attach(persistence: RejectedChangesPersistence): Promise<void> {
    this.detach?.();
    this.persistence = persistence;
    this.detach = persistence.subscribe?.(() => { void this.reload(); });
    await this.reload();
  }

  list(): readonly RejectedChange[] {
    return this.items;
  }

  /** Spara avvisningar ur en reconcile (samma ändring bara en gång). */
  async record(conflicts: readonly ConflictRecord[], now: number = Date.now()): Promise<void> {
    const known = new Set(this.items.map((i) => i.id));
    const fresh = conflicts.filter((c) => !known.has(c.mutation.mutationId)).map((c) => toRejected(c, now));
    if (fresh.length === 0) return;
    for (const change of fresh) await this.persistence.add(change);
    await this.reload();
  }

  /**
   * Kasta ändringen — serverns läge gäller (#1348): raderna den rörde hämtas
   * från servern och ersätter det lokala, och först sedan tas den bort härifrån.
   * Nås inte servern ligger den kvar.
   */
  async discard(id: string): Promise<void> {
    const change = this.items.find((i) => i.id === id);
    if (!change) return;
    await this.requireHandlers().restore(change);
    await this.remove(id);
  }

  /**
   * Försök igen: ta bort ändringen härifrån och köa den på nytt. Den tas bort
   * FÖRST — samma mutationId kan avvisas igen innan kön hunnit svara, och då
   * ska den nya avvisningen sparas. Misslyckas köandet läggs den tillbaka.
   */
  async retry(id: string): Promise<void> {
    const change = this.items.find((i) => i.id === id);
    if (!change) return;
    if (!canRetry(change)) throw new Error("Ändringen avvisas igen om den skickas på nytt. Kasta den och gör om ändringen i AVA.");
    const handlers = this.requireHandlers();
    await this.remove(id);
    try {
      await handlers.retry(change);
    } catch (err) {
      await this.persistence.add(change);
      await this.reload();
      throw err;
    }
  }

  /** Registrera vad synken gör med en avvisad ändring; returnerar avregistreringen. */
  setHandlers(handlers: RejectedChangeHandlers): () => void {
    this.handlers = handlers;
    return () => { if (this.handlers === handlers) this.handlers = null; };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private requireHandlers(): RejectedChangeHandlers {
    if (!this.handlers) throw new Error(NO_SYNC);
    return this.handlers;
  }

  private async remove(id: string): Promise<void> {
    await this.persistence.delete(id);
    await this.reload();
  }

  /** Listan ur lagringen, inte flikens kopia (#1346). */
  private async reload(): Promise<void> {
    this.items = await this.persistence.load();
    this.publish();
  }

  private publish(): void {
    for (const l of this.listeners) l(this.items);
  }
}

/** Flikens avvisade ändringar. */
export const rejectedChanges = new RejectedChanges();
