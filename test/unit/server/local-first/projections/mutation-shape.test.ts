/**
 * Regression: projektionerna måste acceptera den KANONISKA form som
 * mutationerna (createFinal/timeEntry.create/expense.create/addContact)
 * faktiskt skriver — inte bara seedens berikade form. Tidigare krävde de
 * `organizationId` (+ invoice: invoiceNumber/amountExklVat/…) → strikt
 * `schema.parse` kastade → raderna droppades vid hydrering → tomma listor.
 */

import { describe, it, expect } from "vitest-compat";
import { InvoiceProjection } from "@/lib/server/local-first/projections/invoice";
import { TimeEntryProjection } from "@/lib/server/local-first/projections/time-entry";
import { ExpenseProjection } from "@/lib/server/local-first/projections/expense";
import { MatterContactProjection } from "@/lib/server/local-first/projections/matter-contact";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const de = (p: { deserialize: (s: string) => any }, row: unknown) => p.deserialize(JSON.stringify(row));

describe("projektioner accepterar mutations-form (utan organizationId)", () => {
  it("invoice: createFinal-form (amount/invoiceType/invoiceDate, ingen invoiceNumber/org)", () => {
    const row = { id: "inv-1", matterId: "m1", amount: 250000, invoiceType: "FINAL", status: "SENT", invoiceDate: "2026-02-01T00:00:00.000Z", dueDate: "2026-03-01T00:00:00.000Z", notes: null };
    const out = de(new InvoiceProjection(), row);
    expect(out.id).toBe("inv-1");
    expect(out.amount).toBe(250000); // kanoniskt belopp bevarat
    expect(out.invoiceType).toBe("FINAL");
    expect(new Date(out.invoiceDate).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("timeEntry: utan organizationId", () => {
    const row = { id: "te-1", matterId: "m1", userId: "u1", date: "2026-02-01T00:00:00.000Z", minutes: 60, description: "Möte", billable: true, hourlyRate: 250000, invoiceId: null };
    const out = de(new TimeEntryProjection(), row);
    expect(out.id).toBe("te-1");
    expect(out.minutes).toBe(60);
  });

  it("expense: utan organizationId", () => {
    const row = { id: "ex-1", matterId: "m1", userId: "u1", date: "2026-02-01T00:00:00.000Z", amount: 1000, description: "Tåg", billable: true, vatRate: 600, vatIncluded: true };
    const out = de(new ExpenseProjection(), row);
    expect(out.id).toBe("ex-1");
    expect(out.amount).toBe(1000);
  });

  it("matterContact: addContact-form (utan organizationId)", () => {
    const row = { id: "mc-1", matterId: "m1", contactId: "c1", role: "KLIENT", createdAt: "2026-02-01T00:00:00.000Z" };
    const out = de(new MatterContactProjection(), row);
    expect(out.id).toBe("mc-1");
    expect(out.role).toBe("KLIENT");
  });

  it("invoice: seedens berikade form (amountInklVat/invoiceNumber/org) funkar fortf.", () => {
    const row = { id: "inv-2", matterId: "m1", invoiceNumber: "2026-0001", type: "FINAL", status: "PAID", amountExclVat: 200000, vat: 50000, amountInclVat: 250000, issuedAt: "2026-01-01T00:00:00.000Z", organizationId: "demo-firma-ab" };
    const out = de(new InvoiceProjection(), row);
    expect(out.id).toBe("inv-2");
    expect(out.amountInclVat).toBe(250000);
    expect(out.organizationId).toBe("demo-firma-ab");
  });
});
