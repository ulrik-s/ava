/**
 * `removeDocument` (#1230) — den gemensamma borttagningsvägen för användarens
 * "Ta bort" och för dokument som följer med en ångrad kostnadsräkning.
 */

import { describe, expect, it, vi } from "vitest-compat";
import { removeDocument } from "@/lib/server/documents/remove-document";
import { asId } from "@/lib/shared/schemas/ids";

const ID = asId<"DocumentId">("d-1");

function repos(hardDelete: (id: string) => Promise<void>) {
  return { documents: { hardDelete } };
}

describe("removeDocument", () => {
  it("tar bort raden och rensar sökindexet", async () => {
    const hardDelete = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    await removeDocument(repos(hardDelete), { remove }, ID);
    expect(hardDelete).toHaveBeenCalledWith(ID);
    expect(remove).toHaveBeenCalledWith(ID);
  });

  it("ett misslyckat index-anrop fäller inte borttagningen", async () => {
    const hardDelete = vi.fn(async () => {});
    const remove = vi.fn(async () => { throw new Error("index nere"); });
    await expect(removeDocument(repos(hardDelete), { remove }, ID)).resolves.toBeUndefined();
    expect(hardDelete).toHaveBeenCalled();
  });
});
