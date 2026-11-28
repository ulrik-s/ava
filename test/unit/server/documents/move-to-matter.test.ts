/**
 * `moveDocumentsToMatter` (#2045): ordningen i skrivningarna — dokumentet före
 * sina delar, så att radkön skickar dem i den ordningen.
 */

import { describe, expect, it } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { moveDocumentsToMatter } from "@/lib/server/documents/move-to-matter";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = asId<"OrganizationId">("org-a");

function repos() {
  const part = (id: string, documentId: string, fromPage: number) =>
    ({ id, documentId, matterId: "m1", kind: "KALLELSE", fromPage, toPage: fromPage, source: "AUTO", ordinal: fromPage });
  const source = prebakeJoins({
    matters: [
      { id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" },
      { id: "m2", organizationId: ORG, matterNumber: "2026-2", title: "U" },
    ],
    documents: [
      { id: "a", matterId: "m1", folderId: null, fileName: "a.pdf" },
      { id: "b", matterId: "m1", folderId: null, fileName: "b.pdf" },
    ],
    documentParts: [part("a-p1", "a", 1), part("a-p2", "a", 2), part("b-p1", "b", 1)],
  });
  return buildInMemoryRepositories(new LocalStore(source, async () => {}));
}

describe("moveDocumentsToMatter (#2045)", () => {
  it("skriver varje dokument före dess delar", async () => {
    const r = repos();
    const log: string[] = [];
    const writeDoc = r.documents.updateMetadata.bind(r.documents);
    const writePart = r.documentParts.update.bind(r.documentParts);
    r.documents.updateMetadata = (id, patch) => { log.push(`doc ${id}`); return writeDoc(id, patch); };
    r.documentParts.update = (id, patch) => { log.push(`part ${id}`); return writePart(id, patch); };
    const ids = [asId<"DocumentId">("a"), asId<"DocumentId">("b")];
    await expect(moveDocumentsToMatter(r, ORG, ids, { matterId: asId<"MatterId">("m2"), folderId: null })).resolves.toBe(2);
    expect(log).toEqual(["doc a", "part a-p1", "part a-p2", "doc b", "part b-p1"]);
  });
});
