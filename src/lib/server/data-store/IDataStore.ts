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

import type {
  Contact, Matter, MatterContact, Document, DocumentFolder,
  DocumentTemplate, DocumentAnalysisSuggestion, MatterEventSuggestion,
  Invoice, TimeEntry, Expense, User, Organization, Office, ConflictCheck,
  Payment, PaymentPlan, AccontoDeduction, BillingRun, WriteOff, InvoiceDispatch,
  ExpectedReceivable,
  CalendarEvent, Task,
} from "@/lib/shared/schemas";
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

// ENDA kvarvarande `no-explicit-any`-undantaget i src efter #47. `args: any`
// på delegate-metoderna är den flytande Prisma-stil-query-ytan (where/select/
// include) som inte går att typa exakt utan en massiv router-omskrivning —
// det egna query-typsystemet spåras separat. `no-explicit-any` är `error`
// överallt annars (ratchet); detta block är det medvetna, dokumenterade
// undantaget. Returtyperna är däremot typade (`Joined<Row>`, #39) så branded
// id:n flödar ut även om query-INPUT förblir `any` här.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Kända relations-/join-fält som `include` kan lägga på en rad.
 *
 * Uppräknade som optional `any` — INTE en `[k: string]: any`-index-signatur —
 * eftersom en string-index-signatur tvättar bort Row:s EGNA fälttyper (särskilt
 * branded id:n, [[ids]]) till `any` i intersektionen. Med en uppräkning behåller
 * `Joined<Matter>["id"]` sin `MatterId`-typ, medan joinade fält fortsatt är `any`
 * (vi typar inte de exakta include-formerna här — det vore router-omskrivningen).
 */
export interface JoinedRelations {
  matter?: any; contact?: any; contacts?: any; matterLinks?: any;
  children?: any; parent?: any; documents?: any; document?: any;
  timeEntries?: any; expenses?: any; payments?: any; invoice?: any;
  folder?: any; paymentPlan?: any; billingRun?: any; reminders?: any;
  accontoInvoice?: any; finalInvoice?: any; creditNote?: any;
  uploadedBy?: any; recordedBy?: any; createdBy?: any; checkedBy?: any;
  user?: any; emails?: any; _count?: any;
}

/**
 * Output-typ för en delegate-fråga: basraden (`Row`, från Zod-schemat) plus
 * de optionella relations-fälten. Se `JoinedRelations` för varför det inte är
 * en index-signatur (branded id:n skulle annars tvättas bort till `any`).
 */
export type Joined<Row> = Row & JoinedRelations;

export interface Delegate<Row = any> {
  findUnique(args: any): Promise<Joined<Row> | null>;
  findUniqueOrThrow(args: any): Promise<Joined<Row>>;
  findFirst(args?: any): Promise<Joined<Row> | null>;
  findFirstOrThrow(args?: any): Promise<Joined<Row>>;
  findMany(args?: any): Promise<Joined<Row>[]>;
  // Skriv-args: `data`/`create`/`update` typas mot `Partial<Row>` så
  // write-literals (inkl. enum-fält) typkollas (#24). `where`/`include`/`select`
  // hålls lösa (flytande query-yta).
  create(args: { data: Partial<Row>; include?: unknown; select?: unknown }): Promise<Joined<Row>>;
  update(args: { where: unknown; data: Partial<Row>; include?: unknown; select?: unknown }): Promise<Joined<Row>>;
  updateMany(args: { where?: unknown; data: Partial<Row> }): Promise<{ count: number }>;
  upsert(args: { where: unknown; create: Partial<Row>; update: Partial<Row> }): Promise<Joined<Row>>;
  delete(args: any): Promise<Joined<Row>>;
  deleteMany(args?: any): Promise<{ count: number }>;
  count(args?: any): Promise<number>;
  aggregate(args: any): Promise<any>;
  $queryRaw?: (...args: any[]) => Promise<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Delegate-typerna är fortfarande Delegate<any>. Tightening per delegate via
// `Delegate<Matter>` etc. avslöjar legacy-mismatches mellan schemas (nullish)
// och kallar (förväntar `null`-only), samt relation-joins (matter.contacts)
// som inte finns i bas-schemat. Tighten har gjorts opt-in via TypedDelegate
// nedan så enskilda callers kan välja striktare typer när de vill.
export type MatterDelegate = Delegate<Matter>;
export type ContactDelegate = Delegate<Contact>;
export type MatterContactDelegate = Delegate<MatterContact>;
export type DocumentDelegate = Delegate<Document>;
export type DocumentFolderDelegate = Delegate<DocumentFolder>;
export type DocumentTemplateDelegate = Delegate<DocumentTemplate>;
export type DocumentAnalysisSuggestionDelegate = Delegate<DocumentAnalysisSuggestion>;
export type MatterEventSuggestionDelegate = Delegate<MatterEventSuggestion>;
export type InvoiceDelegate = Delegate<Invoice>;
export type TimeEntryDelegate = Delegate<TimeEntry>;
export type ExpenseDelegate = Delegate<Expense>;
export type UserDelegate = Delegate<User>;
export type OrganizationDelegate = Delegate<Organization>;
export type OfficeDelegate = Delegate<Office>;
export type ConflictCheckDelegate = Delegate<ConflictCheck>;
export type PaymentDelegate = Delegate<Payment>;
export type WriteOffDelegate = Delegate<WriteOff>;
export type InvoiceDispatchDelegate = Delegate<InvoiceDispatch>;
export type ExpectedReceivableDelegate = Delegate<ExpectedReceivable>;
export type PaymentPlanDelegate = Delegate<PaymentPlan>;
export type AccontoDeductionDelegate = Delegate<AccontoDeduction>;
export type BillingRunDelegate = Delegate<BillingRun>;
export type CalendarEventDelegate = Delegate<CalendarEvent>;
export type TaskDelegate = Delegate<Task>;

// Opt-in: enskilda callers som vill ha striktare row-typ kan importera
// dessa istället. T.ex. `const matters = ctx.dataStore.matters as MattersStrict`.
// TODO: när schema-mismatches är fixade kan vi växla över delegaterna ovan.
export type MattersStrict = Delegate<Matter>;
export type ContactsStrict = Delegate<Contact>;
export type MatterContactsStrict = Delegate<MatterContact>;
export type DocumentsStrict = Delegate<Document>;
export type DocumentFoldersStrict = Delegate<DocumentFolder>;
export type DocumentTemplatesStrict = Delegate<DocumentTemplate>;
export type DocumentAnalysisSuggestionsStrict = Delegate<DocumentAnalysisSuggestion>;
export type MatterEventSuggestionsStrict = Delegate<MatterEventSuggestion>;
export type InvoicesStrict = Delegate<Invoice>;
export type TimeEntriesStrict = Delegate<TimeEntry>;
export type ExpensesStrict = Delegate<Expense>;
export type UsersStrict = Delegate<User>;
export type OrganizationsStrict = Delegate<Organization>;
export type OfficesStrict = Delegate<Office>;
export type ConflictChecksStrict = Delegate<ConflictCheck>;
export type PaymentsStrict = Delegate<Payment>;
export type PaymentPlansStrict = Delegate<PaymentPlan>;
export type AccontoDeductionsStrict = Delegate<AccontoDeduction>;
export type CalendarEventsStrict = Delegate<CalendarEvent>;
export type TasksStrict = Delegate<Task>;

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
  writeOffs: WriteOffDelegate;
  invoiceDispatches: InvoiceDispatchDelegate;
  expectedReceivables: ExpectedReceivableDelegate;
  paymentPlans: PaymentPlanDelegate;
  accontoDeductions: AccontoDeductionDelegate;
  billingRuns: BillingRunDelegate;
  calendarEvents: CalendarEventDelegate;
  tasks: TaskDelegate;
  userPreferences: Delegate;
  orgPreferences: Delegate;
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
  readonly payments: PaymentDelegate;
  readonly writeOffs: WriteOffDelegate;
  readonly invoiceDispatches: InvoiceDispatchDelegate;
  readonly expectedReceivables: ExpectedReceivableDelegate;
  readonly paymentPlans: PaymentPlanDelegate;
  readonly paymentPlanReminders: Delegate;
  readonly accontoDeductions: AccontoDeductionDelegate;
  readonly billingRuns: BillingRunDelegate;
  readonly calendarEvents: CalendarEventDelegate;
  readonly tasks: TaskDelegate;
  readonly userPreferences: Delegate;
  readonly orgPreferences: Delegate;

  /**
   * Escape-hatch för komplexa frågor. Throwing-proxy i demo-store —
   * existerande callers (t.ex. fuzzy-name-search i conflict.ts) får
   * "ej implementerat"-fel om de anropas i ren git-modell. Refaktorera
   * dem ett-i-taget till in-memory-implementations. `unknown` (inte `any`):
   * callers måste narrowa/casta medvetet — ingen tyst spridning.
   */
  readonly raw: unknown;

  /**
   * Kör `fn` i en transaktion. In-memory snapshot/rollback — alla
   * write-back-event buffras tills `fn` returnerar; vid throw rullas
   * source-array:erna tillbaka och inga JSON-filer skrivs.
   */
  transaction<T>(fn: (tx: DataStoreTx) => Promise<T>): Promise<T>;
}
