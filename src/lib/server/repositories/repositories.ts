/**
 * `Repositories` (ADR 0020) — aggregatet som ersätter `IDataStore` i `ctx`.
 * Växer per migrerad entitet (fan-out); samexisterar med `IDataStore` tills
 * sista entiteten migrerats. Egen fil (inte `types.ts`) så bas-kontrakten kan
 * importeras av entitets-repositories utan cirkel-beroende.
 */

import type { AccontoDeductionRepository } from "./acconto-deduction-repository";
import type { CalendarEventRepository } from "./calendar-event-repository";
import type { ContactRepository } from "./contact-repository";
import type { DocumentTemplateRepository } from "./document-template-repository";
import type { ExpenseRepository } from "./expense-repository";
import type { InvoiceRepository } from "./invoice-repository";
import type { MatterRepository } from "./matter-repository";
import type { PaymentPlanRepository } from "./payment-plan-repository";
import type { PaymentRepository } from "./payment-repository";
import type { ServiceNoteRepository } from "./service-note-repository";
import type { TaskRepository } from "./task-repository";
import type { TimeEntryRepository } from "./time-entry-repository";
import type { UserRepository } from "./user-repository";
import type { WriteOffRepository } from "./write-off-repository";

export interface Repositories {
  invoices: InvoiceRepository;
  matters: MatterRepository;
  payments: PaymentRepository;
  writeOffs: WriteOffRepository;
  paymentPlans: PaymentPlanRepository;
  timeEntries: TimeEntryRepository;
  expenses: ExpenseRepository;
  accontoDeductions: AccontoDeductionRepository;
  contacts: ContactRepository;
  users: UserRepository;
  tasks: TaskRepository;
  calendarEvents: CalendarEventRepository;
  serviceNotes: ServiceNoteRepository;
  documentTemplates: DocumentTemplateRepository;
  transaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T>;
}
