/**
 * `useMatterDocuments` (#1308): ärendets alla dokument, i alla mappar, via
 * `document.tree` — inte `document.list`, som bara ger en mapp.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import { useMatterDocuments } from "@/lib/client/documents/use-matter-documents";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcWrapper, never } from "../../../../helpers/trpc-fake";

let treeData: { folders: unknown[]; documents: unknown[] } | undefined;

/** Kör hooken under en fejkad länk; utan `treeData` svarar trädet aldrig. */
function renderDocs() {
  const { wrapper, fake } = fakeTrpcWrapper({ "document.tree": () => treeData ?? never() });
  return { fake, ...renderHook(() => useMatterDocuments(asId<"MatterId">("m-1")), { wrapper }) };
}

describe("useMatterDocuments", () => {
  it("frågar trädet för ärendet och ger dokumenten ur alla mappar", async () => {
    treeData = { folders: [{ id: "f1" }], documents: [{ id: "d-rot", folderId: null }, { id: "d-mapp", folderId: "f1" }] };
    const { fake, result } = renderDocs();
    await waitFor(() => expect(result.current?.map((d) => d.id)).toEqual(["d-rot", "d-mapp"]));
    expect(fake.calls.map((c) => [c.path, c.input])).toEqual([["document.tree", { matterId: "m-1" }]]);
  });

  it("undefined tills trädet laddats", async () => {
    treeData = undefined;
    const { fake, result } = renderDocs();
    await waitFor(() => expect(fake.calls).toHaveLength(1));
    expect(result.current).toBeUndefined();
  });
});
