/**
 * "Redigera uppgifter" för ett dokument: startvärden, att bara ändrade fält
 * skickas, att en specialtyp ("E-post") står kvar utan nytt val, och att
 * Spara är avstängd när inget ändrats.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { DocumentDetailsDialog } from "@/components/documents/_document-details-dialog";
import { detailsChanges, detailsFromDocument } from "@/components/documents/_document-details-input";

const mutate = vi.fn();
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ document: { invalidate: vi.fn() } }),
    document: { updateDetails: { useMutation: () => ({ mutate, isPending: false, error: null }) } },
  },
}));

const DOC = {
  fileName: "scan_001.pdf", title: "Skannat", documentType: "KALLELSE",
  direction: "INKOMMANDE" as const, recipient: null, summary: "Kallelse till förhandling",
};

beforeEach(() => mutate.mockReset());

function openDialog(doc: Record<string, unknown> = {}) {
  render(<DocumentDetailsDialog docId={"d1" as never} doc={{ ...DOC, ...doc }} open onClose={() => {}} />);
}

describe("detailsChanges", () => {
  it("inga ändringar → tomt", () => {
    expect(detailsChanges(DOC, detailsFromDocument(DOC))).toEqual({});
  });

  it("bara ändrade fält; tom titel → null; riktning kan tas bort", () => {
    const v = { ...detailsFromDocument(DOC), title: "", documentType: "DOM" as const, direction: "" as const };
    expect(detailsChanges(DOC, v)).toEqual({ title: null, documentType: "DOM", direction: null });
  });

  it("specialtyp (E-post) utan nytt val skickas inte", () => {
    const mail = { ...DOC, documentType: "E-post" };
    expect(detailsFromDocument(mail).documentType).toBe("");
    expect(detailsChanges(mail, detailsFromDocument(mail))).toEqual({});
  });
});

describe("DocumentDetailsDialog", () => {
  it("startar från dokumentets uppgifter och Spara är avstängd utan ändring", () => {
    openDialog();
    expect(screen.getByLabelText("Filnamn")).toHaveValue("scan_001.pdf");
    expect(screen.getByLabelText("Dokumenttyp")).toHaveValue("KALLELSE");
    expect(screen.getByLabelText("Riktning")).toHaveValue("INKOMMANDE");
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
  });

  it("rättad klassning + nytt namn skickas, med förhandsvisning av filnamnet", () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Dokumenttyp"), { target: { value: "STAMNING" } });
    fireEvent.change(screen.getByLabelText("Filnamn"), { target: { value: "Stämningsansökan" } });
    expect(screen.getByText("Sparas som: Stämningsansökan.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(mutate).toHaveBeenCalledWith({ documentId: "d1", documentType: "STAMNING", fileName: "Stämningsansökan" });
  });

  it("specialtyp visas som oförändrad", () => {
    openDialog({ documentType: "E-post" });
    expect(screen.getByRole("option", { name: "E-post (oförändrad)" })).toBeInTheDocument();
  });

  it("tomt filnamn spärrar Spara", () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Filnamn"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
  });
});
