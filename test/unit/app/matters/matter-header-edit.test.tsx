/**
 * Komponenttest för `MatterHeaderEdit` (#1565): en enda "Ändra" i
 * ärendehuvudet öppnar en dialog med ärendets uppgifter och hela
 * betalningsdelen, och en enda "Spara" gör ett `matter.update`.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { MatterHeaderEdit, type HeaderEditMatter } from "@/app/matters/[id]/_matter-header-edit";
import type { MatterContactWithRole } from "@/lib/shared/matter-insurance";
import { asId } from "@/lib/shared/schemas/ids";

const updateMutate = vi.fn();
let updateOpts: { onSuccess: () => void } | undefined;
const settings: { data: { matterTypes?: string[]; hourlyRates?: Record<string, number> } | undefined } = { data: undefined };
const utilsMock = {
  matter: { getById: { invalidate: vi.fn() } },
  serviceNote: { list: { invalidate: vi.fn(async () => {}) } },
  watchlist: { list: { invalidate: vi.fn(async () => {}) } },
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    matter: {
      update: {
        useMutation: (o: { onSuccess: () => void }) => { updateOpts = o; return { mutate: updateMutate, isPending: false }; },
      },
    },
    organization: { getSettings: { useQuery: () => settings } },
  },
}));
// Takvarningen och nekat-bannern har egna tester; här räcker att de finns i dialogen.
vi.mock("@/components/matter/coverage-cap-warning", () => ({
  CoverageCapWarning: ({ paymentMethod }: { paymentMethod: string }) => <div data-testid="cap-warning">{paymentMethod}</div>,
}));
vi.mock("@/components/matter/rattsskydd-nekad-banner", () => ({
  RattsskyddNekadBanner: ({ paymentMethod }: { paymentMethod: string }) => <div data-testid="nekad-banner">{paymentMethod}</div>,
}));

const TYPES = ["Bodelning", "Familjerätt"];
const MATTER: HeaderEditMatter = {
  title: "Bodelning A",
  matterType: "Familjerätt",
  description: "En bodelning",
  courtCaseNumber: "T 1-26",
  insuranceReference: "SK-1",
  paymentMethod: "PRIVAT",
};
const CLIENT: MatterContactWithRole = { role: "KLIENT", contact: { contactType: "PERSON" } };
const INSURER: MatterContactWithRole = { role: "FORSAKRINGSBOLAG", contact: { contactType: "INSURANCE_COMPANY" } };

function open(matter: Partial<HeaderEditMatter> = {}, contacts: readonly MatterContactWithRole[] = [CLIENT]): HTMLElement {
  render(<MatterHeaderEdit matterId={asId<"MatterId">("m1")} matter={{ ...MATTER, ...matter }} contacts={contacts} />);
  fireEvent.click(screen.getByRole("button", { name: "Ändra ärende" }));
  return screen.getByRole("dialog", { name: "Ändra ärende" });
}
const save = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
/** Indata till det enda `matter.update`-anropet. */
function sent(): Record<string, unknown> {
  const [call] = updateMutate.mock.calls;
  expect(call).toBeDefined();
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  updateMutate.mockReset();
  settings.data = { matterTypes: TYPES };
  utilsMock.matter.getById.invalidate.mockReset();
});

describe("MatterHeaderEdit", () => {
  it("knappen heter Ändra och dialogen är stängd från början", () => {
    render(<MatterHeaderEdit matterId={asId<"MatterId">("m1")} matter={MATTER} contacts={[]} />);
    expect(screen.getByRole("button", { name: "Ändra ärende" })).toHaveTextContent("Ändra");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dialogen visar alla fält, takvarning och nekat-banner, och en enda Spara", () => {
    const dialog = open({}, [CLIENT, INSURER]);
    const d = within(dialog);
    expect(d.getByLabelText("Titel")).toHaveValue("Bodelning A");
    expect(d.getByLabelText("Ärendetyp")).toHaveValue("Familjerätt");
    expect(d.getByLabelText("Målnummer")).toHaveValue("T 1-26");
    expect(d.getByLabelText("Försäkringsreferens")).toHaveValue("SK-1");
    expect(d.getByLabelText("Beskrivning")).toHaveValue("En bodelning");
    expect(d.getByLabelText("Betalningssätt")).toHaveValue("PRIVAT");
    expect(d.getByTestId("cap-warning")).toBeInTheDocument();
    expect(d.getByTestId("nekad-banner")).toBeInTheDocument();
    expect(d.getAllByRole("button", { name: "Spara" })).toHaveLength(1);
    expect(d.queryByRole("button", { name: /^Ändra/ })).not.toBeInTheDocument();
  });

  it("försäkringsreferensen visas inte utan försäkringsbolag eller när bolaget är motpart", () => {
    const first = open();
    expect(within(first).queryByLabelText("Försäkringsreferens")).not.toBeInTheDocument();
    fireEvent.click(within(first).getByRole("button", { name: "Avbryt" }));
    document.body.innerHTML = "";
    const adverse = open({}, [CLIENT, { ...INSURER, role: "MOTPART" }]);
    expect(within(adverse).queryByLabelText("Försäkringsreferens")).not.toBeInTheDocument();
  });

  it("en ärendetyp som inte finns i byråns lista står på Välj ärendetyp…", () => {
    const dialog = open({ matterType: "Gammal fritext" });
    expect(within(dialog).getByLabelText("Ärendetyp")).toHaveValue("");
    expect(within(dialog).getByRole("option", { name: "Välj ärendetyp…" })).toBeInTheDocument();
  });

  it("byrå utan ärendetyper: ingen meny eller textruta, en hänvisning till Inställningar", () => {
    settings.data = {};
    const dialog = open();
    expect(within(dialog).queryByLabelText("Ärendetyp")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Ärendetyper läggs in under Inställningar/)).toBeInTheDocument();
  });

  it("Spara gör exakt ett matter.update med uppgifterna och betalningsdelen", () => {
    const dialog = open({}, [CLIENT, INSURER]);
    const d = within(dialog);
    fireEvent.change(d.getByLabelText("Titel"), { target: { value: "Ny titel" } });
    fireEvent.change(d.getByLabelText("Ärendetyp"), { target: { value: "Bodelning" } });
    fireEvent.change(d.getByLabelText("Målnummer"), { target: { value: "T 2-26" } });
    fireEvent.change(d.getByLabelText("Försäkringsreferens"), { target: { value: "SK-2" } });
    fireEvent.change(d.getByLabelText("Beskrivning"), { target: { value: "Ny beskrivning" } });
    fireEvent.change(d.getByLabelText("Betalningssätt"), { target: { value: "RATTSSKYDD" } });
    save(dialog);
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(expect.objectContaining({
      id: "m1", title: "Ny titel", matterType: "Bodelning", courtCaseNumber: "T 2-26",
      insuranceReference: "SK-2", description: "Ny beskrivning", paymentMethod: "RATTSSKYDD", hourlyRates: {},
    }));
  });

  it("utan valt förstaval skickas ingen matterType, och dold försäkringsreferens skickas inte", () => {
    const dialog = open({ matterType: "Gammal fritext" });
    save(dialog);
    expect(sent()).not.toHaveProperty("matterType");
    expect(sent()).not.toHaveProperty("insuranceReference");
  });

  it("tomt målnummer och försäkringsreferens sparas som null, tom beskrivning som tom sträng", () => {
    const dialog = open({}, [CLIENT, INSURER]);
    const d = within(dialog);
    fireEvent.change(d.getByLabelText("Målnummer"), { target: { value: "" } });
    fireEvent.change(d.getByLabelText("Försäkringsreferens"), { target: { value: "" } });
    fireEvent.change(d.getByLabelText("Beskrivning"), { target: { value: "" } });
    save(dialog);
    expect(sent()).toEqual(expect.objectContaining({ courtCaseNumber: null, insuranceReference: null, description: "" }));
  });

  it("saknade uppgifter startar som tomma fält", () => {
    const dialog = open({ matterType: null, description: null, paymentMethodNote: undefined });
    expect(within(dialog).getByLabelText("Ärendetyp")).toHaveValue("");
    expect(within(dialog).getByLabelText("Beskrivning")).toHaveValue("");
  });

  it("tom titel spärrar Spara", () => {
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText("Titel"), { target: { value: "  " } });
    expect(within(dialog).getByRole("button", { name: "Spara" })).toBeDisabled();
  });

  it("Avbryt, krysset och Escape stänger utan att spara", () => {
    fireEvent.click(within(open()).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ändra ärende" }));
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ändra ärende" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("lyckad sparning stänger dialogen och hämtar om ärendet och faktureringens sidoeffekter", () => {
    open();
    act(() => updateOpts?.onSuccess());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(utilsMock.matter.getById.invalidate).toHaveBeenCalledWith({ id: "m1" });
    expect(utilsMock.serviceNote.list.invalidate).toHaveBeenCalled();
    expect(utilsMock.watchlist.list.invalidate).toHaveBeenCalled();
  });

  it("öppnas på nytt från ärendets sparade uppgifter, inte från ett avbrutet utkast", () => {
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText("Titel"), { target: { value: "Utkast" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    fireEvent.click(screen.getByRole("button", { name: "Ändra ärende" }));
    expect(screen.getByLabelText("Titel")).toHaveValue("Bodelning A");
  });
});
