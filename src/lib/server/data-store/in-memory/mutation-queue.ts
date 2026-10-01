/**
 * `MutationQueue` (#413, ADR 0017) — den optimistiska mutations-kön i offline-
 * klienten. Mutationer appliceras lokalt direkt (av `LocalStore`) och köas här
 * för uppspelning mot servern vid reconnect (reconcile-motorn #414).
 *
 * Varje köpost bär ett klient-genererat **UUIDv7** (`mutationId`) — tidsordnat
 * (ADR 0003) och idempotent: re-enqueue av samma id är en no-op, och
 * uppspelning kan dedupa säkert. Köordningen bevaras (FIFO).
 *
 * Kön är persistens-agnostisk (`MutationQueuePersistence`-port) → IndexedDB i
 * browsern, in-memory i tester/demo.
 *
 * Flera flikar (#1346): lagringen är sanningen. Varje post skrivs och tas bort
 * för sig (aldrig hela kön), och `refresh()` läser om lagringen innan kön
 * spelas upp, så att en flik inte arbetar mot en inaktuell kopia.
 *
 * En post som fliken skrev lokalt men som en annan flik skickade och
 * kvitterade (#1402) samlas i {@link MutationQueue.takeSettledElsewhere}: fliken
 * vet inte om servern godtog eller avvisade den, så dess rader ska läsas om
 * från servern — annars lever en avvisad ändrings rader kvar i fliken.
 */

import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { organizationIdSchema, userIdSchema } from "@/lib/shared/schemas/ids";
import { QUEUE_FORMAT_VERSION } from "@/lib/shared/sync/queue-format";
import { uuidv7 } from "@/lib/shared/uuid";
import type { ChangeChannel } from "./change-channel";
import { IdbEntryStore, v2Location, type EntryStoreLocation, type LegacyListPlace } from "./idb-entry-store";
import { reportIdbProblem } from "./idb-open";
import type { MutationEvent } from "./writable-delegate";

const rowRecord = z.record(z.string(), z.unknown());

/**
 * Vem som köade posten (#1347): användaren och byrån. Kön spelar bara upp sin
 * egen användares poster, och servern vägrar en post som inte är den
 * inloggades. Saknas på poster köade före #1347 — de ligger i användarens
 * egen databas och är därmed hennes.
 */
export const queueOwnerSchema = z.object({ principalId: userIdSchema, organizationId: organizationIdSchema }).strict();

/** Vem som köade posten. */
export type QueueOwner = z.infer<typeof queueOwnerSchema>;

/** En radpost (radkön), så som den sparas i IndexedDB. */
const queuedMutationSchema = z.object({
  /** Radpost (radkön). Saknas på poster persisterade före #1265 — de är rader. */
  type: z.literal("row").exactOptional(),
  /** Klient-genererat UUIDv7 — dedupe-nyckel + idempotent uppspelning. */
  mutationId: z.string(),
  entity: z.string(),
  kind: z.enum(["create", "update", "delete"]),
  /** Raden efter mutationen (bär sitt eget UUIDv7 `id` → server-upsert). */
  row: rowRecord,
  /** Föregående rad (update/delete) — för rollback/konflikt. */
  previous: rowRecord.exactOptional(),
  /** Observerad `version` vid mutationen (ADR 0017 optimistisk concurrency). */
  baseVersion: z.number().exactOptional(),
  enqueuedAt: z.number(),
  /** Köformatet posten skrevs i (#1247). Saknas på poster från före stämplingen = 1. */
  format: z.number().optional(),
  owner: queueOwnerSchema.exactOptional(),
});

/** En rad som ett köat procedur-anrop skrev lokalt (för att läsa tillbaka serverns läge). */
const procedureTouchSchema = z.object({ entity: z.string(), id: z.string() });

/**
 * Ett köat procedur-anrop (#1265, ADR 0037): servern kör om `path(input)`
 * auktoritativt med samma `appRouter`. Klientens lokala resultat är bara
 * optimistiskt — `touches` säger vilka rader som ska ersättas av serverns läge.
 */
const queuedProcedureCallSchema = z.object({
  type: z.literal("procedure"),
  mutationId: z.string(),
  /** tRPC-sökvägen, t.ex. `timeEntry.create` (se `QUEUED_PROCEDURES`). */
  path: z.string(),
  input: rowRecord,
  /** Klientkodens version när anropet köades (för migrering, #1247/#1269). */
  codeVersion: z.string(),
  touches: z.array(procedureTouchSchema),
  enqueuedAt: z.number(),
  /** Köformatet posten skrevs i (#1247). Saknas på poster från före stämplingen = 1. */
  format: z.number().optional(),
  owner: queueOwnerSchema.exactOptional(),
});

/** En köpost så som den sparas (#1346): tolkas strikt när den läses ur IndexedDB. */
export const queueEntrySchema = z.union([queuedProcedureCallSchema, queuedMutationSchema]);

/** En radpost i kön. */
export type QueuedMutation = z.infer<typeof queuedMutationSchema>;
/** En rad som ett köat procedur-anrop skrev lokalt. */
export type ProcedureTouch = z.infer<typeof procedureTouchSchema>;
/** Ett köat procedur-anrop. */
export type QueuedProcedureCall = z.infer<typeof queuedProcedureCallSchema>;
/** En post i kön: en färdig rad eller ett procedur-anrop. */
export type QueueEntry = z.infer<typeof queueEntrySchema>;

/** Köades posten av `owner`? En post utan ägare (före #1347) hör till databasens användare. */
export function isOwnedBy(entry: QueueEntry, owner: QueueOwner): boolean {
  return !entry.owner
    || (entry.owner.principalId === owner.principalId && entry.owner.organizationId === owner.organizationId);
}

/** Är posten ett procedur-anrop (och inte en rad)? */
export function isProcedureCall(entry: QueueEntry): entry is QueuedProcedureCall {
  return entry.type === "procedure";
}

/** Klientkodens version — deploy-sha:n när den finns (samma som demo-cachens nyckel). */
export const SYNC_CODE_VERSION = process.env.NEXT_PUBLIC_DEMO_VERSION || "dev";

/**
 * Var kön sparas (#1346): en post i taget, inte hela kön. Flera flikar delar
 * lagringen — en flik får bara lägga till, ersätta och ta bort sina egna
 * poster, aldrig skriva tillbaka sin (kanske inaktuella) kopia av hela kön.
 */
export interface MutationQueuePersistence {
  /** Alla poster i köordning (FIFO). */
  load(): Promise<QueueEntry[]>;
  /** Lägg posten sist. Finns `mutationId` redan händer ingenting. */
  add(entry: QueueEntry): Promise<void>;
  /** Ersätt posten på sin plats (finns den inte läggs den sist). */
  replace(entry: QueueEntry): Promise<void>;
  /** Ta bort posten (finns den inte händer ingenting). */
  delete(mutationId: string): Promise<void>;
  /** Lyssna på andra flikars ändringar i kön. Returnerar avregistreringen. */
  subscribe?(listener: () => void): () => void;
}

/** In-memory-persistens (tester/demo) — djupkopierar för att undvika delad referens. */
export class InMemoryMutationQueuePersistence implements MutationQueuePersistence {
  constructor(private items: QueueEntry[] = []) {}
  async load(): Promise<QueueEntry[]> {
    return structuredClone(this.items);
  }
  async add(entry: QueueEntry): Promise<void> {
    if (!this.items.some((e) => e.mutationId === entry.mutationId)) this.items.push(structuredClone(entry));
  }
  async replace(entry: QueueEntry): Promise<void> {
    const index = this.items.findIndex((e) => e.mutationId === entry.mutationId);
    if (index < 0) this.items.push(structuredClone(entry));
    else this.items[index] = structuredClone(entry);
  }
  async delete(mutationId: string): Promise<void> {
    this.items = this.items.filter((e) => e.mutationId !== mutationId);
  }
}

/** Var kön låg före #1346: en array under nyckeln `pending`. */
export const QUEUE_LEGACY_LIST: LegacyListPlace = { storeName: "queue", key: "pending", idField: "mutationId" };

/**
 * IndexedDB-persistens — en rad per köpost (#1346). Med ett databasnamn ligger
 * raderna i `<dbName>-v2` och den gamla databasens kö (allt under nyckeln
 * `pending`) flyttas hit vid varje läsning — utan att den gamla databasen
 * uppgraderas (se `idb-entry-store.ts`). Användarens egen kö (#1347) ges som
 * en `EntryStoreLocation`.
 */
export class IndexedDbMutationQueuePersistence implements MutationQueuePersistence {
  private readonly entries: IdbEntryStore<QueueEntry>;
  constructor(
    factory: IDBFactory = globalThis.indexedDB,
    at: string | EntryStoreLocation = "ava-mutation-queue",
    channel?: ChangeChannel,
  ) {
    this.entries = new IdbEntryStore({
      factory, schema: queueEntrySchema,
      location: typeof at === "string" ? v2Location(factory, at, QUEUE_LEGACY_LIST) : at,
      ...(channel ? { channel } : {}),
    });
  }
  load(): Promise<QueueEntry[]> {
    return this.entries.load();
  }
  add(entry: QueueEntry): Promise<void> {
    return this.entries.add(entry.mutationId, entry);
  }
  replace(entry: QueueEntry): Promise<void> {
    return this.entries.put(entry.mutationId, entry);
  }
  delete(mutationId: string): Promise<void> {
    return this.entries.delete(mutationId);
  }
  subscribe(listener: () => void): () => void {
    return this.entries.subscribe(listener);
  }
}

export interface EnqueueOpts {
  /** Explicit mutationId för idempotent enqueue (annars genereras UUIDv7). */
  mutationId?: string;
  baseVersion?: number;
  /** Injicerad tidsstämpel (deterministiska tester). */
  now?: number;
}

/** Val för `enqueueProcedure`. */
export interface EnqueueProcedureOpts {
  mutationId?: string;
  now?: number;
  codeVersion?: string;
}

export class MutationQueue {
  private items: QueueEntry[] = [];
  /**
   * Poster vars optimistiska skrivningar kan finnas i flikens lokala läge
   * (#1402): de som fanns när kön hydrerades (snapshotet kan bära dem) och de
   * fliken själv köat. En annan fliks nya poster finns bara i dess eget minne.
   */
  private local = new Set<string>();
  /** Flikens poster som en annan flik har kvitterat sedan sist (#1402). */
  private settledElsewhere: QueueEntry[] = [];
  /** Kedjan som gör att flikens egna köoperationer körs en i taget. */
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * @param owner Användaren kön arbetar som (#1347). Hennes nya poster stämplas
   *   med henne, och en annan användares poster läses aldrig in — de spelas
   *   inte upp, kvitteras inte och tas inte bort. Utan ägare (demon, tester)
   *   läses allt.
   */
  constructor(private readonly persistence?: MutationQueuePersistence, private readonly owner?: QueueOwner) {}

  /** Skapa en kö och hydrera den ur persistensen (om någon). */
  static async hydrate(persistence?: MutationQueuePersistence, owner?: QueueOwner): Promise<MutationQueue> {
    const q = new MutationQueue(persistence, owner);
    await q.refresh();
    q.local = new Set(q.items.map((e) => e.mutationId));
    return q;
  }

  /**
   * Läs om kön ur lagringen (#1346). Andra flikar kan ha köat eller kvitterat
   * poster sedan fliken läste sist; lagringen är sanningen, inte flikens kopia.
   */
  refresh(): Promise<void> {
    return this.serial(async () => {
      if (!this.persistence) return;
      const next = this.ownEntries(await this.persistence.load());
      this.noteSettledElsewhere(next);
      this.items = next;
    });
  }

  /** Flikens poster som inte längre finns i lagringen har en annan flik kvitterat (#1402). */
  private noteSettledElsewhere(next: readonly QueueEntry[]): void {
    const remaining = new Set(next.map((e) => e.mutationId));
    for (const entry of this.items) {
      if (!this.local.has(entry.mutationId) || remaining.has(entry.mutationId)) continue;
      this.local.delete(entry.mutationId);
      this.settledElsewhere.push(entry);
    }
  }

  /**
   * Flikens poster som en annan flik har skickat och kvitterat sedan förra
   * anropet (#1402) — deras rader ska läsas om från servern. Töms av anropet.
   */
  takeSettledElsewhere(): QueueEntry[] {
    const settled = this.settledElsewhere;
    this.settledElsewhere = [];
    return settled;
  }

  /** Bara ägarens poster (#1347); en annan användares rapporteras och lämnas orörda. */
  private ownEntries(entries: QueueEntry[]): QueueEntry[] {
    const owner = this.owner;
    if (!owner) return entries;
    const own = entries.filter((e) => isOwnedBy(e, owner));
    if (own.length < entries.length) {
      reportIdbProblem(new Error(`${entries.length - own.length} köade ändringar tillhör en annan användare och spelas inte upp.`));
    }
    return own;
  }

  /**
   * Lyssna på andra flikars ändringar i kön (#1346): kön läses om och sedan
   * anropas `listener`. Returnerar avregistreringen.
   */
  onExternalChange(listener: () => void): () => void {
    const persistence = this.persistence;
    if (!persistence?.subscribe) return () => undefined;
    return persistence.subscribe(() => { void this.refresh().then(listener); });
  }

  /** Köa en mutation sist. Idempotent på `mutationId` (re-enqueue → no-op). */
  enqueue(event: MutationEvent<Record<string, unknown>>, opts: EnqueueOpts = {}): Promise<QueuedMutation> {
    return this.serial(async () => {
      const mutationId = opts.mutationId ?? uuidv7(opts.now);
      const existing = this.items.find((m): m is QueuedMutation => m.mutationId === mutationId && !isProcedureCall(m));
      if (existing) return existing;
      const item = omitUndefined({
        mutationId,
        entity: event.entity,
        kind: event.kind,
        row: event.row,
        previous: event.previous,
        baseVersion: opts.baseVersion,
        enqueuedAt: opts.now ?? Date.now(),
        format: QUEUE_FORMAT_VERSION,
        owner: this.owner,
      }) as QueuedMutation;
      await this.append(item);
      return item;
    });
  }

  /** Köa ett procedur-anrop sist (#1265). Idempotent på `mutationId`. */
  enqueueProcedure(
    call: Pick<QueuedProcedureCall, "path" | "input" | "touches">,
    opts: EnqueueProcedureOpts = {},
  ): Promise<QueuedProcedureCall> {
    return this.serial(async () => {
      const mutationId = opts.mutationId ?? uuidv7(opts.now);
      const existing = this.items.find((m): m is QueuedProcedureCall => m.mutationId === mutationId && isProcedureCall(m));
      if (existing) return existing;
      const item: QueuedProcedureCall = {
        type: "procedure",
        mutationId,
        path: call.path,
        input: call.input,
        codeVersion: opts.codeVersion ?? SYNC_CODE_VERSION,
        touches: call.touches,
        enqueuedAt: opts.now ?? Date.now(),
        format: QUEUE_FORMAT_VERSION,
        ...(this.owner ? { owner: this.owner } : {}),
      };
      await this.append(item);
      return item;
    });
  }

  /**
   * Lägg tillbaka en tidigare köad post sist, oförändrad (#1348 "Försök igen"):
   * samma mutationId, köformat, kodversion och tidpunkt. Idempotent på `mutationId`.
   */
  requeue(entry: QueueEntry): Promise<void> {
    return this.serial(async () => {
      if (!this.items.some((m) => m.mutationId === entry.mutationId)) await this.append(entry);
    });
  }

  /** Köposterna i FIFO-ordning (för uppspelning). */
  pending(): readonly QueueEntry[] {
    return this.items;
  }

  size(): number {
    return this.items.length;
  }

  has(mutationId: string): boolean {
    return this.items.some((m) => m.mutationId === mutationId);
  }

  /** Ta bort en post efter server-bekräftelse — bara den posten, i lagringen också. */
  ack(mutationId: string): Promise<void> {
    return this.serial(async () => {
      this.items = this.items.filter((m) => m.mutationId !== mutationId);
      this.local.delete(mutationId);
      await this.persistence?.delete(mutationId);
    });
  }

  /**
   * Ersätt kön (id-reparation vid uppstart, se legacy-id-repair.ts). Poster med
   * samma `mutationId` ersätts på sin plats; bara poster den här fliken kände
   * till och som inte finns kvar tas bort — en annan fliks nya poster rörs inte.
   */
  replaceAll(items: readonly QueueEntry[]): Promise<void> {
    return this.serial(async () => {
      const kept = new Set(items.map((e) => e.mutationId));
      for (const old of this.items) if (!kept.has(old.mutationId)) await this.persistence?.delete(old.mutationId);
      for (const entry of items) await this.persistence?.replace(entry);
      this.items = [...items];
      this.local = kept;
    });
  }

  /** Töm de poster fliken känner till. */
  clear(): Promise<void> {
    return this.serial(async () => {
      for (const entry of this.items) await this.persistence?.delete(entry.mutationId);
      this.items = [];
      this.local.clear();
    });
  }

  private async append(item: QueueEntry): Promise<void> {
    this.items.push(item);
    this.local.add(item.mutationId);
    await this.persistence?.add(item);
  }

  /** Kör `fn` efter flikens tidigare köoperationer (en omläsning blandas aldrig med en skrivning). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
