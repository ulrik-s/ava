/**
 * `useMatterDocuments` (#1308): ärendets alla dokument, i alla mappar, via
 * `document.tree` — inte `document.list`, som bara ger en mapp.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { useMatterDocuments } from "@/lib/client/documents/use-matter-documents";
import { asId } from "@/lib/shared/schemas/ids";

const calls: unknown[] = [];
let treeData: { folders: unknown[]; documents: unknown[] } | undefined;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    document: { tree: { useQuery: (input: unknown) => { calls.push(input); return { data: treeData }; } } },
  },
}));

describe("useMatterDocuments", () => {
  it("frågar trädet för ärendet och ger dokumenten ur alla mappar", () => {
    treeData = { folders: [{ id: "f1" }], documents: [{ id: "d-rot", folderId: null }, { id: "d-mapp", folderId: "f1" }] };
    const { result } = renderHook(() => useMatterDocuments(asId<"MatterId">("m-1")));
    expect(calls.at(-1)).toEqual({ matterId: "m-1" });
    expect(result.current?.map((d) => d.id)).toEqual(["d-rot", "d-mapp"]);
  });

  it("undefined tills trädet laddats", () => {
    treeData = undefined;
    const { result } = renderHook(() => useMatterDocuments(asId<"MatterId">("m-1")));
    expect(result.current).toBeUndefined();
  });
});
