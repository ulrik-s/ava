/**
 * `DemoDataStore` — `IDataStore`-impl backad av in-memory data
 * (typiskt från `DemoRuntime` som klonat ett demo-repo från GitHub).
 *
 * Använder `ReadOnlyDelegate<T>` per entitet. Mutations kastar
 * `ReadOnlyError`. Routrarna (som binds mot `ctx.dataStore`) kan köras
 * oförändrade i browsern via tRPC `createCaller`.
 *
 * Designval (Single responsibility):
 *   - Aggregerar delegates. Inga query-detaljer. Ingen storage.
 *
 * Designval (Dependency inversion):
 *   - Tar in en `DemoSource` (en map entity → readonly array) snarare
 *     än att binda mot `DemoRuntime` direkt. Lättare att testa, och
 *     stödjer andra demo-källor (test-fixtures, IPC, etc).
 *
 * Designval (Open-closed):
 *   - Nya entiteter läggs till genom att utöka `DemoSource` och
 *     casta delegaten till rätt Prisma-typ. Inga andra ändringar.
 */

import { ReadOnlyDelegate, ReadOnlyError, type RelationConfig } from "./in-memory/read-only-delegate";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { WritableDelegate, type MutationEvent, type WritableDelegateOpts } from "./in-memory/writable-delegate";
import { buildRelations } from "./relations";
import type {
  IDataStore,
  IEventLog,
  DataStoreTx,
  Delegate,
  MatterDelegate,
  MatterContactDelegate,
  ContactDelegate,
  DocumentDelegate,
  DocumentFolderDelegate,
  DocumentTemplateDelegate,
  DocumentAnalysisSuggestionDelegate,
  MatterEventSuggestionDelegate,
  InvoiceDelegate,
  TimeEntryDelegate,
  ExpenseDelegate,
  UserDelegate,
  OrganizationDelegate,
  OfficeDelegate,
  ConflictCheckDelegate,
  PaymentDelegate,
  WriteOffDelegate,
  InvoiceDispatchDelegate,
  PaymentPlanDelegate,
  AccontoDeductionDelegate,
  BillingRunDelegate,
  CalendarEventDelegate,
  TaskDelegate,
} from "./IDataStore";
import type { AvaEvent, EmitInput, EventFilter } from "../events/schema";
// `DemoSource` bor numera i shared/ (delas av browser- + server-runtime).
// Re-exporteras nedan så alla befintliga importörer av
// `@/lib/server/data-store/DemoDataStore` fungerar oförändrat.
import type { DemoSource } from "@/lib/shared/demo-source";

export type { DemoSource } from "@/lib/shared/demo-source";

export class DemoDataStore implements IDataStore {
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
  readonly paymentPlans: PaymentPlanDelegate;
  readonly paymentPlanReminders: Delegate;
  readonly accontoDeductions: AccontoDeductionDelegate;
  readonly billingRuns: BillingRunDelegate;
  readonly calendarEvents: CalendarEventDelegate;
  readonly tasks: TaskDelegate;
  readonly userPreferences: Delegate;
  readonly orgPreferences: Delegate;
  readonly events: IEventLog;
  readonly raw: IDataStore["raw"];

  /**
   * Aktiv när en `transaction()` körs. Write-back-event buffras hit
   * istället för att flushas direkt, så en felad transaktion inte skriver
   * halva ändringar till git-db:n. `null` = ingen pågående transaktion.
   */
  private txBuffer: MutationEvent<Record<string, unknown>>[] | null = null;

  constructor(
    private source: DemoSource,
    /**
     * Optional write-back callback. När satt → delegates blir writable
     * (mutations uppdaterar source + triggar callback för persistens).
     * När `undefined` → delegates är read-only (mutations kastar).
     */
    private onMutate?: (event: MutationEvent<Record<string, unknown>>) => void | Promise<void>,
  ) {
    // Bygg delegates för varje entitet. `as unknown as XDelegate` är
    // ofrånkomligt — Prisma's typer är för komplexa att matcha exakt,
    // men strukturellt har vi rätt metoder.
    // Relations-grafen är extraherad till `relations.ts` (#189). `getSource`
    // läser den AKTUELLA source-referensen så mutable-lägets `mergeSource`-byten
    // syns även i collections.
    const relations = buildRelations(() => this.source);

    this.matters = this.makeDelegate("matters", relations.matters) as unknown as MatterDelegate;
    this.matterContacts = this.makeDelegate("matterContacts", relations.matterContacts) as unknown as MatterContactDelegate;
    this.contacts = this.makeDelegate("contacts", relations.contacts) as unknown as ContactDelegate;
    this.documents = this.makeDelegate("documents", relations.documents) as unknown as DocumentDelegate;
    this.documentFolders = this.makeDelegate("documentFolders") as unknown as DocumentFolderDelegate;
    this.documentTemplates = this.makeDelegate("documentTemplates", relations.documentTemplates) as unknown as DocumentTemplateDelegate;
    this.documentAnalysisSuggestions = this.makeDelegate("documentAnalysisSuggestions") as unknown as DocumentAnalysisSuggestionDelegate;
    this.matterEventSuggestions = this.makeDelegate("matterEventSuggestions") as unknown as MatterEventSuggestionDelegate;
    this.invoices = this.makeDelegate("invoices", relations.invoices) as unknown as InvoiceDelegate;
    this.timeEntries = this.makeDelegate("timeEntries", relations.timeEntries) as unknown as TimeEntryDelegate;
    this.expenses = this.makeDelegate("expenses", relations.expenses) as unknown as ExpenseDelegate;
    this.users = this.makeDelegate("users") as unknown as UserDelegate;
    this.organizations = this.makeDelegate("organizations") as unknown as OrganizationDelegate;
    this.offices = this.makeDelegate("offices") as unknown as OfficeDelegate;
    this.conflictChecks = this.makeDelegate("conflictChecks", relations.conflictChecks) as unknown as ConflictCheckDelegate;
    this.payments = this.makeDelegate("payments") as unknown as PaymentDelegate;
    this.writeOffs = this.makeDelegate("writeOffs") as unknown as WriteOffDelegate;
    this.invoiceDispatches = this.makeDelegate("invoiceDispatches", relations.invoiceDispatches) as unknown as InvoiceDispatchDelegate;
    this.paymentPlans = this.makeDelegate("paymentPlans", relations.paymentPlans) as unknown as PaymentPlanDelegate;
    this.paymentPlanReminders = this.makeDelegate("paymentPlanReminders") as unknown as Delegate;
    this.accontoDeductions = this.makeDelegate("accontoDeductions") as unknown as AccontoDeductionDelegate;
    this.billingRuns = this.makeDelegate("billingRuns", relations.billingRuns) as unknown as BillingRunDelegate;
    this.calendarEvents = this.makeDelegate("calendarEvents", relations.calendarEvents) as unknown as CalendarEventDelegate;
    this.tasks = this.makeDelegate("tasks", relations.tasks) as unknown as TaskDelegate;
    this.userPreferences = this.makeDelegate("userPreferences") as unknown as Delegate;
    this.orgPreferences = this.makeDelegate("orgPreferences") as unknown as Delegate;

    this.events = new ReadOnlyEventLog();
    this.raw = makeThrowingProxy() as unknown as IDataStore["raw"];
  }

  private makeDelegate<T extends Record<string, unknown>>(
    key: keyof DemoSource,
    relations?: Record<string, RelationConfig<T>>,
  ): ReadOnlyDelegate<T> {
    if (this.onMutate) {
      // Mutable mode — getter ser till att vi alltid pekar på senaste
      // source-arrayen även när mergeSource bytt ut referensen.
      const opts = omitUndefined({
        entity: this.entityNameFor(key),
        collection: () => {
          if (!this.source[key]) {
            (this.source as Record<string, unknown[]>)[key as string] = [];
          }
          return (this.source[key] ?? []) as unknown as T[];
        },
        relations,
        // Routa via handleMutate så att event buffras under en transaction()
        // och flushas först vid commit (annars skulle en felad transaktion
        // skriva halva ändringar till git-db:n).
        onMutate: (e: MutationEvent<T>) => this.handleMutate(e as MutationEvent<Record<string, unknown>>),
        enrichRow: (row: T) => this.enrichRowForEntity(key, row) as T,
      });
      return new WritableDelegate<T>(opts as WritableDelegateOpts<T>);
    }
    return new ReadOnlyDelegate<T>(
      () => (this.source[key] ?? []) as readonly T[],
      relations ? { relations } : {},
    );
  }

  /**
   * Pre-baka kända join-fält så att UI-koden får samma struktur
   * från create/update som från findUnique med include.
   */
  private enrichRowForEntity(
    key: keyof DemoSource,
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    const lookup = (k: keyof DemoSource, id: string | undefined) => {
      if (!id) return null;
      const arr = (this.source[k] ?? []) as Array<{ id?: string }>;
      return arr.find((r) => r.id === id) ?? null;
    };

    if (key === "matterContacts") {
      return {
        ...row,
        contact: lookup("contacts", row.contactId as string),
        matter: lookup("matters", row.matterId as string),
      };
    }
    if (key === "documents" || key === "timeEntries" || key === "expenses" || key === "invoices") {
      return { ...row, matter: lookup("matters", row.matterId as string) };
    }
    return row;
  }

  /** Map DemoSource-nyckel → projection-entitetsnamn för write-back. */
  private entityNameFor(key: keyof DemoSource): string {
    const map: Record<string, string> = {
      matters: "matter",
      contacts: "contact",
      matterContacts: "matterContact",
      documents: "document",
      documentFolders: "documentFolder",
      documentTemplates: "documentTemplate",
      documentAnalysisSuggestions: "documentAnalysisSuggestion",
      matterEventSuggestions: "matterEventSuggestion",
      timeEntries: "timeEntry",
      expenses: "expense",
      invoices: "invoice",
      users: "user",
      organizations: "organization",
      offices: "office",
      conflictChecks: "conflictCheck",
      payments: "payment",
      writeOffs: "writeOff",
      invoiceDispatches: "invoiceDispatch",
      paymentPlans: "paymentPlan",
      paymentPlanReminders: "paymentPlanReminder",
      accontoDeductions: "accontoDeduction",
      billingRuns: "billingRun",
      calendarEvents: "calendarEvent",
      tasks: "task",
      userPreferences: "userPreference",
      orgPreferences: "orgPreference",
    };
    return map[key as string] ?? String(key);
  }

  // ─── Transaktioner (in-memory snapshot/rollback) ──────────────────

  /**
   * Per-mutation-hook som delegates anropar. Under en transaction()
   * buffras event:en; annars flushas de direkt till `onMutate` (write-back).
   */
  private async handleMutate(event: MutationEvent<Record<string, unknown>>): Promise<void> {
    if (this.txBuffer) {
      this.txBuffer.push(event);
      return;
    }
    await this.onMutate?.(event);
  }

  /**
   * Kör `fn` mot en transaktionsvy. In-memory-mutationer sker direkt mot
   * source-arrayerna, men write-back buffras och flushas FÖRST vid success.
   * Kastar `fn` → rulla tillbaka source till snapshot och flusha inget.
   */
  async transaction<T>(fn: (tx: DataStoreTx) => Promise<T>): Promise<T> {
    // Read-only-läge (ingen onMutate) eller redan i en transaktion
    // (reentrant) → kör utan ny snapshot; yttre nivån sköter commit.
    if (!this.onMutate || this.txBuffer) {
      return fn(this.txView());
    }
    const snapshot = this.snapshotSource();
    const buffer: MutationEvent<Record<string, unknown>>[] = [];
    this.txBuffer = buffer;
    try {
      const result = await fn(this.txView());
      this.txBuffer = null;
      for (const event of buffer) await this.onMutate(event);
      return result;
    } catch (err) {
      this.txBuffer = null;
      this.restoreSource(snapshot);
      throw err;
    }
  }

  /** Transaktionsvy: samma delegates (plural-namn) som store:n. */
  private txView(): DataStoreTx {
    return {
      matters: this.matters,
      matterContacts: this.matterContacts,
      contacts: this.contacts,
      documents: this.documents,
      documentFolders: this.documentFolders,
      documentTemplates: this.documentTemplates,
      documentAnalysisSuggestions: this.documentAnalysisSuggestions,
      matterEventSuggestions: this.matterEventSuggestions,
      invoices: this.invoices,
      timeEntries: this.timeEntries,
      expenses: this.expenses,
      users: this.users,
      organizations: this.organizations,
      offices: this.offices,
      conflictChecks: this.conflictChecks,
      payments: this.payments,
      writeOffs: this.writeOffs,
      invoiceDispatches: this.invoiceDispatches,
      paymentPlans: this.paymentPlans,
      accontoDeductions: this.accontoDeductions,
      billingRuns: this.billingRuns,
      calendarEvents: this.calendarEvents,
      tasks: this.tasks,
      userPreferences: this.userPreferences,
      orgPreferences: this.orgPreferences,
    };
  }

  /** Kopiera varje source-array (shallow) så vi kan rulla tillbaka. */
  private snapshotSource(): Map<string, readonly Record<string, unknown>[] | undefined> {
    const snap = new Map<string, readonly Record<string, unknown>[] | undefined>();
    const src = this.source as Record<string, readonly Record<string, unknown>[] | undefined>;
    for (const key of Object.keys(src)) {
      const arr = src[key];
      snap.set(key, arr ? [...arr] : undefined);
    }
    return snap;
  }

  /** Återställ source till en snapshot (in place via referensbyte). */
  private restoreSource(snap: Map<string, readonly Record<string, unknown>[] | undefined>): void {
    const src = this.source as Record<string, readonly Record<string, unknown>[] | undefined>;
    for (const [key, arr] of snap) {
      src[key] = arr;
    }
    // Nycklar som skapades under transaktionen (lazy-init i collection())
    // och inte fanns i snapshot → nollställ till tom array.
    for (const key of Object.keys(src)) {
      if (!snap.has(key)) src[key] = [];
    }
  }
}

// ─── Read-only event-log ────────────────────────────────────────────

class ReadOnlyEventLog implements IEventLog {
  async emit(_input: EmitInput): Promise<AvaEvent> {
    throw new ReadOnlyError("events.emit");
  }
  async query(_filter: EventFilter): Promise<AvaEvent[]> {
    return [];
  }
  async *iterate(_filter: EventFilter): AsyncIterable<AvaEvent> {
    // Empty iterator
  }
  onNewEvent(_handler: (event: AvaEvent) => void | Promise<void>): () => void {
    return () => {};
  }
}

// ─── Throwing-proxy för `raw` ───────────────────────────────────────

function makeThrowingProxy(): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      return () => {
        throw new ReadOnlyError(`raw.${String(prop)}`);
      };
    },
  });
}
