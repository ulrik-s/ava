/**
 * Reparation av icke-uuid-id (dataförlusten på ava-crm.io 2026-09-23): rader
 * skapade i klienten fick id som `muej66a9-jd9ieu`, servern sparade dem aldrig.
 */
import { describe, expect, it } from "bun:test";
import { LEGACY_ID_NAMESPACE, repairLegacyIds } from "@/lib/server/data-store/in-memory/legacy-id-repair";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { isUuid } from "@/lib/shared/uuid";
import { uuidv5 } from "@/lib/shared/uuid-derive";

const ORG = "00000000-0000-0000-0000-000000000001";
const CONTACT = "muej66a9-jd9ieu";
const MATTER = "muej7b10-x81kd2";

function legacySource() {
  return {
    contacts: [{ id: CONTACT, organizationId: ORG, name: "Klient AB", createdAt: "2026-09-23T19:00:00.000Z" }],
    matters: [{ id: MATTER, organizationId: ORG, title: "Avtalstvist", createdAt: "2026-09-23T19:05:00.000Z" }],
    matterContacts: [{
      id: "muej7b11-aa11bb", matterId: MATTER, contactId: CONTACT, role: "CLIENT",
      createdAt: "2026-09-23T19:05:01.000Z",
    }],
    users: [{ id: "01a0cf73-ed19-70e8-a868-58c8ed9c9ef8", name: "Cecilia" }],
  };
}

describe("repairLegacyIds", () => {
  it("gör ingenting när alla id redan är uuid", () => {
    const source = { contacts: [{ id: "01a0cf73-ed19-70e8-a868-58c8ed9c9ef8", name: "X" }] };
    const r = repairLegacyIds(source, []);
    expect(r.changed).toBe(false);
    expect(r.source).toBe(source);
    expect(r.recreated).toEqual([]);
  });

  it("ger varje rad ett uuid och skriver om alla referenser till samma uuid", () => {
    const r = repairLegacyIds(legacySource(), []);
    const contact = r.source.contacts[0]!;
    const matter = r.source.matters[0]!;
    const link = r.source.matterContacts[0]!;
    expect(isUuid(contact.id)).toBe(true);
    expect(isUuid(matter.id)).toBe(true);
    expect(link.contactId).toBe(contact.id);
    expect(link.matterId).toBe(matter.id);
    // Rader som redan hade uuid rörs inte.
    expect(r.source.users[0]!.id).toBe("01a0cf73-ed19-70e8-a868-58c8ed9c9ef8");
  });

  it("är deterministisk — samma gamla id ger alltid samma nya", () => {
    const a = repairLegacyIds(legacySource(), []);
    const b = repairLegacyIds(legacySource(), []);
    expect(a.source.contacts[0]!.id).toBe(b.source.contacts[0]!.id);
    expect(a.source.contacts[0]!.id).toBe(uuidv5(CONTACT, LEGACY_ID_NAMESPACE));
  });

  it("köar de reparerade raderna i skapandeordning (klienten före ärendet som pekar på den)", () => {
    const r = repairLegacyIds(legacySource(), []);
    expect(r.recreated.map((x) => x.entity)).toEqual(["contact", "matter", "matterContact"]);
    expect(r.recreated.every((x) => isUuid(x.row.id))).toBe(true);
  });

  it("skriver om id:n även i redan köade mutationer", () => {
    const queued: QueuedMutation[] = [{
      mutationId: "01a0cfdd-b051-796e-8390-45d47b008674", entity: "matter", kind: "update",
      row: { id: MATTER, title: "Avtalstvist II" }, previous: { id: MATTER, title: "Avtalstvist" },
      enqueuedAt: 1,
    }];
    const r = repairLegacyIds(legacySource(), queued);
    const m = r.queued[0]!;
    expect(m.mutationId).toBe("01a0cfdd-b051-796e-8390-45d47b008674");
    expect(m.row.id).toBe(r.source.matters[0]!.id);
    expect(m.previous?.id).toBe(r.source.matters[0]!.id);
  });

  it("rör inte Date-värden", () => {
    const when = new Date("2026-09-23T19:00:00.000Z");
    const r = repairLegacyIds({ contacts: [{ id: CONTACT, createdAt: when }] }, []);
    expect(r.source.contacts[0]!.createdAt).toBe(when);
  });
});
