/**
 * `LocalGitStore` — `IDataStore`-implementation för local-first-läget.
 *
 * Komposition (Single Responsibility, Liskov):
 *   - `FilesystemEventLog` hanterar events (JSONL i git working tree)
 *   - `FilesystemClaimStore` hanterar claims (samma format, JSONL)
 *   - `prisma` (mot SQLite i runtime, mot mock i tester) driver
 *     domän-CRUD via samma delegate-API som `PostgresStore`
 *
 * Designval (Liskov-substituerbarhet):
 *   - Routrarna ska kunna anropa identiska metoder på `ctx.dataStore`
 *     oavsett deployment-läge. Det här är hela poängen med Fas 2:s
 *     abstraktion — och nu betalas den investeringen tillbaka.
 *
 * Designval (Dependency inversion):
 *   - LocalGitStore kräver `IFileSystem` och `IGitOps` via constructor.
 *     Tester passar in `InMemoryFileSystem` + `InMemoryGitOps`;
 *     produktions-Tauri-runtime passar in `TauriFileSystem` +
 *     `IsomorphicGitOps`. Klassen är agnostisk.
 *
 * Vad som INTE finns här ännu (kommer i nästa iterations):
 *   - SQLite-projektion (skriv-genom-cache från JSON → Prisma)
 *   - Hydrate-on-pull (re-hydratisera SQLite från ändrade JSON-filer)
 *   - 15s-polling loop (poll, fetch, hydrate)
 *   - Yjs-CRDT-fält på matter.notes etc.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  IDataStore,
  IEventLog,
  IClaimStore,
} from "../data-store/IDataStore";
import type { IFileSystem } from "./file-system";
import type { IGitOps } from "./git-ops";
import { FilesystemEventLog } from "./filesystem-event-log";
import { FilesystemClaimStore } from "./filesystem-claim-store";

export interface LocalGitStoreDeps {
  fs: IFileSystem;
  git: IGitOps;
  /** User-id för commit-author + claim-owner. */
  me: string;
  /** Prisma-klient (mot SQLite i runtime). */
  prisma: PrismaClient;
}

export class LocalGitStore implements IDataStore {
  public readonly events: IEventLog;
  public readonly claims: IClaimStore;
  public readonly raw: PrismaClient;

  public readonly matters: PrismaClient["matter"];
  public readonly matterContacts: PrismaClient["matterContact"];
  public readonly contacts: PrismaClient["contact"];
  public readonly documents: PrismaClient["document"];
  public readonly documentFolders: PrismaClient["documentFolder"];
  public readonly documentTemplates: PrismaClient["documentTemplate"];
  public readonly documentAnalysisSuggestions: PrismaClient["documentAnalysisSuggestion"];
  public readonly matterEventSuggestions: PrismaClient["matterEventSuggestion"];
  public readonly invoices: PrismaClient["invoice"];
  public readonly timeEntries: PrismaClient["timeEntry"];
  public readonly expenses: PrismaClient["expense"];
  public readonly users: PrismaClient["user"];
  public readonly organizations: PrismaClient["organization"];
  public readonly offices: PrismaClient["office"];
  public readonly conflictChecks: PrismaClient["conflictCheck"];

  constructor(deps: LocalGitStoreDeps) {
    this.events = new FilesystemEventLog(deps.fs);
    this.claims = new FilesystemClaimStore(deps.fs, deps.git, deps.me);
    this.raw = deps.prisma;
    this.matters = deps.prisma.matter;
    this.matterContacts = deps.prisma.matterContact;
    this.contacts = deps.prisma.contact;
    this.documents = deps.prisma.document;
    this.documentFolders = deps.prisma.documentFolder;
    this.documentTemplates = deps.prisma.documentTemplate;
    this.documentAnalysisSuggestions = deps.prisma.documentAnalysisSuggestion;
    this.matterEventSuggestions = deps.prisma.matterEventSuggestion;
    this.invoices = deps.prisma.invoice;
    this.timeEntries = deps.prisma.timeEntry;
    this.expenses = deps.prisma.expense;
    this.users = deps.prisma.user;
    this.organizations = deps.prisma.organization;
    this.offices = deps.prisma.office;
    this.conflictChecks = deps.prisma.conflictCheck;
  }
}
