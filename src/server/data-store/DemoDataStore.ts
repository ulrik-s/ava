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
import { WritableDelegate, type MutationEvent } from "./in-memory/writable-delegate";
import type {
  IDataStore,
  IEventLog,
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
} from "./IDataStore";
import type { AvaEvent, EmitInput, EventFilter } from "../events/schema";

/** Demo-data per entitet. Saknade entiteter får tom array. */
export interface DemoSource {
  matters?: readonly Record<string, unknown>[];
  matterContacts?: readonly Record<string, unknown>[];
  contacts?: readonly Record<string, unknown>[];
  documents?: readonly Record<string, unknown>[];
  documentFolders?: readonly Record<string, unknown>[];
  documentTemplates?: readonly Record<string, unknown>[];
  documentAnalysisSuggestions?: readonly Record<string, unknown>[];
  matterEventSuggestions?: readonly Record<string, unknown>[];
  invoices?: readonly Record<string, unknown>[];
  timeEntries?: readonly Record<string, unknown>[];
  expenses?: readonly Record<string, unknown>[];
  users?: readonly Record<string, unknown>[];
  organizations?: readonly Record<string, unknown>[];
  offices?: readonly Record<string, unknown>[];
  conflictChecks?: readonly Record<string, unknown>[];
}

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
  readonly events: IEventLog;
  readonly raw: IDataStore["raw"];

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
    this.matters = this.makeDelegate("matters", {
      contacts: {
        collection: () => this.source.matterContacts ?? [],
        where: (parent) => ({ matterId: (parent as { id: string }).id }),
      },
      documents: {
        collection: () => this.source.documents ?? [],
        where: (parent) => ({ matterId: (parent as { id: string }).id }),
      },
      timeEntries: {
        collection: () => this.source.timeEntries ?? [],
        where: (parent) => ({ matterId: (parent as { id: string }).id }),
      },
      expenses: {
        collection: () => this.source.expenses ?? [],
        where: (parent) => ({ matterId: (parent as { id: string }).id }),
      },
      invoices: {
        collection: () => this.source.invoices ?? [],
        where: (parent) => ({ matterId: (parent as { id: string }).id }),
      },
    }) as unknown as MatterDelegate;

    this.matterContacts = this.makeDelegate("matterContacts", {
      contact: {
        collection: () => this.source.contacts ?? [],
        where: (parent) => ({ id: (parent as { contactId: string }).contactId }),
      },
      matter: {
        collection: () => this.source.matters ?? [],
        where: (parent) => ({ id: (parent as { matterId: string }).matterId }),
      },
    }) as unknown as MatterContactDelegate;

    this.contacts = this.makeDelegate("contacts", {
      matterLinks: {
        collection: () => this.source.matterContacts ?? [],
        where: (parent) => ({ contactId: (parent as { id: string }).id }),
      },
    }) as unknown as ContactDelegate;
    this.documents = this.makeDelegate("documents", {
      matter: {
        collection: () => this.source.matters ?? [],
        where: (parent) => ({ id: (parent as { matterId: string }).matterId }),
      },
    }) as unknown as DocumentDelegate;
    this.documentFolders = this.makeDelegate("documentFolders") as unknown as DocumentFolderDelegate;
    this.documentTemplates = this.makeDelegate("documentTemplates") as unknown as DocumentTemplateDelegate;
    this.documentAnalysisSuggestions = this.makeDelegate("documentAnalysisSuggestions") as unknown as DocumentAnalysisSuggestionDelegate;
    this.matterEventSuggestions = this.makeDelegate("matterEventSuggestions") as unknown as MatterEventSuggestionDelegate;
    this.invoices = this.makeDelegate("invoices") as unknown as InvoiceDelegate;
    this.timeEntries = this.makeDelegate("timeEntries") as unknown as TimeEntryDelegate;
    this.expenses = this.makeDelegate("expenses") as unknown as ExpenseDelegate;
    this.users = this.makeDelegate("users") as unknown as UserDelegate;
    this.organizations = this.makeDelegate("organizations") as unknown as OrganizationDelegate;
    this.offices = this.makeDelegate("offices") as unknown as OfficeDelegate;
    this.conflictChecks = this.makeDelegate("conflictChecks") as unknown as ConflictCheckDelegate;

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
      return new WritableDelegate<T>({
        entity: this.entityNameFor(key),
        collection: () => {
          if (!this.source[key]) {
            (this.source as Record<string, unknown[]>)[key as string] = [];
          }
          return (this.source[key] ?? []) as unknown as T[];
        },
        relations,
        onMutate: this.onMutate as (e: MutationEvent<T>) => Promise<void> | void,
        enrichRow: (row) => this.enrichRowForEntity(key, row) as T,
      });
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
      timeEntries: "timeEntry",
      expenses: "expense",
      invoices: "invoice",
      users: "user",
    };
    return map[key as string] ?? String(key);
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
