/**
 * Komponenttest för `MatterHeaderEdit` (#1565): en enda "Ändra" i
 * ärendehuvudet öppnar en dialog med ärendets uppgifter och hela
 * betalningsdelen, och en enda "Spara" gör ett `matter.update`.
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { MatterHeaderEdit, type HeaderEditMatter } from "@/app/matters/[id]/_matter-header-edit";
import type { MatterContactWithRole } from "@/lib/shared/matter-insurance";
import { asId } from "@/lib/shared/schemas/ids";
import { renderWithFakeTrpc } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths, type FakeTrpcLink, type InvalidateSpy } from "../../../helpers/trpc-fake";

type Settings = { matterTypes?: string[]; publicAssignmentMatterTypes?: string[] | null; hourlyRates?: Record<string, number> };
let settings: Settings = {};
let fake: FakeTrpcLink;
let invalidate: InvalidateSpy;
/** Sant: `matter.update` svarar med ett fel. */
let updateFails = false;

const USERS = [{ id: "u-ulrik", name: "Ulrik Sjölin" }, { id: "u-cecilia", name: "Cecilia Moll" }];
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
  responsibleLawyerId: "u-ulrik",
};
/** En part som anroparen skickar: rollen, och kontakten med sin typ. */
type Party = MatterContactWithRole & { contact: { contactType: string } };
const CLIENT: Party = { role: "KLIENT", contact: { contactType: "PERSON" } };
const INSURER: Party = { role: "FORSAKRINGSBOLAG", contact: { contactType: "INSURANCE_COMPANY" } };

/** Renderar knappen under en fejkad tRPC-länk; inställningar och användare svarar ur testets värden. */
function renderEdit(matter: HeaderEditMatter, contacts: readonly MatterContactWithRole[]): void {
  ({ fake, invalidate } = renderWithFakeTrpc(
    <MatterHeaderEdit matterId={asId<"MatterId">("m1")} matter={matter} contacts={contacts} />,
    {
      "organization.getSettings": () => settings,
      "user.list": () => ({ users: USERS }),
      "matter.update": (input) => {
        if (updateFails) throw new Error("Servern svarar inte");
        return input;
      },
    },
  ));
}

/** Öppnar dialogen och väntar tills användarna och byråns ärendetyper har hämtats. */
async function open(matter: Partial<HeaderEditMatter> = {}, contacts: readonly MatterContactWithRole[] = [CLIENT]): Promise<HTMLElement> {
  renderEdit({ ...MATTER, ...matter }, contacts);
  fireEvent.click(screen.getByRole("button", { name: "Ändra ärende" }));
  const firstType = settings.matterTypes?.[0];
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Cecilia Moll" })).toBeInTheDocument();
    if (firstType) expect(screen.getByRole("option", { name: firstType })).toBeInTheDocument();
  });
  return screen.getByRole("dialog", { name: "Ändra ärende" });
}
const save = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
/** `matter.update`-anropen som nått servern. */
const updates = () => fake.calls.filter((c) => c.path === "matter.update");
/** Indata till det enda `matter.update`-anropet. */
async function sent(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(updates()).toHaveLength(1));
  const input = updates()[0]?.input;
  return typeof input === "object" && input !== null ? { ...input } : {};
}

beforeEach(() => {
  settings = { matterTypes: TYPES };
  updateFails = false;
});

describe("MatterHeaderEdit", () => {
  it("knappen heter Ändra och dialogen är stängd från början", () => {
    renderEdit(MATTER, []);
    expect(screen.getByRole("button", { name: "Ändra ärende" })).toHaveTextContent("Ändra");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dialogen visar alla fält, takvarning och nekat-banner, och en enda Spara", async () => {
    const dialog = await open({}, [CLIENT, INSURER]);
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

  it("försäkringsreferensen visas inte utan försäkringsbolag eller när bolaget är motpart", async () => {
    const first = await open();
    expect(within(first).queryByLabelText("Försäkringsreferens")).not.toBeInTheDocument();
    fireEvent.click(within(first).getByRole("button", { name: "Avbryt" }));
    document.body.innerHTML = "";
    const adverse = await open({}, [CLIENT, { ...INSURER, role: "MOTPART" }]);
    expect(within(adverse).queryByLabelText("Försäkringsreferens")).not.toBeInTheDocument();
  });

  it("rollen Försäkringsbolag avgör, inte kontakttypen: ett företag i rollen ger fältet (#1961)", async () => {
    const dialog = await open({}, [CLIENT, { role: "FORSAKRINGSBOLAG", contact: { contactType: "COMPANY" } }]);
    expect(within(dialog).getByLabelText("Försäkringsreferens")).toHaveValue("SK-1");
  });

  it("en ärendetyp som inte finns i byråns lista står på Välj ärendetyp…", async () => {
    const dialog = await open({ matterType: "Gammal fritext" });
    expect(within(dialog).getByLabelText("Ärendetyp")).toHaveValue("");
    expect(within(dialog).getByRole("option", { name: "Välj ärendetyp…" })).toBeInTheDocument();
  });

  it("byrå utan ärendetyper: ingen meny eller textruta, en hänvisning till Inställningar", async () => {
    settings = {};
    const dialog = await open();
    expect(within(dialog).queryByLabelText("Ärendetyp")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Ärendetyper läggs in under Inställningar/)).toBeInTheDocument();
  });

  it("Spara gör exakt ett matter.update med uppgifterna och betalningsdelen", async () => {
    const dialog = await open({}, [CLIENT, INSURER]);
    const d = within(dialog);
    fireEvent.change(d.getByLabelText("Titel"), { target: { value: "Ny titel" } });
    fireEvent.change(d.getByLabelText("Ärendetyp"), { target: { value: "Bodelning" } });
    fireEvent.change(d.getByLabelText("Målnummer"), { target: { value: "T 2-26" } });
    fireEvent.change(d.getByLabelText("Försäkringsreferens"), { target: { value: "SK-2" } });
    fireEvent.change(d.getByLabelText("Beskrivning"), { target: { value: "Ny beskrivning" } });
    fireEvent.change(d.getByLabelText("Betalningssätt"), { target: { value: "RATTSSKYDD" } });
    save(dialog);
    expect(await sent()).toEqual(expect.objectContaining({
      id: "m1", title: "Ny titel", matterType: "Bodelning", courtCaseNumber: "T 2-26",
      insuranceReference: "SK-2", description: "Ny beskrivning", paymentMethod: "RATTSSKYDD", hourlyRates: {},
    }));
  });

  it("ansvarig advokat/jurist: förvald till ärendets, och ett byte skickas med", async () => {
    const dialog = await open();
    const select = within(dialog).getByLabelText("Ansvarig advokat/jurist");
    expect(select).toHaveValue("u-ulrik");
    fireEvent.change(select, { target: { value: "u-cecilia" } });
    save(dialog);
    expect(await sent()).toEqual(expect.objectContaining({ responsibleLawyerId: "u-cecilia" }));
  });

  it("ärende utan ansvarig: 'Välj ansvarig…' och inget skickas förrän ett val görs", async () => {
    const dialog = await open({ responsibleLawyerId: null });
    expect(within(dialog).getByLabelText("Ansvarig advokat/jurist")).toHaveValue("");
    save(dialog);
    expect(await sent()).not.toHaveProperty("responsibleLawyerId");
  });

  it("utan valt förstaval skickas ingen matterType, och dold försäkringsreferens skickas inte", async () => {
    const dialog = await open({ matterType: "Gammal fritext" });
    save(dialog);
    expect(await sent()).not.toHaveProperty("matterType");
    expect(await sent()).not.toHaveProperty("insuranceReference");
  });

  it("tomt målnummer och försäkringsreferens sparas som null, tom beskrivning som tom sträng", async () => {
    const dialog = await open({}, [CLIENT, INSURER]);
    const d = within(dialog);
    fireEvent.change(d.getByLabelText("Målnummer"), { target: { value: "" } });
    fireEvent.change(d.getByLabelText("Försäkringsreferens"), { target: { value: "" } });
    fireEvent.change(d.getByLabelText("Beskrivning"), { target: { value: "" } });
    save(dialog);
    expect(await sent()).toEqual(expect.objectContaining({ courtCaseNumber: null, insuranceReference: null, description: "" }));
  });

  it("saknade uppgifter startar som tomma fält", async () => {
    const dialog = await open({ matterType: null, description: null, paymentMethodNote: undefined });
    expect(within(dialog).getByLabelText("Ärendetyp")).toHaveValue("");
    expect(within(dialog).getByLabelText("Beskrivning")).toHaveValue("");
  });

  it("tom titel spärrar Spara", async () => {
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText("Titel"), { target: { value: "  " } });
    expect(within(dialog).getByRole("button", { name: "Spara" })).toBeDisabled();
  });

  it("Avbryt, krysset och Escape stänger utan att spara", async () => {
    fireEvent.click(within(await open()).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ändra ärende" }));
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ändra ärende" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updates()).toEqual([]);
  });

  it("lyckad sparning stänger dialogen och hämtar om ärendet och faktureringens sidoeffekter", async () => {
    save(await open());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invalidatedPaths(invalidate)).toEqual(["matter.getById {\"id\":\"m1\"}", "serviceNote.list", "watchlist.list"]);
  });

  it("misslyckad sparning lämnar dialogen öppen och hämtar inget om", async () => {
    updateFails = true;
    const dialog = await open();
    save(dialog);
    await sent();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Spara" })).toBeEnabled());
    expect(screen.getByRole("dialog", { name: "Ändra ärende" })).toBeInTheDocument();
    expect(invalidatedPaths(invalidate)).toEqual([]);
  });

  it("öppnas på nytt från ärendets sparade uppgifter, inte från ett avbrutet utkast", async () => {
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText("Titel"), { target: { value: "Utkast" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    fireEvent.click(screen.getByRole("button", { name: "Ändra ärende" }));
    expect(screen.getByLabelText("Titel")).toHaveValue("Bodelning A");
  });

  describe("offentligt uppdrag (#1639)", () => {
    beforeEach(() => { settings = { matterTypes: TYPES, publicAssignmentMatterTypes: ["Bodelning"] }; });

    it("markerad ärendetyp: betalningssättet visas som Offentligt uppdrag, inaktivt med förklaring", async () => {
      const d = within(await open({ matterType: "Bodelning" }));
      const select = d.getByLabelText("Betalningssätt");
      expect(select).toHaveValue("OFFENTLIGT_UPPDRAG");
      expect(select).toBeDisabled();
      expect(d.getByText("Bestäms av ärendetypen")).toBeInTheDocument();
    });

    it("omarkerad ärendetyp: rullgardinen är aktiv och utan förklaring", async () => {
      const d = within(await open());
      expect(d.getByLabelText("Betalningssätt")).toBeEnabled();
      expect(d.queryByText("Bestäms av ärendetypen")).toBeNull();
    });

    it("byte till markerad typ låser och sparar Offentligt uppdrag; byte bort släpper låset", async () => {
      updateFails = true; // dialogen står kvar efter Spara, så att bytet tillbaka kan prövas
      const dialog = await open();
      const d = within(dialog);
      fireEvent.change(d.getByLabelText("Ärendetyp"), { target: { value: "Bodelning" } });
      expect(d.getByLabelText("Betalningssätt")).toBeDisabled();
      save(dialog);
      expect(await sent()).toEqual(expect.objectContaining({ matterType: "Bodelning", paymentMethod: "OFFENTLIGT_UPPDRAG" }));
      fireEvent.change(d.getByLabelText("Ärendetyp"), { target: { value: "Familjerätt" } });
      expect(d.getByLabelText("Betalningssätt")).toHaveValue("PRIVAT");
      expect(d.getByLabelText("Betalningssätt")).toBeEnabled();
    });
  });
});
