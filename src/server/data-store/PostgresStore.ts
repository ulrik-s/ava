/**
 * `PostgresStore` — `IDataStore`-implementation för server-läget.
 *
 * Initialt en tunn wrapper som BARA exponerar `events` (Fas 1 jobb).
 * Repos för domän-CRUD (matters, contacts, ...) läggs till i Fas 2 när
 * routrarna migreras dit en i taget.
 *
 * `claims` är medvetet inte satt — i server-läget kör en singel
 * rule-executor och det finns inget att claima mot.
 */

import type { PrismaClient } from "@prisma/client";
import type { IDataStore, IEventLog } from "./IDataStore";
import { PostgresEventLog } from "./PostgresEventLog";

export class PostgresStore implements IDataStore {
  public readonly events: IEventLog;

  constructor(prisma: PrismaClient, organizationId: string) {
    this.events = new PostgresEventLog(prisma, organizationId);
  }

  /** Bygg en store för en specifik byrå-kontekt. Anropas per request. */
  static forOrganization(prisma: PrismaClient, organizationId: string): PostgresStore {
    return new PostgresStore(prisma, organizationId);
  }
}
