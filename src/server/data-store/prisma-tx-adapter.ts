/**
 * `prismaTxToDataStoreTx` — mappar en Prisma interaktiv-transaktions-klient
 * (singular delegate-namn: `tx.matter`, `tx.payment`, …) till `DataStoreTx`
 * (plural-namn: `tx.matters`, `tx.payments`, …).
 *
 * Delas av `PostgresStore` och `LocalGitStore` (DRY) — båda kör mot en
 * riktig Prisma-klient, så deras `transaction()` blir en tunn wrapper kring
 * `prisma.$transaction`.
 */

import type { Prisma } from "@prisma/client";
import type { DataStoreTx } from "./IDataStore";

export function prismaTxToDataStoreTx(tx: Prisma.TransactionClient): DataStoreTx {
  const p = tx;
  return {
    matters: p.matter,
    matterContacts: p.matterContact,
    contacts: p.contact,
    documents: p.document,
    documentFolders: p.documentFolder,
    documentTemplates: p.documentTemplate,
    documentAnalysisSuggestions: p.documentAnalysisSuggestion,
    matterEventSuggestions: p.matterEventSuggestion,
    invoices: p.invoice,
    timeEntries: p.timeEntry,
    expenses: p.expense,
    users: p.user,
    organizations: p.organization,
    offices: p.office,
    conflictChecks: p.conflictCheck,
    payments: p.payment,
    paymentPlans: p.paymentPlan,
    accontoDeductions: p.invoiceAccontoDeduction,
  };
}
