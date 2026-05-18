/**
 * `IDataStore` — abstraktionen som möjliggör att samma kodbas kör i två lägen:
 *
 *   - **Server-läget** (PostgreSQL): `PostgresStore` implementerar mot Prisma
 *   - **Local-first-läget** (SQLite + git): `LocalGitStore` skriver SQLite +
 *     projicerar JSON-filer i git working tree
 *
 * Se `docs/architecture-future.md` §6 för fullständig design.
 *
 * Status: **interface-skiss**. Existerande tRPC-routrar pratar fortfarande
 * direkt mot Prisma (`ctx.prisma`). Migration sker stegvis under Fas 2:
 *
 *   1. Nya features (event-log, regelmotor, claims) skrivs DIRECT mot
 *      `IDataStore` — de behövs i båda lägen från start.
 *   2. Befintliga routrar migreras en i taget när vi närmar oss Fas 3.
 *   3. När routern migrerats använder den `ctx.dataStore.matters` etc istället
 *      för `ctx.prisma.matter`.
 *
 * Den här filen är ett *kontrakt* — den definierar vad lägena MÅSTE stödja.
 * Konkreta implementationer ligger i `PostgresStore.ts` och senare
 * `LocalGitStore.ts`.
 */

import type { AvaEvent, EmitInput, EventFilter } from "../events/schema";

// ─── Event-log ────────────────────────────────────────────────────────

export interface IEventLog {
  /**
   * Skriv ett event till loggen. Returnerar det skapade eventet med
   * `id` och `ts` ifyllt. Append-only — events får aldrig modifieras.
   */
  emit(input: EmitInput): Promise<AvaEvent>;

  /** Synchront query (begränsat antal events). Använd `iterate` för streaming. */
  query(filter: EventFilter): Promise<AvaEvent[]>;

  /** Async-iterator för stora result-sets. */
  iterate(filter: EventFilter): AsyncIterable<AvaEvent>;

  /**
   * Registrera handler som anropas när nya events skrivs. Returnerar en
   * disposer som unsubscribar. Används av:
   *   - Server-läget: WebSocket/SSE-broadcast till connected klienter
   *   - Local-first-läget: regel-executorn pollar inte, den lyssnar lokalt
   */
  onNewEvent(handler: (event: AvaEvent) => void | Promise<void>): () => void;
}

// ─── Claim-store (bara aktiv i local-first-läget) ─────────────────────

export interface IClaimStore {
  /**
   * Försök claima en arbets-enhet. Returnerar `true` om vi fick claim,
   * `false` om någon annan redan har den eller om vår push misslyckades
   * efter alla retries.
   *
   * I server-läget: trivialt — en INSERT i `claims`-tabellen som
   * UNIQUE-constraint avgör.
   *
   * I local-first-läget: pre-fetch → preferred-runner-delay → JSONL-append
   * → commit → push → CAS avgör. Se §3.7 i `architecture-future.md`.
   */
  tryClaim(claimId: string, opts: ClaimOpts): Promise<boolean>;

  /**
   * Kolla om en claim har expiretat utan att den motsvarande
   * `rule.executed`-eventet har skrivits. Används för stale-claim-failover.
   */
  isStale(claimId: string): Promise<boolean>;
}

export interface ClaimOpts {
  /** Time-to-live för claim:en i sekunder. Default 300 (5 min). */
  ttlSec?: number;
  /** För deterministisk preferred-runner-ordning. */
  preferredRunnerOrder?: string[];
  /** Vår egen user-id. */
  me: string;
}

// ─── Domän-repos ──────────────────────────────────────────────────────
//
// I Fas 2 läggs interface-typer här för matters, contacts, documents osv.
// Initialt skriver vi mot `ctx.prisma` direkt. När en router migreras
// flyttar man dess CRUD-anrop till motsvarande repo-interface.
//
// Exempel på vad det kan se ut:
//
//   export interface IMatterRepo {
//     findById(id: string): Promise<Matter | null>;
//     findByOrganization(orgId: string): Promise<Matter[]>;
//     create(input: MatterCreateInput): Promise<Matter>;
//     update(id: string, patch: MatterUpdateInput): Promise<Matter>;
//     // ...
//   }

// ─── Aggregat ─────────────────────────────────────────────────────────

export interface IDataStore {
  /** Event-loggen. Alltid tillgänglig i båda lägen. */
  events: IEventLog;

  /**
   * Claim-store. Bara satt i local-first-läget; i server-läget används
   * inga claims (en single rule-executor mekar inte mot sig själv).
   */
  claims?: IClaimStore;

  // Repos läggs till i Fas 2:
  // matters: IMatterRepo;
  // contacts: IContactRepo;
  // documents: IDocumentRepo;
  // invoices: IInvoiceRepo;
  // ...
}
