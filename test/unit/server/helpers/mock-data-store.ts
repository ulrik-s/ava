/**
 * Hjälpfunktion för router-tester: bygg en mockad `IDataStore` från en
 * redan mockad Prisma-klient. Spegelar tabellnamnen i `IDataStore`-interfacet
 * så att routern hittar samma mock-delegate-objekt under `ctx.dataStore.matters`
 * som testet konfigurerade under `mockPrisma.matter`.
 *
 * Bonus: vi sätter `events.emit` till en no-op vi-spy så testerna kan
 * assertera på event-emit utan att behöva DB.
 */

import { vi } from "vitest";

export interface MockDataStore {
  events: { emit: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; iterate: ReturnType<typeof vi.fn>; onNewEvent: ReturnType<typeof vi.fn> };
  raw: unknown;
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  matters: unknown;
  matterContacts: unknown;
  contacts: unknown;
  documents: unknown;
  documentFolders: unknown;
  documentTemplates: unknown;
  documentAnalysisSuggestions: unknown;
  matterEventSuggestions: unknown;
  invoices: unknown;
  timeEntries: unknown;
  expenses: unknown;
  users: unknown;
  organizations: unknown;
  offices: unknown;
  conflictChecks: unknown;
  payments: unknown;
  paymentPlans: unknown;
  paymentPlanReminders: unknown;
  accontoDeductions: unknown;
  calendarEvents: unknown;
  tasks: unknown;
  userPreferences: unknown;
  orgPreferences: unknown;
}

// Återanvändbar mall — pekare i `mockPrisma` mappas mot fält i `dataStore`.
export function dataStoreFromMockPrisma(mockPrisma: Record<string, unknown>): MockDataStore {
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
      matters: mockPrisma.matter,
      matterContacts: mockPrisma.matterContact,
      contacts: mockPrisma.contact,
      documents: mockPrisma.document,
      documentFolders: mockPrisma.documentFolder,
      documentTemplates: mockPrisma.documentTemplate,
      documentAnalysisSuggestions: mockPrisma.documentAnalysisSuggestion,
      matterEventSuggestions: mockPrisma.matterEventSuggestion,
      invoices: mockPrisma.invoice,
      timeEntries: mockPrisma.timeEntry,
      expenses: mockPrisma.expense,
      users: mockPrisma.user,
      organizations: mockPrisma.organization,
      offices: mockPrisma.office,
      conflictChecks: mockPrisma.conflictCheck,
      payments: mockPrisma.payment,
      paymentPlans: mockPrisma.paymentPlan,
      paymentPlanReminders: mockPrisma.paymentPlanReminder,
      accontoDeductions: mockPrisma.invoiceAccontoDeduction,
      calendarEvents: mockPrisma.calendarEvent,
      tasks: mockPrisma.task,
      userPreferences: mockPrisma.userPreference,
      orgPreferences: mockPrisma.orgPreference,
    }),
    matters: mockPrisma.matter,
    matterContacts: mockPrisma.matterContact,
    contacts: mockPrisma.contact,
    documents: mockPrisma.document,
    documentFolders: mockPrisma.documentFolder,
    documentTemplates: mockPrisma.documentTemplate,
    documentAnalysisSuggestions: mockPrisma.documentAnalysisSuggestion,
    matterEventSuggestions: mockPrisma.matterEventSuggestion,
    invoices: mockPrisma.invoice,
    timeEntries: mockPrisma.timeEntry,
    expenses: mockPrisma.expense,
    users: mockPrisma.user,
    organizations: mockPrisma.organization,
    offices: mockPrisma.office,
    conflictChecks: mockPrisma.conflictCheck,
    payments: mockPrisma.payment,
    paymentPlans: mockPrisma.paymentPlan,
    paymentPlanReminders: mockPrisma.paymentPlanReminder,
    accontoDeductions: mockPrisma.invoiceAccontoDeduction,
    calendarEvents: mockPrisma.calendarEvent,
    tasks: mockPrisma.task,
    userPreferences: mockPrisma.userPreference,
    orgPreferences: mockPrisma.orgPreference,
  };
}
