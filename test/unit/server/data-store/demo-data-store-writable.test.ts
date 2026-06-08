/**
 * Integrationstest: `DemoDataStore` i writable mode + auto-join för
 * relations som UI:n förväntar sig nästade på nya rows.
 */

import { describe, it, expect } from "vitest-compat";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";

describe("DemoDataStore writable", () => {
  it("create matterContact ger row med .contact pre-baked", async () => {
    const source = {
      matters: [{ id: "m1", title: "Avtal", organizationId: "o1" }],
      contacts: [{ id: "c1", name: "Anna", organizationId: "o1", contactType: "PERSON" }],
      matterContacts: [],
    };
    const events: MutationEvent<Record<string, unknown>>[] = [];
    const ds = new DemoDataStore(source, (e) => { events.push(e); });

    const created = await ds.matterContacts.create({
      data: { id: "mc1", matterId: "m1", contactId: "c1", role: "KLIENT", organizationId: "o1" },
    } as never);

    // Den returnerade row:n måste ha .contact pre-baked så UI:n
    // (som mappar c => c.contact.name) inte kraschar.
    const c = created as unknown as { contact?: { id: string; name: string } };
    expect(c.contact).toBeDefined();
    expect(c.contact!.name).toBe("Anna");
  });

  it("matter med include.contacts returnerar matterContacts med .contact (pre-baked källa)", async () => {
    // Production-vägen pre-bakar joins via demoSourceFromRuntime. Vi
    // härmar det i testet — matterContacts har .contact + .matter
    // redan vid load.
    const c1 = { id: "c1", name: "Anna", organizationId: "o1", contactType: "PERSON" };
    const m1 = { id: "m1", title: "Avtal", organizationId: "o1" };
    const source = {
      matters: [m1],
      contacts: [c1],
      matterContacts: [{ id: "mc1", matterId: "m1", contactId: "c1", role: "KLIENT", organizationId: "o1", contact: c1, matter: m1 }],
    };
    const ds = new DemoDataStore(source);
    const m = await ds.matters.findUnique({
      where: { id: "m1" },
      include: { contacts: { include: { contact: true } } },
    } as never);
    type MatterWithContacts = { contacts: Array<{ contact: { name: string } }> };
    const matter = m as unknown as MatterWithContacts;
    expect(matter.contacts).toHaveLength(1);
    expect(matter.contacts[0]!.contact).toBeDefined();
    expect(matter.contacts[0]!.contact.name).toBe("Anna");
  });

  // Regressionsskydd: tidigare mappade `entityNameFor` bara 8 nycklar och
  // lät resten falla igenom till PLURAL-nyckeln (t.ex. "documentFolders").
  // fsa-write-back känner bara igen SINGULAR-namn → mutationer på dessa
  // entiteter skrevs aldrig till git ("ser ut att fungera i UI:t men
  // persisteras inte"). Varje writable entitet måste emit:a sitt singulara
  // projektion-namn.
  it.each([
    ["documentFolders", "documentFolder"],
    ["documentTemplates", "documentTemplate"],
    ["documentAnalysisSuggestions", "documentAnalysisSuggestion"],
    ["matterEventSuggestions", "matterEventSuggestion"],
    ["organizations", "organization"],
    ["offices", "office"],
    ["conflictChecks", "conflictCheck"],
  ])("mutation på %s emit:ar entity-namn '%s'", async (key, expected) => {
    const events: MutationEvent<Record<string, unknown>>[] = [];
    const ds = new DemoDataStore({}, (e) => { events.push(e); });
    const delegate = (ds as unknown as Record<string, { create: (a: unknown) => Promise<unknown> }>)[key]!;
    await delegate.create({ data: { id: "x1", organizationId: "o1" } });
    expect(events.at(-1)!.entity).toBe(expected);
  });

  it("create + findUnique cycle: nya matterContact har .contact", async () => {
    const source = {
      matters: [{ id: "m1", title: "Avtal", organizationId: "o1" }],
      contacts: [{ id: "c1", name: "Anna", organizationId: "o1", contactType: "PERSON" }],
      matterContacts: [],
    };
    const ds = new DemoDataStore(source, () => { /* noop */ });
    await ds.matterContacts.create({
      data: { id: "mc1", matterId: "m1", contactId: "c1", role: "KLIENT", organizationId: "o1" },
    } as never);
    const m = await ds.matters.findUnique({
      where: { id: "m1" },
      include: { contacts: { include: { contact: true } } },
    } as never);
    type MatterWithContacts = { contacts: Array<{ contact: { name: string } }> };
    const matter = m as unknown as MatterWithContacts;
    expect(matter.contacts).toHaveLength(1);
    expect(matter.contacts[0]!.contact).toBeDefined();
    expect(matter.contacts[0]!.contact.name).toBe("Anna");
  });
});
