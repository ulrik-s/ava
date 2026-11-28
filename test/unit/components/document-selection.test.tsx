/**
 * Markera flera dokument och flytta dem tillsammans (#2046): knappen
 * **Flytta till ärende… (N)**, dialogen från #2045 med alla markerade id:n, och
 * regeln för vad som går att markera (samma som dokumentmenyns rad).
 */

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import {
  isMovableDocument, MoveDocumentsButton, rowToggle, useDocumentSelection, type SelectableDocument,
} from "@/components/documents/_document-selection";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, testQueryClient, TrpcTestProvider } from "../../helpers/trpc-fake";

vi.mock("@/components/matter/use-active-matter-options", () => ({
  useActiveMatterOptions: () => [
    { id: asId<"MatterId">("m-1"), matterNumber: "2026-0001", title: "Vårdnad" },
    { id: asId<"MatterId">("m-2"), matterNumber: "2026-0002", title: "Arvskifte" },
  ],
}));

const TREE = { folders: [{ id: "f-2", name: "Inlagor", parentId: null }], documents: [] };

function setup(selected: readonly string[]) {
  const fake = fakeTrpcLink({ "document.tree": () => TREE, "document.moveToMatter": () => ({ moved: selected.length }) });
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onMoved = vi.fn();
  render(
    <TrpcTestProvider link={fake.link} queryClient={queryClient}>
      <MoveDocumentsButton selected={new Set(selected)} matterId={asId<"MatterId">("m-1")} onMoved={onMoved} />
    </TrpcTestProvider>,
  );
  return { fake, invalidate, onMoved };
}

describe("MoveDocumentsButton (#2046)", () => {
  it("syns inte utan markering", () => {
    setup([]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Flytta anropar document.moveToMatter med alla markerade id:n och vald mapp, läser om och tömmer", async () => {
    const { fake, invalidate, onMoved } = setup(["d-1", "d-2"]);
    fireEvent.click(screen.getByRole("button", { name: "Flytta till ärende… (2)" }));
    fireEvent.change(screen.getByLabelText("2 dokument flyttas till:"), { target: { value: "2026-0002 — Arvskifte" } });
    const folder = screen.getByLabelText<HTMLSelectElement>("Mapp");
    expect(folder.value).toBe("");
    await waitFor(() => expect(folder.options).toHaveLength(2));
    fireEvent.change(folder, { target: { value: "f-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Flytta" }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fake.calls.filter((c) => c.path === "document.moveToMatter").map((c) => c.input))
      .toEqual([{ ids: ["d-1", "d-2"], matterId: "m-2", folderId: "f-2" }]);
    expect(invalidate).toHaveBeenCalled();
  });

  it("Avbryt stänger dialogen utan anrop och utan att tömma markeringen", () => {
    const { fake, onMoved } = setup(["d-1"]);
    fireEvent.click(screen.getByRole("button", { name: "Flytta till ärende… (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fake.calls.filter((c) => c.path === "document.moveToMatter")).toEqual([]);
    expect(onMoved).not.toHaveBeenCalled();
  });
});

describe("vad som går att markera (#2046)", () => {
  const doc = (over: Partial<SelectableDocument> = {}): SelectableDocument => ({ id: "d-1", ...over });

  it("isMovableDocument följer dokumentmenyns regel", () => {
    expect(isMovableDocument(doc(), false)).toBe(true);
    expect(isMovableDocument(doc(), true)).toBe(false);
    expect(isMovableDocument(doc({ invoiceId: "i-1" }), false)).toBe(false);
    expect(isMovableDocument(doc({ billingRunId: "b-1" }), false)).toBe(false);
  });

  it("useDocumentSelection: uppladdade dokument går inte att markera, clear tömmer", () => {
    const { result } = renderHook(() => useDocumentSelection<SelectableDocument>(new Set(["d-up"])));
    expect(result.current.selection.isSelectable?.(doc())).toBe(true);
    expect(result.current.selection.isSelectable?.(doc({ id: "d-up" }))).toBe(false);
    act(() => result.current.selection.onChange(new Set(["d-1"])));
    expect([...result.current.selection.selected]).toEqual(["d-1"]);
    act(() => result.current.clear());
    expect(result.current.selection.selected.size).toBe(0);
  });

  it("rowToggle: ingen kryssruta för det som inte går att markera, annars av/på", () => {
    const onChange = vi.fn();
    const selection = { selected: new Set(["d-1"]), onChange, isSelectable: (d: SelectableDocument) => !d.invoiceId };
    expect(rowToggle(selection, doc({ invoiceId: "i-1" }))).toBeUndefined();
    const toggle = rowToggle(selection, doc());
    expect(toggle?.checked).toBe(true);
    toggle?.onToggle();
    expect([...(onChange.mock.calls[0]?.[0] as Set<string>)]).toEqual([]);
    expect(rowToggle({ selected: new Set<string>(), onChange }, doc({ id: "d-2" }))?.checked).toBe(false);
  });
});
