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
  CalendarEvent, Task, ServiceNote,
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

/**
 * Kända relations-/join-fält som `include` kan lägga på en rad.
 *
 * Uppräknade som optional `unknown` — INTE en `[k: string]: unknown`-index-
 * signatur — eftersom en string-index-signatur tvättar bort Row:s EGNA fälttyper
 * (särskilt branded id:n, [[ids]]) i intersektionen. Med en uppräkning behåller
 * `Joined<Matter>["id"]` sin `MatterId`-typ. De joinade fälten är `unknown` (vi
 * typar inte de exakta include-formerna här — det vore router-omskrivningen);
 * caller:n narrowar/castar till sin egen `WithRelations`-typ.
 */
export interface JoinedRelations {
  matter?: unknown; contact?: unknown; contacts?: unknown; matterLinks?: unknown;
  children?: unknown; parent?: unknown; documents?: unknown; document?: unknown;
  timeEntries?: unknown; expenses?: unknown; payments?: unknown; invoice?: unknown;
  folder?: unknown; paymentPlan?: unknown; billingRun?: unknown; reminders?: unknown;
  accontoInvoice?: unknown; finalInvoice?: unknown; creditNote?: unknown;
  uploadedBy?: unknown; recordedBy?: unknown; createdBy?: unknown; checkedBy?: unknown;
  author?: unknown; serviceNotes?: unknown;
  user?: unknown; emails?: unknown; _count?: unknown;
}

/**
 * Output-typ för en delegate-fråga: basraden (`Row`, från Zod-schemat) plus
 * de optionella relations-fälten. Se `JoinedRelations` för varför det inte är
 * en index-signatur (branded id:n skulle annars tvättas bort).
 */
export type Joined<Row> = Row & JoinedRelations;

// ─── Typad query-input (#562, ADR 0026) ──────────────────────────────────
// Ersätter den gamla `args: any`-ytan. Den enda kvarvarande lösheten är
// `Record<string, unknown>`-escape-hatchen för relations-filter (vars relaterade
// rad-typ delegaten inte känner generiskt) + include/select-former. INGEN
// explicit `any` kvar — `no-explicit-any` är `error` även här.

/** Operatorer query-engine:n stödjer på ett fält (Prisma-subset). */
export interface WhereOps {
  equals?: unknown; not?: unknown;
  in?: readonly unknown[]; notIn?: readonly unknown[];
  lt?: unknown; lte?: unknown; gt?: unknown; gte?: unknown;
  contains?: string; startsWith?: string; endsWith?: string;
  mode?: "insensitive" | "default";
  some?: WhereInput; none?: WhereInput; every?: WhereInput;
}

/**
 * Filter-shape. Fält-nycklarna hintas mot `Row` (autocomplete), men värdena är
 * `unknown` — ett fält kan vara ett direkt värde, ett `WhereOps`-objekt eller
 * ett nästlat relations-filter, och repos:en skickar ofta OBRANDADE id-strängar
 * (metod-params är `string`, inte `MatterId`). `Record<string, unknown>`-escapen
 * tillåter relations-nycklar (`{ matter: { organizationId } }`) utöver Row:s
 * egna. INGEN `any` — query-engine:n validerar formen i runtime.
 */
export type WhereInput<Row = Record<string, unknown>> =
  & { [K in keyof Row]?: unknown }
  & { OR?: readonly WhereInput<Row>[]; AND?: readonly WhereInput<Row>[]; NOT?: WhereInput<Row> }
  & Record<string, unknown>;

export type OrderDir = "asc" | "desc";
export type OrderByInput<Row = Record<string, unknown>> =
  | ({ [K in keyof Row]?: OrderDir } & Record<string, OrderDir>)
  | Array<{ [K in keyof Row]?: OrderDir } & Record<string, OrderDir>>;

export interface FindArgs<Row = Record<string, unknown>> {
  where?: WhereInput<Row>;
  orderBy?: OrderByInput<Row>;
  skip?: number;
  take?: number;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
  distinct?: string | readonly string[];
}

/** `aggregate`-subset (Prisma-stil): `_count`/`_sum`/`_avg`/`_min`/`_max`. */
export interface AggregateArgs {
  where?: WhereInput;
  _count?: true | Record<string, true>;
  _sum?: Record<string, true>;
  _avg?: Record<string, true>;
  _min?: Record<string, true>;
  _max?: Record<string, true>;
}

export interface Delegate<Row = Record<string, unknown>> {
  findUnique(args: FindArgs<Row>): Promise<Joined<Row> | null>;
  findUniqueOrThrow(args: FindArgs<Row>): Promise<Joined<Row>>;
  findFirst(args?: FindArgs<Row>): Promise<Joined<Row> | null>;
  findFirstOrThrow(args?: FindArgs<Row>): Promise<Joined<Row>>;
  findMany(args?: FindArgs<Row>): Promise<Joined<Row>[]>;
  // Skriv-args: `data`/`create`/`update` typas mot `Partial<Row>` så
  // write-literals (inkl. enum-fält) typkollas (#24).
  create(args: { data: Partial<Row>; include?: Record<string, unknown>; select?: Record<string, unknown> }): Promise<Joined<Row>>;
  update(args: { where: WhereInput<Row>; data: Partial<Row>; include?: Record<string, unknown>; select?: Record<string, unknown> }): Promise<Joined<Row>>;
  updateMany(args: { where?: WhereInput<Row>; data: Partial<Row> }): Promise<{ count: number }>;
  upsert(args: { where: WhereInput<Row>; create: Partial<Row>; update: Partial<Row> }): Promise<Joined<Row>>;
  delete(args: FindArgs<Row>): Promise<Joined<Row>>;
  deleteMany(args?: FindArgs<Row>): Promise<{ count: number }>;
  count(args?: FindArgs<Row>): Promise<number>;
  aggregate(args: AggregateArgs): Promise<Record<string, unknown>>;
}
// Per-entitet-delegate: binder `Row` (branded id:n flödar ut via `Joined<Row>`).
// In-memory-impl:en (`ReadOnlyDelegate<T> implements Delegate<T>`) satisfierar
// dessa, så `LocalStore` wirar dem TYPADE utan casts (#typing). Den enda kvar-
// varande lösheten är query-INPUT (`args`/`where`) inne i `Delegate` ovan — den
// otypade Prisma-formade ytan (dokumenterad any). Tighta den kräver en
// `WhereInput<Row>`-modell + 300+ router-anrops-rewrites (eget projekt).
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
export type ServiceNoteDelegate = Delegate<ServiceNote>;

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
  paymentPlanReminders: Delegate;
  accontoDeductions: AccontoDeductionDelegate;
  billingRuns: BillingRunDelegate;
  calendarEvents: CalendarEventDelegate;
  tasks: TaskDelegate;
  serviceNotes: ServiceNoteDelegate;
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
  readonly serviceNotes: ServiceNoteDelegate;
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
