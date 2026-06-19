/**
 * `LocalStore` — generisk in-memory `IDataStore` över en `DemoSource`
 * (map entity → array), med per-entitet-delegates, snapshot/rollback-
 * transaktioner och en valfri `onMutate`-hook för write-back/persistens.
 *
 * Detta är KÄRNAN som både demon och den framtida offline-cachen bygger på
 * (ADR 0016/#412): `DemoDataStore` är en tunn subklass, och en persisterad
 * variant skapas via `createPersistedLocalStore` (IndexedDB-hydrering + save).
 *
 * Designval (Single responsibility): aggregerar delegates + transaktioner.
 * Ingen kunskap om VAR datat kommer ifrån (DemoSource injiceras) eller VART
 * det persisteras (onMutate injiceras).
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type {
  AccontoDeduction, BillingRun, CalendarEvent, ConflictCheck, Contact, Document, DocumentAnalysisSuggestion, DocumentFolder, DocumentTemplate, ExpectedReceivable, Expense, Invoice, InvoiceDispatch, Matter, MatterContact, MatterEventSuggestion, Office, Organization, Payment, PaymentPlan, ServiceNote, Task, TimeEntry, User, WriteOff,
} from "@/lib/shared/schemas";
import type { AvaEvent, EmitInput, EventFilter } from "../../events/schema";
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
  ExpectedReceivableDelegate,
  PaymentPlanDelegate,
  AccontoDeductionDelegate,
  BillingRunDelegate,
  CalendarEventDelegate,
  TaskDelegate,
  ServiceNoteDelegate,
} from "../IDataStore";
import { buildRelations } from "../relations";
import { ENTITY_NAME_BY_SOURCE_KEY } from "./entity-source-keys";
import { ReadOnlyDelegate, ReadOnlyError, type RelationConfig } from "./read-only-delegate";
import { WritableDelegate, type MutationEvent, type WritableDelegateOpts } from "./writable-delegate";

export class LocalStore implements IDataStore {
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
  readonly events: IEventLog;
  readonly raw: IDataStore["raw"];

  /**
   * Aktiv när en `transaction()` körs. Write-back-event buffras hit
   * istället för att flushas direkt, så en felad transaktion inte skriver
   * halva ändringar till persistensen. `null` = ingen pågående transaktion.
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
    // Relations-grafen är extraherad till `relations.ts` (#189). `getSource`
    // läser den AKTUELLA source-referensen så collections ser senaste arrayen.
    const relations = buildRelations(() => this.source);

    this.matters = this.makeDelegate<Matter>("matters", relations.matters);
    this.matterContacts = this.makeDelegate<MatterContact>("matterContacts", relations.matterContacts);
    this.contacts = this.makeDelegate<Contact>("contacts", relations.contacts);
    this.documents = this.makeDelegate<Document>("documents", relations.documents);
    this.documentFolders = this.makeDelegate<DocumentFolder>("documentFolders", relations.documentFolders);
    this.documentTemplates = this.makeDelegate<DocumentTemplate>("documentTemplates", relations.documentTemplates);
    this.documentAnalysisSuggestions = this.makeDelegate<DocumentAnalysisSuggestion>("documentAnalysisSuggestions", relations.documentAnalysisSuggestions);
    this.matterEventSuggestions = this.makeDelegate<MatterEventSuggestion>("matterEventSuggestions", relations.matterEventSuggestions);
    this.invoices = this.makeDelegate<Invoice>("invoices", relations.invoices);
    this.timeEntries = this.makeDelegate<TimeEntry>("timeEntries", relations.timeEntries);
    this.expenses = this.makeDelegate<Expense>("expenses", relations.expenses);
    this.users = this.makeDelegate<User>("users");
    this.organizations = this.makeDelegate<Organization>("organizations");
    this.offices = this.makeDelegate<Office>("offices");
    this.conflictChecks = this.makeDelegate<ConflictCheck>("conflictChecks", relations.conflictChecks);
    this.payments = this.makeDelegate<Payment>("payments");
    this.writeOffs = this.makeDelegate<WriteOff>("writeOffs");
    this.invoiceDispatches = this.makeDelegate<InvoiceDispatch>("invoiceDispatches", relations.invoiceDispatches);
    this.expectedReceivables = this.makeDelegate<ExpectedReceivable>("expectedReceivables");
    this.paymentPlans = this.makeDelegate<PaymentPlan>("paymentPlans", relations.paymentPlans);
    this.paymentPlanReminders = this.makeDelegate("paymentPlanReminders");
    this.accontoDeductions = this.makeDelegate<AccontoDeduction>("accontoDeductions");
    this.billingRuns = this.makeDelegate<BillingRun>("billingRuns", relations.billingRuns);
    this.calendarEvents = this.makeDelegate<CalendarEvent>("calendarEvents", relations.calendarEvents);
    this.tasks = this.makeDelegate<Task>("tasks", relations.tasks);
    this.serviceNotes = this.makeDelegate<ServiceNote>("serviceNotes", relations.serviceNotes);
    this.userPreferences = this.makeDelegate("userPreferences");
    this.orgPreferences = this.makeDelegate("orgPreferences");

    this.events = new ReadOnlyEventLog();
    this.raw = makeThrowingProxy() as unknown as IDataStore["raw"];
  }

  /** Den aktuella in-memory-källan (för persistens/snapshot). Läs, mutera ej. */
  get currentSource(): DemoSource {
    return this.source;
  }

  private makeDelegate<T extends Record<string, unknown>>(
    key: keyof DemoSource,
    relations?: Record<string, RelationConfig<T>>,
  ): ReadOnlyDelegate<T> {
    if (this.onMutate) {
      // Mutable mode — getter ser till att vi alltid pekar på senaste source-arrayen.
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
        // skriva halva ändringar till persistensen).
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

  /** Map DemoSource-nyckel → projection-entitetsnamn för write-back.
   *  Mappningen bor i `entity-source-keys.ts` (DRY — delas med reconcile-apply). */
  private entityNameFor(key: keyof DemoSource): string {
    return ENTITY_NAME_BY_SOURCE_KEY[key as string] ?? String(key);
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
      expectedReceivables: this.expectedReceivables,
      paymentPlans: this.paymentPlans,
      paymentPlanReminders: this.paymentPlanReminders,
      accontoDeductions: this.accontoDeductions,
      billingRuns: this.billingRuns,
      calendarEvents: this.calendarEvents,
      tasks: this.tasks,
      serviceNotes: this.serviceNotes,
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
