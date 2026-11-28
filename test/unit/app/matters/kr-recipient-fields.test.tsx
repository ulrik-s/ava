/**
 * Kostnadsräkningens mottagare (#1891): domstol och målnummer per
 * kostnadsräkning. Förvalt är ärendets; Byt domstol… söker bara bland byråns
 * domstolar, utan "+ Ny …", och tömmer målnumret.
 */
import { fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest-compat";
import { KrRecipientFields, useKrRecipient } from "@/app/matters/[id]/_kr-recipient-fields";
import { fakeTrpcLink, TrpcTestProvider, type FakeTrpcLink } from "../../../helpers/trpc-fake";

let hits: Array<{ id: string; name: string; contactType: string }> = [];
/** Den senaste renderingens länk. */
let fake: FakeTrpcLink;

/** Renderar under en fejkad tRPC-länk där domstolssökningen svarar med `hits`. */
function renderTrpc(ui: ReactElement): RenderResult {
  fake = fakeTrpcLink({ "contacts.search": () => ({ contacts: hits }) });
  return render(<TrpcTestProvider link={fake.link}>{ui}</TrpcTestProvider>);
}

/** Indata till klientsökningen, i ordning. */
const searchInputs = (): unknown[] => fake.calls.filter((c) => c.path === "contacts.search").map((c) => c.input);

interface Sent {
  courtName?: string;
  courtCaseNumber?: string;
  court: { courtContactId?: string };
}

/** Fälten, och det dialogen skulle skicka vidare (som attribut på en output). */
function Harness({ court, caseNumber }: { court?: string | undefined; caseNumber?: string | undefined }) {
  const recipient = useKrRecipient(court, caseNumber);
  return (
    <>
      <KrRecipientFields recipient={recipient} />
      <output data-testid="sent" data-court={recipient.courtName} data-case={recipient.courtCaseNumber}
        data-contact={recipient.court.courtContactId} />
    </>
  );
}

/** Det som skulle skickas vidare; ett saknat attribut är ett utelämnat fält. */
function current(): Sent {
  const el = screen.getByTestId("sent");
  const courtName = el.getAttribute("data-court");
  const courtCaseNumber = el.getAttribute("data-case");
  const contact = el.getAttribute("data-contact");
  return {
    ...(courtName === null ? {} : { courtName }),
    ...(courtCaseNumber === null ? {} : { courtCaseNumber }),
    court: contact === null ? {} : { courtContactId: contact },
  };
}

function openPickerAndSearch(term: string): void {
  fireEvent.click(screen.getByRole("button", { name: "Byt domstol…" }));
  fireEvent.change(screen.getByLabelText("Sök domstol"), { target: { value: term } });
}

beforeEach(() => {
  hits = [{ id: "c-hov", name: "Svea hovrätt", contactType: "COURT" }];
});

describe("KrRecipientFields (#1891)", () => {
  it("förvalt: ärendets domstol och målnummer, utan vald kontakt", () => {
    renderTrpc(<Harness court="Stockholms tingsrätt" caseNumber="B 123-26" />);
    expect(screen.getByTestId("kr-court-name")).toHaveTextContent("Stockholms tingsrätt");
    expect(screen.getByLabelText("Målnummer")).toHaveValue("B 123-26");
    expect(current()).toMatchObject({ courtName: "Stockholms tingsrätt", courtCaseNumber: "B 123-26", court: {} });
  });

  it("utan domstol i ärendet: 'Ingen domstol vald' och tomt målnummer", () => {
    renderTrpc(<Harness />);
    expect(screen.getByTestId("kr-court-name")).toHaveTextContent("Ingen domstol vald");
    expect(screen.getByLabelText("Målnummer")).toHaveValue("");
    expect(current().courtCaseNumber).toBeUndefined();
  });

  it("Välj domstol söker bara domstolar och har inget '+ Ny …'", async () => {
    renderTrpc(<Harness court="Stockholms tingsrätt" caseNumber="B 123-26" />);
    openPickerAndSearch("hov");
    expect(screen.getByRole("dialog", { name: "Välj domstol" })).toBeInTheDocument();
    await waitFor(() => expect(searchInputs().at(-1)).toEqual({ term: "hov", contactType: "COURT" }));
    expect(screen.queryByText(/\+ Ny/)).not.toBeInTheDocument();
  });

  it("utan träff: bara 'Ingen träff.', ingen hänvisning till Ny …", async () => {
    hits = [];
    renderTrpc(<Harness court="Stockholms tingsrätt" />);
    openPickerAndSearch("xyz");
    expect(await screen.findByText("Ingen träff.")).toBeInTheDocument();
  });

  it("vald domstol: namnet byts, målnumret töms och kontakten skickas med", async () => {
    renderTrpc(<Harness court="Stockholms tingsrätt" caseNumber="B 123-26" />);
    openPickerAndSearch("hov");
    fireEvent.click(await screen.findByRole("button", { name: /Svea hovrätt/ }));
    expect(screen.queryByRole("dialog", { name: "Välj domstol" })).not.toBeInTheDocument();
    expect(screen.getByTestId("kr-court-name")).toHaveTextContent("Svea hovrätt");
    expect(screen.getByLabelText("Målnummer")).toHaveValue("");
    expect(current()).toMatchObject({ courtName: "Svea hovrätt", court: { courtContactId: "c-hov" } });
    expect(current().courtCaseNumber).toBeUndefined();
  });

  it("målnumret går att ändra; blanksteg runt tas bort och bara blanksteg ger inget", () => {
    renderTrpc(<Harness court="Stockholms tingsrätt" caseNumber="B 123-26" />);
    fireEvent.change(screen.getByLabelText("Målnummer"), { target: { value: " Ö 9-26 " } });
    expect(current().courtCaseNumber).toBe("Ö 9-26");
    fireEvent.change(screen.getByLabelText("Målnummer"), { target: { value: "   " } });
    expect(current().courtCaseNumber).toBeUndefined();
  });

  it("Avbryt i Välj domstol stänger utan att byta", () => {
    renderTrpc(<Harness court="Stockholms tingsrätt" caseNumber="B 123-26" />);
    fireEvent.click(screen.getByRole("button", { name: "Byt domstol…" }));
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog", { name: "Välj domstol" })).not.toBeInTheDocument();
    expect(current().court).toEqual({});
  });
});
