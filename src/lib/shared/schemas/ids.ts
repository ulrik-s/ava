/**
 * Branded (nominal) id-typer — kompileringstids-skydd mot att blanda ihop
 * id:n mellan entiteter (t.ex. skicka en `ContactId` där en `MatterId` krävs).
 *
 * Designnoter:
 *   - `.brand()` är RENT typ-nivå. Runtime-validering är identisk med
 *     `z.string().min(1)`, så hydrate/parse/write-back-beteendet ändras INTE
 *     (ingen risk att rader tappas vid strikt parse).
 *   - En `XId` är en subtyp av `string` → assignable till `string`-parametrar
 *     (läsning fungerar överallt som förut).
 *   - En rå `string` är INTE assignable till `XId`. För att gå från sträng
 *     till branded id: parsa via schemat (`matterIdSchema.parse(s)`) eller
 *     använd `asId`-helpern vid en betrodd gräns (t.ex. URL-param).
 *   - Jämförelse mellan två OLIKA brands (`matterId === contactId`) är ett
 *     TS-fel — vilket är hela poängen.
 *
 * Single source of truth: schemana här återanvänds av entity-scheman
 * (`ENTITY_REGISTRY`), router-input och pathfunktioner.
 */

import { z } from "zod";

/** Bygg ett branded id-schema. Phantom-generic `B` sätter brand-namnet. */
const brandedId = <B extends string>() => z.string().min(1).brand<B>();

export const organizationIdSchema = brandedId<"OrganizationId">();
export type OrganizationId = z.infer<typeof organizationIdSchema>;

export const officeIdSchema = brandedId<"OfficeId">();
export type OfficeId = z.infer<typeof officeIdSchema>;

export const userIdSchema = brandedId<"UserId">();
export type UserId = z.infer<typeof userIdSchema>;

export const contactIdSchema = brandedId<"ContactId">();
export type ContactId = z.infer<typeof contactIdSchema>;

export const matterIdSchema = brandedId<"MatterId">();
export type MatterId = z.infer<typeof matterIdSchema>;

export const matterContactIdSchema = brandedId<"MatterContactId">();
export type MatterContactId = z.infer<typeof matterContactIdSchema>;

export const documentIdSchema = brandedId<"DocumentId">();
export type DocumentId = z.infer<typeof documentIdSchema>;

export const documentFolderIdSchema = brandedId<"DocumentFolderId">();
export type DocumentFolderId = z.infer<typeof documentFolderIdSchema>;

export const documentAnalysisSuggestionIdSchema = brandedId<"DocumentAnalysisSuggestionId">();
export type DocumentAnalysisSuggestionId = z.infer<typeof documentAnalysisSuggestionIdSchema>;

export const matterEventSuggestionIdSchema = brandedId<"MatterEventSuggestionId">();
export type MatterEventSuggestionId = z.infer<typeof matterEventSuggestionIdSchema>;

export const timeEntryIdSchema = brandedId<"TimeEntryId">();
export type TimeEntryId = z.infer<typeof timeEntryIdSchema>;

export const expenseIdSchema = brandedId<"ExpenseId">();
export type ExpenseId = z.infer<typeof expenseIdSchema>;

export const invoiceIdSchema = brandedId<"InvoiceId">();
export type InvoiceId = z.infer<typeof invoiceIdSchema>;

export const paymentIdSchema = brandedId<"PaymentId">();
export type PaymentId = z.infer<typeof paymentIdSchema>;

export const paymentPlanIdSchema = brandedId<"PaymentPlanId">();
export type PaymentPlanId = z.infer<typeof paymentPlanIdSchema>;

export const paymentPlanReminderIdSchema = brandedId<"PaymentPlanReminderId">();
export type PaymentPlanReminderId = z.infer<typeof paymentPlanReminderIdSchema>;

export const accontoDeductionIdSchema = brandedId<"AccontoDeductionId">();
export type AccontoDeductionId = z.infer<typeof accontoDeductionIdSchema>;

export const billingRunIdSchema = brandedId<"BillingRunId">();
export type BillingRunId = z.infer<typeof billingRunIdSchema>;

export const writeOffIdSchema = brandedId<"WriteOffId">();
export type WriteOffId = z.infer<typeof writeOffIdSchema>;

export const invoiceDispatchIdSchema = brandedId<"InvoiceDispatchId">();
export type InvoiceDispatchId = z.infer<typeof invoiceDispatchIdSchema>;

export const documentTemplateIdSchema = brandedId<"DocumentTemplateId">();
export type DocumentTemplateId = z.infer<typeof documentTemplateIdSchema>;

export const conflictCheckIdSchema = brandedId<"ConflictCheckId">();
export type ConflictCheckId = z.infer<typeof conflictCheckIdSchema>;

export const calendarEventIdSchema = brandedId<"CalendarEventId">();
export type CalendarEventId = z.infer<typeof calendarEventIdSchema>;

export const taskIdSchema = brandedId<"TaskId">();
export type TaskId = z.infer<typeof taskIdSchema>;

export const userPreferenceIdSchema = brandedId<"UserPreferenceId">();
export type UserPreferenceId = z.infer<typeof userPreferenceIdSchema>;

export const orgPreferenceIdSchema = brandedId<"OrgPreferenceId">();
export type OrgPreferenceId = z.infer<typeof orgPreferenceIdSchema>;

/**
 * Cast en betrodd sträng till ett branded id UTAN runtime-validering.
 * Använd bara vid gränser där strängen redan är ett känt id (URL-param,
 * session-context, redan-validerad input) — annars parsa via schemat.
 */
export const asId = <B extends string>(s: string): string & z.BRAND<B> => s as string & z.BRAND<B>;
