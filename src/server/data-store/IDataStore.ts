/**
 * `IDataStore` — abstraktionen som möjliggör att samma kodbas kör i två lägen:
 *
 *   - **Server-läget** (PostgreSQL): `PostgresStore` implementerar mot Prisma
 *   - **Local-first-läget** (SQLite + git): `LocalGitStore` (Fas 3) skriver
 *     samma Prisma-API men mot SQLite + projicerar JSON-filer i git working tree
 *
 * Se `docs/architecture-future.md` §6 för fullständig design.
 *
 * Designval: vi exponerar Prisma's egna `Delegate`-typer direkt istället för
 * att handskriva 15 stycken `IMatterRepo`/`IContactRepo`-interfaces. Det ger:
 *
 *   - Type-safety identisk med direkt `prisma.matter.*`-användning
 *   - Inga "vilka metoder ska repon ha?"-beslut att underhålla
 *   - LocalGitStore implementerar samma kontrakt — Prisma stödjer SQLite
 *     out-of-the-box, så en lokal Prisma-klient mot SQLite täcker oss.
 *
 * Kostnaden: routrarna binds vid Prisma's typer. Eftersom Prisma ÄR vårt ORM
 * (även i local-first-läget) är detta inte en läckande abstraktion utan ett
 * dokumenterat val.
 */

import type { prisma } from "@/server/db";
import type { AvaEvent, EmitInput, EventFilter } from "../events/schema";

// ─── Event-log ────────────────────────────────────────────────────────

export interface IEventLog {
  emit(input: EmitInput): Promise<AvaEvent>;
  query(filter: EventFilter): Promise<AvaEvent[]>;
  iterate(filter: EventFilter): AsyncIterable<AvaEvent>;
  onNewEvent(handler: (event: AvaEvent) => void | Promise<void>): () => void;
}

// ─── Claim-store (bara aktiv i local-first-läget) ─────────────────────

export interface IClaimStore {
  tryClaim(claimId: string, opts: ClaimOpts): Promise<boolean>;
  isStale(claimId: string): Promise<boolean>;
}

export interface ClaimOpts {
  ttlSec?: number;
  preferredRunnerOrder?: string[];
  me: string;
}

// ─── Domän-delegates ──────────────────────────────────────────────────
//
// Genvägstyper — Prisma's egen `XDelegate<>` är komplex generic. Vi
// extrahera typen direkt från `prisma`-instansen.

type PrismaInstance = typeof prisma;

export type MatterDelegate = PrismaInstance["matter"];
export type ContactDelegate = PrismaInstance["contact"];
export type MatterContactDelegate = PrismaInstance["matterContact"];
export type DocumentDelegate = PrismaInstance["document"];
export type DocumentFolderDelegate = PrismaInstance["documentFolder"];
export type DocumentTemplateDelegate = PrismaInstance["documentTemplate"];
export type DocumentAnalysisSuggestionDelegate = PrismaInstance["documentAnalysisSuggestion"];
export type MatterEventSuggestionDelegate = PrismaInstance["matterEventSuggestion"];
export type InvoiceDelegate = PrismaInstance["invoice"];
export type TimeEntryDelegate = PrismaInstance["timeEntry"];
export type ExpenseDelegate = PrismaInstance["expense"];
export type UserDelegate = PrismaInstance["user"];
export type OrganizationDelegate = PrismaInstance["organization"];
export type OfficeDelegate = PrismaInstance["office"];
export type ConflictCheckDelegate = PrismaInstance["conflictCheck"];
export type PaymentDelegate = PrismaInstance["payment"];
export type PaymentPlanDelegate = PrismaInstance["paymentPlan"];
export type AccontoDeductionDelegate = PrismaInstance["invoiceAccontoDeduction"];

// ─── Transaktionsvy ───────────────────────────────────────────────────
//
// Det `tx`-objekt en `transaction(fn)`-callback får. Speglar store:ns
// delegates (plural-namn) så routerkod ser samma API inuti som utanför
// transaktionen. I server-läget mappas detta mot Prisma's interaktiva
// transaktion; i local-first/demo mot en in-memory snapshot/rollback.

export interface DataStoreTx {
  matters: MatterDelegate;
  matterContacts: MatterContactDelegate;
  contacts: ContactDelegate;
  documents: DocumentDelegate;
  documentFolders: DocumentFolderDelegate;
  documentTemplates: DocumentTemplateDelegate;
  documentAnalysisSuggestions: DocumentAnalysisSuggestionDelegate;
  matterEventSuggestions: MatterEventSuggestionDelegate;
  invoices: InvoiceDelegate;
  timeEntries: TimeEntryDelegate;
  expenses: ExpenseDelegate;
  users: UserDelegate;
  organizations: OrganizationDelegate;
  offices: OfficeDelegate;
  conflictChecks: ConflictCheckDelegate;
  payments: PaymentDelegate;
  paymentPlans: PaymentPlanDelegate;
  accontoDeductions: AccontoDeductionDelegate;
}

// ─── Aggregat ─────────────────────────────────────────────────────────

export interface IDataStore {
  /** Event-loggen. Alltid tillgänglig i båda lägen. */
  events: IEventLog;

  /**
   * Claim-store. Bara satt i local-first-läget; i server-läget används
   * inga claims (en single rule-executor mekar inte mot sig själv).
   */
  claims?: IClaimStore;

  // ─── Domän-repos (Prisma-delegates) ─────────────────────────────
  readonly matters: MatterDelegate;
  readonly matterContacts: MatterContactDelegate;
  readonly contacts: ContactDelegate;
  readonly documents: DocumentDelegate;
  readonly documentFolders: DocumentFolderDelegate;
  readonly documentTemplates: DocumentTemplateDelegate;
  readonly documentAnalysisSuggestions: DocumentAnalysisSuggestionDelegate;
  readonly matterEventSuggestions: MatterEventSuggestionDelegate;
  readonly invoices: InvoiceDelegate;
  readonly timeEntries: TimeEntryDelegate;
  readonly expenses: ExpenseDelegate;
  readonly users: UserDelegate;
  readonly organizations: OrganizationDelegate;
  readonly offices: OfficeDelegate;
  readonly conflictChecks: ConflictCheckDelegate;

  /**
   * Escape-hatch för komplexa frågor som inte ryms i delegates:
   *   - $transaction
   *   - $queryRaw / $executeRaw
   *   - Aggregations över flera tabeller
   *
   * Markerad som "intern" — undvik i ny kod, men det är ofta enklare än
   * att lägga till en ny method på interfacet för en engångs-aggregation.
   * Vid Fas 3 migreras varje raw-användning ett-i-taget om de inte fungerar
   * i SQLite-läget.
   */
  readonly raw: PrismaInstance;

  /**
   * Kör `fn` i en transaktion. Allt-eller-inget: kastar `fn` så committas
   * inga ändringar (och i local-first-läget: inga write-back-filer skrivs).
   *
   * Ersätter `raw.$transaction` i routerkod — så routrarna inte behöver
   * känna till om de kör mot Prisma (server) eller in-memory + git
   * (local-first). I server-läget delegeras till Prisma's interaktiva
   * transaktion; i demo/local-first till en snapshot/rollback-impl.
   */
  transaction<T>(fn: (tx: DataStoreTx) => Promise<T>): Promise<T>;
}
