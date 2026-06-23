/**
 * Mall-genererade dokument i ärenden (speglar GenerateModal): renderar en
 * dokumentmall med ärendets kontext → HTML-dokument registrerat på ärendet.
 */

import { describe, it, expect } from "vitest-compat";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { populate } from "../../tooling/demo-generator/populate";
import { populateTemplateDocs } from "../../tooling/demo-generator/populate-template-docs";
import type { SeedDataset } from "../../tooling/scripts/seed-data";

const now = new Date("2026-01-01T00:00:00Z");
const ADMIN = { id: asId<"UserId">("gen"), email: "gen@ava.local", name: "Generator", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">("org-test") };

const seed = {
  organizations: [{ id: "org-test", name: "Byrå AB", orgNumber: "556000-0000", createdAt: now, updatedAt: now }],
  users: [{ id: "u-test", email: "anna@test.se", name: "Anna Advokat", role: "ADMIN", hourlyRate: 1, organizationId: "org-test", createdAt: now, updatedAt: now }],
  contacts: [{ id: "c-test", name: "Klient AB", contactType: "COMPANY", organizationId: "org-test", createdAt: now, updatedAt: now }],
  matters: [{ id: "m-test", matterNumber: "2026-0099", title: "Tvist", status: "ACTIVE", organizationId: "org-test", createdAt: now, updatedAt: now }],
  matterContacts: [{ id: "mc-test", matterId: "m-test", contactId: "c-test", role: "KLIENT", organizationId: "org-test", createdAt: now }],
  documentTemplates: [{ id: "tpl-fullmakt", name: "Fullmakt", category: "Allmänt", content: "<h1>Fullmakt</h1><p>{{contact.name}} ger {{user.name}} fullmakt i ärende {{matter.matterNumber}}.</p>", organizationId: "org-test", createdById: "u-test", createdAt: now, updatedAt: now }],
} as unknown as SeedDataset;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

describe("populateTemplateDocs — mall → ärende", () => {
  it("renderar mall + registrerar HTML-dokument på ärendet", async () => {
    const writes: Array<{ path: string; html: string }> = [];
    const docs: Row[] = [];
    const target = createGitTarget({ principal: ADMIN, writeBack: async (e) => { if (e.entity === "document") docs.push(e.row); } });
    await populate(target.caller, seed);

    const count = await populateTemplateDocs(target.caller, seed, (path, bytes) => {
      writes.push({ path, html: new TextDecoder().decode(bytes) });
      return bytes.byteLength;
    });

    expect(count).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe("documents/content/gendoc-m-test-tpl-fullmakt.html");
    // Mallen renderad med ärendets kontext — inga kvarvarande {{...}}.
    expect(writes[0]!.html).toContain("Klient AB");
    expect(writes[0]!.html).toContain("Anna Advokat");
    expect(writes[0]!.html).toContain("2026-0099");
    expect(writes[0]!.html).not.toContain("{{");

    expect(docs).toHaveLength(1);
    expect(docs[0].matterId).toBe("m-test"); // hamnar i ärendet
    expect(docs[0].mimeType).toBe("text/html; charset=utf-8");
    expect(docs[0].documentType).toBe("Fullmakt");
    expect(String(docs[0].fileName)).toContain("Fullmakt");
  });
});
