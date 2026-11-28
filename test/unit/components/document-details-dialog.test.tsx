/**
 * "Redigera uppgifter" för ett dokument: startvärden, att bara ändrade fält
 * skickas, val av flera typer (ADR 0038) där den första är huvudtypen, och att
 * Spara är avstängd när inget ändrats.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { DocumentDetailsDialog } from "@/components/documents/_document-details-dialog";
import { detailsChanges, detailsFromDocument } from "@/components/documents/_document-details-input";
import { kindOptions, toggleKind } from "@/components/documents/_document-kinds-picker";

const mutate = vi.fn();
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ document: { invalidate: vi.fn() } }),
    document: { updateDetails: { useMutation: () => ({ mutate, isPending: false, error: null }) } },
    organization: { getSettings: { useQuery: () => ({ data: { documentKinds: ["Korrespondens"] } }) } },
  },
}));

const DOC = {
  fileName: "scan_001.pdf", title: "Skannat", kinds: ["KALLELSE"],
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

  it("bara ändrade fält; tom titel → null; riktning kan tas bort; typerna i ordning", () => {
    const v = { ...detailsFromDocument(DOC), title: "", kinds: ["DOM", "KALLELSE"], direction: "" as const };
    expect(detailsChanges(DOC, v)).toEqual({ title: null, kinds: ["DOM", "KALLELSE"], direction: null });
  });

  it("äldre rad: typerna läses via documentType och skickas inte om de inte ändrats", () => {
    const old = { ...DOC, kinds: [], documentType: "E-post" };
    expect(detailsFromDocument(old).kinds).toEqual(["EPOST"]);
    expect(detailsChanges(old, detailsFromDocument(old))).toEqual({});
  });
});

describe("kindOptions / toggleKind", () => {
  it("inbyggda, byråns egna, sedan dokumentets övriga — utan dubbletter", () => {
    const opts = kindOptions(["Korrespondens"], ["Gammal", "KALLELSE"]);
    expect(opts[0]).toBe("STAMNING");
    expect(opts.slice(-2)).toEqual(["Korrespondens", "Gammal"]);
  });

  it("lägger till sist eller tar bort", () => {
    expect(toggleKind(["A"], "B")).toEqual(["A", "B"]);
    expect(toggleKind(["A", "B"], "A")).toEqual(["B"]);
  });
});

describe("DocumentDetailsDialog", () => {
  it("startar från dokumentets uppgifter och Spara är avstängd utan ändring", () => {
    openDialog();
    expect(screen.getByLabelText("Filnamn")).toHaveValue("scan_001.pdf");
    expect(screen.getByRole("checkbox", { name: "Kallelse" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Korrespondens" })).not.toBeChecked();
    expect(screen.getByLabelText("Riktning")).toHaveValue("INKOMMANDE");
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
  });

  it("valrutorna listar etiketterna ur enums.ts: Försäkringsbolag, Inkommande, Utgående (#1999)", () => {
    openDialog();
    const recipient = screen.getByLabelText("Mottagare / avsändare");
    expect(within(recipient).getByRole("option", { name: "Försäkringsbolag" })).toHaveValue("FORSAKRING");
    const direction = screen.getByLabelText("Riktning");
    expect(within(direction).getByRole("option", { name: "Inkommande" })).toHaveValue("INKOMMANDE");
    expect(within(direction).getByRole("option", { name: "Utgående" })).toHaveValue("UTGAENDE");
  });

  it("flera typer + nytt namn skickas, med förhandsvisning av filnamnet och huvudtypen markerad", () => {
    openDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: "Förordnande" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Korrespondens" }));
    expect(screen.getByText("huvudtyp")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filnamn"), { target: { value: "Förordnande" } });
    expect(screen.getByText("Sparas som: Förordnande.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(mutate).toHaveBeenCalledWith({ documentId: "d1", kinds: ["KALLELSE", "FORORDNANDE", "Korrespondens"], fileName: "Förordnande" });
  });

  it("en äldre fritexttyp på dokumentet går att välja bort och behålla", () => {
    openDialog({ kinds: ["Gammal fritext"] });
    expect(screen.getByRole("checkbox", { name: "Gammal fritext" })).toBeChecked();
  });

  it("tomt filnamn spärrar Spara", () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Filnamn"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
  });
});
