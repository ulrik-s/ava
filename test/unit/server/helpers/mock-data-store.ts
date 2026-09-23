/**
 * Hjälpfunktion för router-tester: bygg en mockad `IDataStore` från en
 * redan mockad Prisma-klient. Spegelar tabellnamnen i `IDataStore`-interfacet
 * så att routern hittar samma mock-delegate-objekt under `ctx.dataStore.matters`
 * som testet konfigurerade under `mockPrisma.matter`.
 *
 * Bonus: vi sätter `events.emit` till en no-op vi-spy så testerna kan
 * assertera på event-emit utan att behöva DB.
 */

import { vi } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";

export interface MockDataStore extends Omit<IDataStore, "events"> {
  events: { emit: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; iterate: ReturnType<typeof vi.fn>; onNewEvent: ReturnType<typeof vi.fn> };
}

/**
 * Återanvändbar mall — pekare i `mockPrisma` mappas mot fält i `dataStore`.
 *
 * Parametern är avsiktligt `object` och inte `Record<string, unknown>`: ett
 * typat objektlitteral matchar inte en indexsignatur, så varenda anropsplats
 * tvingades skriva `mockPrisma as unknown as Record<string, unknown>` (16
 * filer). Funktionen slår bara upp fält på objektet, så den bredare typen
 * kostar ingenting och tar bort casten på alla ställen samtidigt.
 */
/** Ett mockat delegate. Testet konfigurerar bara de metoder routern rör; en
 *  enkel assertion räcker för att ge fältet sin riktiga delegate-typ. */
function delegate<T>(mock: unknown): T {
  return mock as T;
}

export function dataStoreFromMockPrisma(mock: object): MockDataStore {
  const mockPrisma = mock as Record<string, unknown>;
  return {
    events: {
      emit: vi.fn(async (input: unknown) => ({ id: "evt-mock", ts: new Date().toISOString(), ...(input as object) })),
      query: vi.fn().mockResolvedValue([]),
      iterate: vi.fn(),
      onNewEvent: vi.fn(() => () => {}),
    },
    raw: mockPrisma,
    // Speglar Prisma's interaktiva transaktion: kör callbacken mot en
    // tx-vy som mappar plural-namn → mockPrisma:s singular-delegates.
    // Tester som vill testa $transaction-flöden konfigurerar mockPrisma
    // som vanligt; rollback simuleras inte (samma som tidigare mock).
    transaction: (fn) => fn({
      matters: delegate(mockPrisma.matter),
      matterContacts: delegate(mockPrisma.matterContact),
      contacts: delegate(mockPrisma.contact),
      documents: delegate(mockPrisma.document),
      documentFolders: delegate(mockPrisma.documentFolder),
      documentTemplates: delegate(mockPrisma.documentTemplate),
      documentAnalysisSuggestions: delegate(mockPrisma.documentAnalysisSuggestion),
      matterEventSuggestions: delegate(mockPrisma.matterEventSuggestion),
      invoices: delegate(mockPrisma.invoice),
      invoiceDispatches: delegate(mockPrisma.invoiceDispatch),
      timeEntries: delegate(mockPrisma.timeEntry),
      expenses: delegate(mockPrisma.expense),
      users: delegate(mockPrisma.user),
      organizations: delegate(mockPrisma.organization),
      offices: delegate(mockPrisma.office),
      conflictChecks: delegate(mockPrisma.conflictCheck),
      payments: delegate(mockPrisma.payment),
      writeOffs: delegate(mockPrisma.writeOff),
      expectedReceivables: delegate(mockPrisma.expectedReceivable),
      paymentPlans: delegate(mockPrisma.paymentPlan),
      paymentPlanReminders: delegate(mockPrisma.paymentPlanReminder),
      accontoDeductions: delegate(mockPrisma.invoiceAccontoDeduction),
      billingRuns: delegate(mockPrisma.billingRun),
      calendarEvents: delegate(mockPrisma.calendarEvent),
      tasks: delegate(mockPrisma.task),
      serviceNotes: delegate(mockPrisma.serviceNote),
      userPreferences: delegate(mockPrisma.userPreference),
      orgPreferences: delegate(mockPrisma.orgPreference),
    }),
    matters: delegate(mockPrisma.matter),
    matterContacts: delegate(mockPrisma.matterContact),
    contacts: delegate(mockPrisma.contact),
    documents: delegate(mockPrisma.document),
    documentFolders: delegate(mockPrisma.documentFolder),
    documentTemplates: delegate(mockPrisma.documentTemplate),
    documentAnalysisSuggestions: delegate(mockPrisma.documentAnalysisSuggestion),
    matterEventSuggestions: delegate(mockPrisma.matterEventSuggestion),
    invoices: delegate(mockPrisma.invoice),
    invoiceDispatches: delegate(mockPrisma.invoiceDispatch),
    timeEntries: delegate(mockPrisma.timeEntry),
    expenses: delegate(mockPrisma.expense),
    users: delegate(mockPrisma.user),
    organizations: delegate(mockPrisma.organization),
    offices: delegate(mockPrisma.office),
    conflictChecks: delegate(mockPrisma.conflictCheck),
    payments: delegate(mockPrisma.payment),
    writeOffs: delegate(mockPrisma.writeOff),
    expectedReceivables: delegate(mockPrisma.expectedReceivable),
    paymentPlans: delegate(mockPrisma.paymentPlan),
    paymentPlanReminders: delegate(mockPrisma.paymentPlanReminder),
    accontoDeductions: delegate(mockPrisma.invoiceAccontoDeduction),
    billingRuns: delegate(mockPrisma.billingRun),
    calendarEvents: delegate(mockPrisma.calendarEvent),
    tasks: delegate(mockPrisma.task),
    serviceNotes: delegate(mockPrisma.serviceNote),
    userPreferences: delegate(mockPrisma.userPreference),
    orgPreferences: delegate(mockPrisma.orgPreference),
  };
}

/**
 * Repositories ovanpå en mockad datastore (#1102).
 *
 * `MockDataStore` är inte strukturellt en `IDataStore` — den bär bara de
 * delegates router-testerna faktiskt rör. Casten är alltså ÄKTA, inte ett sätt
 * att tysta kompilatorn: attrappen är medvetet partiell, och att fylla ut hela
 * gränssnittet med no-ops hade dolt vilka delar ett test verkligen använder.
 *
 * Poängen är att den bor på ETT ställe i stället för i 24 testfiler. Växer
 * `IDataStore` är det här den ska ses över — inte på 24 anropsplatser som var
 * och en gömmer samma antagande bakom sin egen cast.
 */
export function reposFromMockDataStore(dataStore: MockDataStore): Repositories {
  return buildInMemoryRepositories(dataStore);
}

/** Genväg: mockPrisma → { dataStore, repos } i ett anrop. */
export function mockStoreAndRepos(mock: object): { dataStore: MockDataStore; repos: Repositories } {
  const dataStore = dataStoreFromMockPrisma(mock);
  return { dataStore, repos: reposFromMockDataStore(dataStore) };
}
