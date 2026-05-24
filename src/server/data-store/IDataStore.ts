/**
 * `IDataStore` — git-first datalager. Single implementation: `DemoDataStore`
 * som håller en in-memory `DemoSource` + skriver tillbaka till FSA/git working
 * copy via `onMutate`-callback.
 *
 * Tidigare hade vi även `PostgresStore` (server-mode med Prisma) och
 * `LocalGitStore` (Tauri helper-mode med SQLite). Båda är borttagna —
 * arkitekturen är nu rent local-first: browser läser/skriver JSON i git.
 *
 * Delegate-typerna mimikrerar Prisma's API-yta (findUnique, findMany,
 * create, update, ...) eftersom det är formen vi har på alla routrar idag.
 * Tighten i framtiden mot Zod-inferade row-typer per delegate.
 */

import type { AvaEvent, EmitInput, EventFilter } from "../events/schema";

// ─── Event-log ────────────────────────────────────────────────────────

export interface IEventLog {
  emit(input: EmitInput): Promise<AvaEvent>;
  query(filter: EventFilter): Promise<AvaEvent[]>;
  iterate(filter: EventFilter): AsyncIterable<AvaEvent>;
  onNewEvent(handler: (event: AvaEvent) => void | Promise<void>): () => void;
}

// ─── Claim-store (oanvänd i ren git-modell, kvar för framtida ev. hjälpprocess) ───

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
// Tunn generisk delegate som täcker den Prisma-stil-yta som routrarna
// använder. `Row` är raden i tabellen; vi använder en lös shape här eftersom
// callers redan har egna typade gardar. Tighten i framtiden:
//   type MatterRow = z.infer<typeof matterSchema>
//   export type MatterDelegate = Delegate<MatterRow>

// `any` är medvetet här under transitionsperioden — Prisma:s genererade
// delegate-typer hade exakta `where`/`select`/`include`-typer som vi inte
// kan återskapa utan en massiv router-omskrivning. Routrarna har egna
// `as`-casts där de behöver striktare typer; för övriga callers funkar
// `any` likt det gjorde med Prisma's flytande generics.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Delegate<Row = any> {
  findUnique(args: any): Promise<Row | null>;
  findUniqueOrThrow(args: any): Promise<Row>;
  findFirst(args?: any): Promise<Row | null>;
  findFirstOrThrow(args?: any): Promise<Row>;
  findMany(args?: any): Promise<Row[]>;
  create(args: any): Promise<Row>;
  update(args: any): Promise<Row>;
  updateMany(args: any): Promise<{ count: number }>;
  upsert(args: any): Promise<Row>;
  delete(args: any): Promise<Row>;
  deleteMany(args?: any): Promise<{ count: number }>;
  count(args?: any): Promise<number>;
  aggregate(args: any): Promise<any>;
  $queryRaw?: (...args: any[]) => Promise<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type MatterDelegate = Delegate;
export type ContactDelegate = Delegate;
export type MatterContactDelegate = Delegate;
export type DocumentDelegate = Delegate;
export type DocumentFolderDelegate = Delegate;
export type DocumentTemplateDelegate = Delegate;
export type DocumentAnalysisSuggestionDelegate = Delegate;
export type MatterEventSuggestionDelegate = Delegate;
export type InvoiceDelegate = Delegate;
export type TimeEntryDelegate = Delegate;
export type ExpenseDelegate = Delegate;
export type UserDelegate = Delegate;
export type OrganizationDelegate = Delegate;
export type OfficeDelegate = Delegate;
export type ConflictCheckDelegate = Delegate;
export type PaymentDelegate = Delegate;
export type PaymentPlanDelegate = Delegate;
export type AccontoDeductionDelegate = Delegate;

// ─── Transaktionsvy ───────────────────────────────────────────────────
//
// Det `tx`-objekt en `transaction(fn)`-callback får. Speglar store:ns
// delegates (plural-namn) så routerkod ser samma API inuti som utanför
// transaktionen. I demo-store: snapshot/rollback + buffered write-back.

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
  /** Event-loggen. */
  events: IEventLog;

  /** Claim-store. Oanvänd just nu (var aktiv i Tauri-helper-läget). */
  claims?: IClaimStore;

  // ─── Domän-repos ────────────────────────────────────────────────
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
   * Escape-hatch för komplexa frågor. Throwing-proxy i demo-store —
   * existerande callers (t.ex. fuzzy-name-search i conflict.ts) får
   * "ej implementerat"-fel om de anropas i ren git-modell. Refaktorera
   * dem ett-i-taget till in-memory-implementations.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly raw: any;

  /**
   * Kör `fn` i en transaktion. In-memory snapshot/rollback — alla
   * write-back-event buffras tills `fn` returnerar; vid throw rullas
   * source-array:erna tillbaka och inga JSON-filer skrivs.
   */
  transaction<T>(fn: (tx: DataStoreTx) => Promise<T>): Promise<T>;
}
