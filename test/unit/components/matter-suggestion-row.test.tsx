/**
 * Tester för `SuggestionRow` (#27 coverage) — raden i ärendets "föreslagna
 * kontakter"-lista. Ren presentations-komponent (inga async/timers/mockar):
 * vi renderar med props och låser fast etikett-uppslag + fallback, knapp-
 * texten vid flera roller, busy-disabling, callbacks och detalj-raderna
 * (pnr/orgnr, e-post/telefon, anteckningar, käll-dokument).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { SuggestionRow, type SuggestionGroup } from "@/components/matter/_suggestion-row";

function makeGroup(overrides: Partial<SuggestionGroup> = {}): SuggestionGroup {
  return {
    key: "g1",
    name: "Anna Andersson",
    contactType: "PERSON",
    roles: ["KLIENT"],
    personalNumber: null,
    orgNumber: null,
    email: null,
    phone: null,
    notes: [],
    documents: [{ title: null, fileName: "stamning.pdf" }],
    suggestionIds: ["s1"],
    ...overrides,
  };
}

describe("SuggestionRow — header", () => {
  it("visar namn + översatt kontakttyp + roll-etikett", () => {
    render(<SuggestionRow group={makeGroup()} isBusy={false} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("Anna Andersson")).toBeInTheDocument();
    expect(screen.getByText("Person")).toBeInTheDocument(); // PERSON → "Person"
    expect(screen.getByText("Klient")).toBeInTheDocument(); // KLIENT → "Klient"
  });

  it("okänd kontakttyp/roll faller tillbaka på råvärdet", () => {
    render(
      <SuggestionRow
        group={makeGroup({ contactType: "ALIEN", roles: ["WIZARD"] })}
        isBusy={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("ALIEN")).toBeInTheDocument();
    expect(screen.getByText("WIZARD")).toBeInTheDocument();
  });
});

describe("SuggestionRow — godkänn-knapp", () => {
  it("en roll → ren 'Godkänn' utan roll-räknare", () => {
    render(<SuggestionRow group={makeGroup({ roles: ["KLIENT"] })} isBusy={false} onAccept={vi.fn()} onReject={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /^Godkänn$/ });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveAttribute("title");
  });

  it("flera roller → '(N roller)' + förklarande title", () => {
    render(
      <SuggestionRow
        group={makeGroup({ roles: ["KLIENT", "MOTPART"] })}
        isBusy={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Godkänn \(2 roller\)/ })).toHaveAttribute(
      "title",
      expect.stringContaining("2 roller"),
    );
  });
});

describe("SuggestionRow — interaktion", () => {
  it("isBusy disablar båda knapparna", () => {
    render(<SuggestionRow group={makeGroup()} isBusy={true} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Godkänn/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Avvisa" })).toBeDisabled();
  });

  it("klick anropar onAccept resp onReject", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<SuggestionRow group={makeGroup()} isBusy={false} onAccept={onAccept} onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: /Godkänn/ }));
    fireEvent.click(screen.getByRole("button", { name: "Avvisa" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});

describe("SuggestionRow — detaljrader", () => {
  it("pnr + orgnr visas med separator", () => {
    render(
      <SuggestionRow
        group={makeGroup({ personalNumber: "19800101-1234", orgNumber: "556000-0001" })}
        isBusy={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText(/Pnr: 19800101-1234/)).toBeInTheDocument();
    expect(screen.getByText(/Orgnr: 556000-0001/)).toBeInTheDocument();
  });

  it("varken pnr eller orgnr → ingen id-rad", () => {
    render(<SuggestionRow group={makeGroup()} isBusy={false} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.queryByText(/Pnr:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Orgnr:/)).not.toBeInTheDocument();
  });

  it("e-post + telefon visas; anteckningar listas", () => {
    render(
      <SuggestionRow
        group={makeGroup({ email: "anna@ex.se", phone: "070-1234567", notes: ["VIP", "Ring förmiddag"] })}
        isBusy={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("anna@ex.se")).toBeInTheDocument();
    expect(screen.getByText("070-1234567")).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText("Ring förmiddag")).toBeInTheDocument();
  });

  it("käll-dokument: title används före fileName, annars fileName", () => {
    render(
      <SuggestionRow
        group={makeGroup({ documents: [{ title: "Stämningsansökan", fileName: "a.pdf" }, { title: null, fileName: "b.pdf" }] })}
        isBusy={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText(/Från: Stämningsansökan, b\.pdf/)).toBeInTheDocument();
  });
});
