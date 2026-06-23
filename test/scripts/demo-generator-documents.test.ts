/**
 * Dokument-generering: metadata via tRPC (`document.register`, utökad med
 * AI-analys-fält) + riktiga binärfiler via `generateDocumentBytes` → `sink`.
 */

import { describe, it, expect } from "vitest-compat";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { populate } from "../../tooling/demo-generator/populate";
import { populateDocuments } from "../../tooling/demo-generator/populate-documents";
import type { SeedDataset } from "../../tooling/scripts/seed-data";

const now = new Date("2026-01-01T00:00:00Z");
const ADMIN = { id: asId<"UserId">("gen"), email: "gen@ava.local", name: "Generator", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">("org-test") };

const seed = {
  organizations: [{ id: "org-test", name: "T AB", createdAt: now, updatedAt: now }],
  users: [{ id: "u-test", email: "anna@test.se", name: "Anna", role: "ADMIN", hourlyRate: 1, organizationId: "org-test", createdAt: now, updatedAt: now }],
  contacts: [],
  matters: [{ id: "m-test", matterNumber: "2024-0001", title: "Ärende", status: "ACTIVE", organizationId: "org-test", createdAt: now, updatedAt: now }],
  documents: [{ id: "doc-1", organizationId: "org-test", matterId: "m-test", folderId: null, fileName: "Avtal.pdf", mimeType: "application/pdf", sizeBytes: 0, storagePath: "documents/content/doc-1.pdf", version: 1, uploadedById: "u-test", title: "Avtal", documentType: "Avtal", summary: "Demo med å ä ö", analyzedAt: now, analysisStatus: "DONE", createdAt: now, updatedAt: now }],
} as unknown as SeedDataset;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

describe("populateDocuments — metadata via API", () => {
  it("registrerar dokument med AI-metadata (titel, typ, analysisStatus, uploadedById)", async () => {
    const captured: Row[] = [];
    const target = createGitTarget({ principal: ADMIN, writeBack: async (e) => { if (e.entity === "document") captured.push(e.row); } });
    await populate(target.caller, seed);
    const count = await populateDocuments(target.caller, seed); // ingen sink → metadata-only

    expect(count).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].title).toBe("Avtal");
    expect(captured[0].documentType).toBe("Avtal");
    expect(captured[0].analysisStatus).toBe("DONE"); // ej tvingat PENDING
    expect(captured[0].uploadedById).toBe("u-test"); // ej tvingat anroparen
  });

  it("genererar binärinnehåll via sink och sätter faktisk sizeBytes", async () => {
    const writes: Array<{ path: string; size: number }> = [];
    const captured: Row[] = [];
    const target = createGitTarget({ principal: ADMIN, writeBack: async (e) => { if (e.entity === "document") captured.push(e.row); } });
    await populate(target.caller, seed);
    await populateDocuments(target.caller, seed, (path, bytes) => {
      writes.push({ path, size: bytes.byteLength });
      return bytes.byteLength;
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe("documents/content/doc-1.pdf");
    expect(writes[0]!.size).toBeGreaterThan(0); // riktig PDF genererad
    expect(captured[0].sizeBytes).toBe(writes[0]!.size); // storlek från genererade bytes
  });
});
