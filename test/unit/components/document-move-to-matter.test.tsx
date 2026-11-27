/**
 * Dokumentmenyns **Flytta till ärende…** (#2045): raden står direkt efter
 * **Redigera uppgifter…**, är spärrad för fakturans och kostnadsräkningens egna
 * dokument, och öppnar dialogen med målärendets mappar. **Flytta** anropar
 * `document.moveToMatter` med valt ärende och vald mapp och läser om dokumenten.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { DocumentActions, type DocumentRecord } from "@/components/documents/_document-row";
import { documentMoveDisabledReason } from "@/components/documents/move-documents-dialog";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, testQueryClient, TrpcTestProvider, type TrpcHandlers } from "../../helpers/trpc-fake";

// Dialogerna som inte prövas här läser den gamla bindningen; de stubbas bort.
vi.mock("@/components/documents/_document-details-dialog", () => ({ DocumentDetailsDialog: () => null }));
vi.mock("@/components/documents/use-office365-configured", () => ({ useOffice365Configured: () => false }));
vi.mock("@/components/matter/use-active-matter-options", () => ({
  useActiveMatterOptions: () => [
    { id: asId<"MatterId">("m-1"), matterNumber: "2026-0001", title: "Vårdnad" },
    { id: asId<"MatterId">("m-2"), matterNumber: "2026-0002", title: "Arvskifte" },
  ],
}));

const DOC: DocumentRecord = {
  id: asId<"DocumentId">("d-1"), matterId: asId<"MatterId">("m-1"), folderId: null, fileName: "stamning.pdf",
  sizeBytes: 1024, mimeType: "application/pdf", storagePath: "documents/content/d-1.pdf", createdAt: new Date(),
  version: 1, uploadedById: asId<"UserId">("u-1"), uploadedBy: null,
};

const TREE = {
  folders: [
    { id: "f-2", name: "Inlagor", parentId: null },
    { id: "f-3", name: "Domstol", parentId: "f-2" },
  ],
  documents: [],
};

function setup(doc: Partial<DocumentRecord> = {}, handlers: TrpcHandlers = {}) {
  const fake = fakeTrpcLink({
    "document.tree": () => TREE,
    "document.moveToMatter": () => ({ moved: 1 }),
    ...handlers,
  });
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <TrpcTestProvider link={fake.link} queryClient={queryClient}>
      <DocumentActions doc={{ ...DOC, ...doc }} onReanalyze={vi.fn()} onDelete={vi.fn()}
        reanalyzePending={false} onExternalEdit={async () => {}} />
    </TrpcTestProvider>,
  );
  fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
  return { fake, invalidate };
}

const moveItem = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>("menuitem", { name: /Flytta till ärende…/ });
const matterInput = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>("1 dokument flyttas till:");
const moves = (fake: ReturnType<typeof fakeTrpcLink>) => fake.calls.filter((c) => c.path === "document.moveToMatter");

afterEach(() => { vi.restoreAllMocks(); });

describe("Flytta till ärende… i dokumentmenyn (#2045)", () => {
  it("raden står direkt efter Redigera uppgifter…", () => {
    setup();
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent.trim());
    const details = labels.findIndex((l) => l.includes("Redigera uppgifter…"));
    expect(labels[details + 1]).toContain("Flytta till ärende…");
    expect(moveItem().disabled).toBe(false);
    expect(moveItem().title).toBe("Flytta dokumentet till ett annat ärende och en mapp där");
  });

  it.each([{ invoiceId: "i-1" }, { billingRunId: "b-1" }])("spärrad med en förklaring för %o", (owned) => {
    setup(owned);
    expect(moveItem().disabled).toBe(true);
    expect(moveItem().title).toBe("Fakturans och kostnadsräkningens egna dokument kan inte flyttas.");
  });

  it("dialogen visar mappfältet först när ett ärende är valt, med målärendets mappar och Överst förvalt", async () => {
    const { fake } = setup();
    fireEvent.click(moveItem());
    const dialog = screen.getByRole("dialog", { name: "Flytta till ärende" });
    expect(within(dialog).queryByLabelText("Mapp")).toBeNull();
    fireEvent.change(matterInput(), { target: { value: "2026-0002 — Arvskifte" } });
    const folder = within(dialog).getByLabelText<HTMLSelectElement>("Mapp");
    expect(folder.value).toBe("");
    await waitFor(() => expect(Array.from(folder.options).map((o) => o.textContent)).toEqual([
      "Överst, utan mapp", "Inlagor", "Inlagor › Domstol",
    ]));
    expect(fake.calls.find((c) => c.path === "document.tree")?.input).toEqual({ matterId: "m-2" });
  });

  it("Flytta anropar document.moveToMatter med valt ärende och mapp, läser om dokumenten och stänger", async () => {
    const { fake, invalidate } = setup();
    fireEvent.click(moveItem());
    fireEvent.change(matterInput(), { target: { value: "2026-0002 — Arvskifte" } });
    const folder = screen.getByLabelText<HTMLSelectElement>("Mapp");
    await waitFor(() => expect(folder.options).toHaveLength(3));
    fireEvent.change(folder, { target: { value: "f-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Flytta" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(moves(fake).map((c) => c.input)).toEqual([{ ids: ["d-1"], matterId: "m-2", folderId: "f-3" }]);
    // `t.document.pathFilter()`: alla dokumentfrågor, i båda ärendena.
    expect(invalidate.mock.calls.map((c: readonly unknown[]) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0])).toEqual([["document"]]);
  });

  it("utan vald mapp flyttas dokumentet överst (folderId null)", async () => {
    const { fake } = setup();
    fireEvent.click(moveItem());
    fireEvent.change(matterInput(), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(screen.getByRole("button", { name: "Flytta" }));
    await waitFor(() => expect(moves(fake)).toHaveLength(1));
    expect(moves(fake)[0]?.input).toEqual({ ids: ["d-1"], matterId: "m-2", folderId: null });
  });

  it("serverns fel visas i dialogen, som står kvar", async () => {
    setup({}, { "document.moveToMatter": () => { throw new Error("Mappen hör till ett annat ärende."); } });
    fireEvent.click(moveItem());
    fireEvent.change(matterInput(), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(screen.getByRole("button", { name: "Flytta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunde inte flytta: Mappen hör till ett annat ärende.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Avbryt stänger dialogen utan anrop", () => {
    const { fake } = setup();
    fireEvent.click(moveItem());
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(moves(fake)).toEqual([]);
  });
});

describe("documentMoveDisabledReason (#2045)", () => {
  it("uppladdning, fakturans och kostnadsräkningens dokument spärrar; annars null", () => {
    expect(documentMoveDisabledReason({}, false)).toBeNull();
    expect(documentMoveDisabledReason({ invoiceId: null, billingRunId: null }, false)).toBeNull();
    expect(documentMoveDisabledReason({}, true)).toBe("Vänta tills uppladdningen är klar");
    expect(documentMoveDisabledReason({ invoiceId: "i-1" }, false)).toBe("Fakturans och kostnadsräkningens egna dokument kan inte flyttas.");
    expect(documentMoveDisabledReason({ billingRunId: "b-1" }, true)).toBe("Vänta tills uppladdningen är klar");
  });
});
