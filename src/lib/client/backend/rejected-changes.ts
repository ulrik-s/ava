/**
 * Avvisade ändringar (#1266, ADR 0037) — ingen avvisad ändring får försvinna
 * tyst.
 *
 * När servern avvisar en köad ändring (en kollega hann fakturera posterna, en
 * låst post, en rad någon annan ändrat) kvitteras den i kön och serverns läge
 * ersätter det lokala. Här sparas den i stället för att glömmas: vad det var,
 * varför, och vad som gällde på servern. Juristen kan **försöka igen** (efter
 * att ha ändrat det som stoppade den) eller **kasta** den.
 *
 * Persisteras i IndexedDB (överlever omladdning). En modul-global instans —
 * det finns en server-synk per flik; `ServerFirstSync` registrerar hur ett
 * nytt försök köas (`setRetryHandler`).
 */

import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import type { QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { ConflictRecord } from "@/lib/server/data-store/in-memory/reconcile-engine";
import { describeQueueEntry } from "./describe-queue-entry";

/** En avvisad ändring som väntar på att användaren tar ställning. */
export interface RejectedChange {
  /** Köpostens mutationId. */
  id: string;
  /** Epoch-ms när servern avvisade den. */
  rejectedAt: number;
  /** Vad ändringen var, på svenska ("Ny tidspost", "Ändring av faktura"). */
  label: string;
  /** Serverns skäl. */
  reason: string;
  /** Köposten — det som skickas igen vid ett nytt försök. */
  entry: QueueEntry;
  /** Serverns rad när ändringen avvisades (radkonflikter). */
  current?: Record<string, unknown>;
}

export interface RejectedChangesPersistence {
  load(): Promise<RejectedChange[]>;
  save(items: readonly RejectedChange[]): Promise<void>;
}

/** IndexedDB (webbläsaren). */
export class IndexedDbRejectedChangesPersistence implements RejectedChangesPersistence {
  private readonly kv: IdbKv;
  constructor(factory: IDBFactory = globalThis.indexedDB, dbName = "ava-rejected-changes") {
    this.kv = new IdbKv(factory, dbName, "rejected");
  }
  async load(): Promise<RejectedChange[]> {
    return (await this.kv.get<RejectedChange[]>("items")) ?? [];
  }
  async save(items: readonly RejectedChange[]): Promise<void> {
    await this.kv.put("items", [...items]);
  }
}

/** Minnet (tester, demo). */
export class InMemoryRejectedChangesPersistence implements RejectedChangesPersistence {
  private items: RejectedChange[] = [];
  async load(): Promise<RejectedChange[]> { return [...this.items]; }
  async save(items: readonly RejectedChange[]): Promise<void> { this.items = [...items]; }
}

/** Köar ett nytt försök med en avvisad ändring. */
export type RetryHandler = (change: RejectedChange) => Promise<void>;

type Listener = (items: readonly RejectedChange[]) => void;

function toRejected(c: ConflictRecord, now: number): RejectedChange {
  return {
    id: c.mutation.mutationId,
    rejectedAt: now,
    label: describeQueueEntry(c.mutation),
    reason: c.reason,
    entry: c.mutation,
    ...(c.current ? { current: c.current } : {}),
  };
}

export class RejectedChanges {
  private items: RejectedChange[] = [];
  private readonly listeners = new Set<Listener>();
  private retryHandler: RetryHandler | null = null;

  constructor(private persistence: RejectedChangesPersistence = new InMemoryRejectedChangesPersistence()) {}

  /** Byt lagring och läs in det som sparats (vid start). */
  async attach(persistence: RejectedChangesPersistence): Promise<void> {
    this.persistence = persistence;
    this.items = await persistence.load();
    this.publish();
  }

  list(): readonly RejectedChange[] {
    return this.items;
  }

  /** Spara avvisningar ur en reconcile (samma ändring bara en gång). */
  async record(conflicts: readonly ConflictRecord[], now: number = Date.now()): Promise<void> {
    const known = new Set(this.items.map((i) => i.id));
    const fresh = conflicts.filter((c) => !known.has(c.mutation.mutationId)).map((c) => toRejected(c, now));
    if (fresh.length === 0) return;
    await this.commit([...this.items, ...fresh]);
  }

  /** Kasta ändringen — serverns läge gäller. */
  async discard(id: string): Promise<void> {
    await this.commit(this.items.filter((i) => i.id !== id));
  }

  /** Försök igen: köa ändringen på nytt och ta bort den härifrån. */
  async retry(id: string): Promise<void> {
    const change = this.items.find((i) => i.id === id);
    if (!change) return;
    if (!this.retryHandler) throw new Error("Ingen synk mot servern — försök igen när du är ansluten.");
    await this.retryHandler(change);
    await this.discard(id);
  }

  /** Registrera hur ett nytt försök köas; returnerar avregistreringen. */
  setRetryHandler(handler: RetryHandler): () => void {
    this.retryHandler = handler;
    return () => { if (this.retryHandler === handler) this.retryHandler = null; };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private async commit(next: RejectedChange[]): Promise<void> {
    this.items = next;
    await this.persistence.save(next);
    this.publish();
  }

  private publish(): void {
    for (const l of this.listeners) l(this.items);
  }
}

/** Flikens avvisade ändringar. */
export const rejectedChanges = new RejectedChanges();
