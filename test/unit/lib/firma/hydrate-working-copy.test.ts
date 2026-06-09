/**
 * `hydrateWorkingCopy` läser JSON-filerna i en (klonad) working copy och
 * bygger en `DemoSource` — motsvarigheten till `demoSourceFromRuntime` men
 * från en lokal FSA/OPFS-mappad git-clone istället för GH-Pages.
 *
 * Testet skriver via SAMMA write-back-pipeline som appen använder och
 * verifierar att hydreringen är dess invers (round-trip).
 */

import { describe, it, expect } from "vitest-compat";
import { makeFakeFsa } from "../../../helpers/fake-fsa";
import { makeFsaWriteBack } from "@/lib/client/firma/fsa-write-back";
import { hydrateWorkingCopy } from "@/lib/client/firma/hydrate-working-copy";

describe("hydrateWorkingCopy", () => {
  it("round-trip: write-back → hydrate ger tillbaka entiteterna", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });

    await writeBack({ entity: "matter", kind: "create", row: { id: "m1", organizationId: "o1", title: "Avtal", matterNumber: "2026-0001" } });
    await writeBack({ entity: "contact", kind: "create", row: { id: "c1", organizationId: "o1", name: "Anna" } });
    await writeBack({ entity: "matterContact", kind: "create", row: { id: "mc1", matterId: "m1", contactId: "c1", role: "KLIENT" } });
    await writeBack({ entity: "invoice", kind: "create", row: { id: "inv1", matterId: "m1", amount: 1000, status: "SENT", invoiceDate: new Date("2026-05-01T00:00:00.000Z") } });
    await writeBack({ entity: "payment", kind: "create", row: { id: "pay1", invoiceId: "inv1", amount: 1000 } });
    await writeBack({ entity: "user", kind: "create", row: { id: "u1", email: "anna@firma.se", name: "Anna" } });

    const src = await hydrateWorkingCopy(fsa.root);

    expect(src.matters).toHaveLength(1);
    expect((src.matters![0] as { id: string }).id).toBe("m1");
    expect(src.contacts).toHaveLength(1);
    expect(src.invoices).toHaveLength(1);
    expect(src.payments).toHaveLength(1);
    expect(src.users).toHaveLength(1);
    expect((src.users![0] as { email: string }).email).toBe("anna@firma.se");
  });

  it("återställer Date-fält (ISO-strängar → Date)", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });
    await writeBack({ entity: "invoice", kind: "create", row: { id: "inv1", matterId: "m1", invoiceDate: new Date("2026-05-01T10:00:00.000Z") } });

    const src = await hydrateWorkingCopy(fsa.root);
    const inv = src.invoices![0] as { invoiceDate: unknown };
    expect(inv.invoiceDate).toBeInstanceOf(Date);
  });

  it("pre-bakar joins (matterContact.contact, invoice.matter)", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });
    await writeBack({ entity: "matter", kind: "create", row: { id: "m1", organizationId: "o1", title: "T" } });
    await writeBack({ entity: "contact", kind: "create", row: { id: "c1", organizationId: "o1", name: "Anna" } });
    await writeBack({ entity: "matterContact", kind: "create", row: { id: "mc1", matterId: "m1", contactId: "c1" } });
    await writeBack({ entity: "invoice", kind: "create", row: { id: "inv1", matterId: "m1", amount: 1 } });

    const src = await hydrateWorkingCopy(fsa.root);
    expect((src.matterContacts![0] as { contact: { name: string } }).contact.name).toBe("Anna");
    expect((src.invoices![0] as { matter: { organizationId: string } }).matter.organizationId).toBe("o1");
  });

  it("tom working copy → tom source", async () => {
    const fsa = makeFakeFsa();
    const src = await hydrateWorkingCopy(fsa.root);
    expect(src.matters ?? []).toHaveLength(0);
  });

  it("round-trip: writeOff write-back → hydrate (ADR 0007)", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });
    await writeBack({ entity: "invoice", kind: "create", row: { id: "inv1", matterId: "m1", amount: 1000, status: "SENT" } });
    await writeBack({ entity: "writeOff", kind: "create", row: { id: "wo1", invoiceId: "inv1", amount: 1000, writtenOffAt: new Date("2026-05-01T00:00:00.000Z"), reason: "Konkurs", recordedById: "u1" } });

    const src = await hydrateWorkingCopy(fsa.root);
    expect(src.writeOffs).toHaveLength(1);
    const wo = src.writeOffs![0] as { invoiceId: string; amount: number; writtenOffAt: unknown };
    expect(wo.invoiceId).toBe("inv1");
    expect(wo.amount).toBe(1000);
    expect(wo.writtenOffAt).toBeInstanceOf(Date);
  });

  it("gammalt repo utan write-offs/ → ingen krasch, writeOffs tom (ADR 0007)", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });
    await writeBack({ entity: "invoice", kind: "create", row: { id: "inv1", matterId: "m1", amount: 1000 } });

    const src = await hydrateWorkingCopy(fsa.root);
    expect(src.writeOffs ?? []).toHaveLength(0);
    expect(src.invoices).toHaveLength(1);
  });

  it("migrate-on-read: repoVersion=1 strippar invoice-`type` (ADR 0004)", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });
    await writeBack({ entity: "invoice", kind: "create", row: { id: "inv1", matterId: "m1", invoiceType: "STANDARD", type: "FINAL", amount: 1 } });

    const src = await hydrateWorkingCopy(fsa.root, 1);
    const inv = src.invoices![0] as Record<string, unknown>;
    expect(inv.invoiceType).toBe("STANDARD");
    expect(inv).not.toHaveProperty("type");
  });

  it("ingen migration när repoVersion = CURRENT (default) — `type` bevaras", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });
    await writeBack({ entity: "invoice", kind: "create", row: { id: "inv1", matterId: "m1", type: "FINAL", amount: 1 } });

    const src = await hydrateWorkingCopy(fsa.root); // default = CURRENT
    expect((src.invoices![0] as Record<string, unknown>)).toHaveProperty("type");
  });
});
