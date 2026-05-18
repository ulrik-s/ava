/**
 * `PostgresStore` — `IDataStore`-implementation för server-läget.
 *
 * Exponerar Prisma's delegates direkt (matters, contacts, ...) plus
 * event-loggen. Inga write-hooks utöver det; multi-tenant-isolering sker
 * fortfarande via `organizationId` i WHERE-klauserna som routrarna skickar.
 *
 * `raw` är en escape-hatch för $transaction och $queryRaw där det är
 * smidigare än att utöka delegate-listan.
 */

import type { PrismaClient } from "@prisma/client";
import type { IDataStore, IEventLog } from "./IDataStore";
import { PostgresEventLog } from "./PostgresEventLog";

export class PostgresStore implements IDataStore {
  public readonly events: IEventLog;
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

  constructor(prisma: PrismaClient, organizationId: string) {
    this.events = new PostgresEventLog(prisma, organizationId);
    this.raw = prisma;
    this.matters = prisma.matter;
    this.matterContacts = prisma.matterContact;
    this.contacts = prisma.contact;
    this.documents = prisma.document;
    this.documentFolders = prisma.documentFolder;
    this.documentTemplates = prisma.documentTemplate;
    this.documentAnalysisSuggestions = prisma.documentAnalysisSuggestion;
    this.matterEventSuggestions = prisma.matterEventSuggestion;
    this.invoices = prisma.invoice;
    this.timeEntries = prisma.timeEntry;
    this.expenses = prisma.expense;
    this.users = prisma.user;
    this.organizations = prisma.organization;
    this.offices = prisma.office;
    this.conflictChecks = prisma.conflictCheck;
  }

  /** Bygg en store för en specifik byrå-kontekt. Anropas per request. */
  static forOrganization(prisma: PrismaClient, organizationId: string): PostgresStore {
    return new PostgresStore(prisma, organizationId);
  }
}
