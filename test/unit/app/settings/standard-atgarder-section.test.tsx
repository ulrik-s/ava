/**
 * `StandardAtgarderSection` (#956) — admin underhåller byråns standardåtgärder.
 * Listan är byråkonfiguration: den sparas som en ENHET, så en borttagen åtgärd
 * försvinner ur den sparade listan. Avställning finns för åtgärder som redan
 * använts i ärenden — de får inte bara raderas, då tappar historiken sin referens.
 */

import { screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { StandardAtgarderSection } from "@/app/settings/_standard-atgarder-section";
import { columnHeader, rowOrder, sortColumn } from "../../../helpers/data-table";
import { NEW_TRPC_BINDING, renderWithNewTrpc } from "../../../helpers/trpc-classic-mock";

const settingsQuery = {
  data: {
    standardAtgarder: [
      { id: "inledande-atgarder", description: "Inledande åtgärder och genomgång av handlingar", minutes: 30, kind: "ARBETE", stage: "OPENING", paymentMethods: [], billable: true, active: true },
      { id: "gammal", description: "Gammal åtgärd", minutes: 15, kind: "ARBETE", stage: "ANY", paymentMethods: [], billable: true, active: false },
    ],
  } as unknown,
  isLoading: false,
};
const updateMutate = vi.fn();
const invalidateSettings = vi.fn();
/** Mutationens onSuccess, så att testet kan svara som servern (#1907). */
let onUpdateSuccess: (() => void) | undefined;

vi.mock("@/lib/client/trpc", () => ({
  ...NEW_TRPC_BINDING,
  trpc: {
    // DataTable (#1146) läser/sparar vy-inställningar.
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
    useUtils: () => ({ organization: { getSettings: { invalidate: invalidateSettings } } }),
    organization: {
      getSettings: { useQuery: () => settingsQuery },
      updateSettings: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          onUpdateSuccess = opts?.onSuccess;
          return { mutate: updateMutate, isPending: false, error: null };
        },
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StandardAtgarderSection", () => {
  it("listar byråns åtgärder med tid, skede och kategori", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    // Skede-/kategori-etiketterna finns även i lägg-till-formulärets dropdowns,
    // så tabellen frågas ut för sig.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Inledande åtgärder och genomgång av handlingar")).toBeInTheDocument();
    expect(table.getByText("0,5")).toBeInTheDocument(); // decimaltimmar (#1542)
    expect(table.getByRole("columnheader", { name: /Tid \(h\)/ })).toBeInTheDocument();
    expect(table.getByText("Inledande — vid uppdragets början")).toBeInTheDocument();
    // Avställda visas kvar (historiken refererar dem) men märks med Aktivera.
    expect(table.getByText("Gammal åtgärd")).toBeInTheDocument();
    expect(screen.getByLabelText("Aktivera Gammal åtgärd")).toBeInTheDocument();
  });

  it("ny åtgärd får ett läsbart slug-id ur beskrivningen", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Avslutande åtgärder inklusive dom" } });
    fireEvent.change(screen.getByLabelText("Tid (h)"), { target: { value: "0,75" } });
    fireEvent.change(screen.getByLabelText("Skede"), { target: { value: "CLOSING" } });
    fireEvent.click(screen.getByText("Lägg till"));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const saved = updateMutate.mock.calls[0]![0] as { standardAtgarder: Array<Record<string, unknown>> };
    expect(saved.standardAtgarder).toHaveLength(3); // befintliga bevarade
    expect(saved.standardAtgarder[2]).toMatchObject({
      id: "avslutande-atgarder-inklusive-dom", // å/ä/ö → a/a/o, inte bortkastade
      description: "Avslutande åtgärder inklusive dom",
      minutes: 45, stage: "CLOSING", active: true,
    });
  });

  it("id-kollision bryts med löpnummer i stället för att skriva över", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    // "Gammal åtgärd" slug:as till "gammal-atgard"; skriv en beskrivning vars
    // slug blir exakt ett BEFINTLIGT id ("gammal") → kollision.
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Gammal" } });
    fireEvent.click(screen.getByText("Lägg till"));
    const saved = updateMutate.mock.calls[0]![0] as { standardAtgarder: Array<{ id: string }> };
    expect(saved.standardAtgarder.map((a) => a.id)).toEqual(["inledande-atgarder", "gammal", "gammal-2"]);
  });

  it("avställning växlar active utan att röra övriga åtgärder", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    fireEvent.click(screen.getByLabelText("Avställ Inledande åtgärder och genomgång av handlingar"));
    const saved = updateMutate.mock.calls[0]![0] as { standardAtgarder: Array<{ id: string; active: boolean }> };
    expect(saved.standardAtgarder).toEqual([
      expect.objectContaining({ id: "inledande-atgarder", active: false }),
      expect.objectContaining({ id: "gammal", active: false }),
    ]);
  });

  it("borttagning sparar listan UTAN åtgärden (hela listan ersätts)", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    fireEvent.click(screen.getByLabelText("Ta bort Gammal åtgärd"));
    const saved = updateMutate.mock.calls[0]![0] as { standardAtgarder: Array<{ id: string }> };
    expect(saved.standardAtgarder.map((a) => a.id)).toEqual(["inledande-atgarder"]);
  });

  it("tom beskrivning eller 0 minuter går inte att spara", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    const button = screen.getByText("Lägg till");
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "   " } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Åtgärd" } });
    fireEvent.change(screen.getByLabelText("Tid (h)"), { target: { value: "0" } });
    expect(button).toBeDisabled();
  });

  it("en otillåten tid (0,33) visar ett fel och går inte att lägga till (#1545)", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Åtgärd" } });
    fireEvent.change(screen.getByLabelText("Tid (h)"), { target: { value: "0,33" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ändra värdet");
    expect(screen.getByText("Lägg till")).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Beskrivning"), { key: "Enter" });
    expect(updateMutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Tid (h)"), { target: { value: "0,75" } });
    expect(screen.getByText("Lägg till")).toBeEnabled();
  });

  it("kategorin väljs i formuläret och följer med den nya åtgärden (#1907)", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Restid till tingsrätten" } });
    fireEvent.change(screen.getByLabelText("Kategori"), { target: { value: "TIDSSPILLAN" } });
    fireEvent.keyDown(screen.getByLabelText("Beskrivning"), { key: "Enter" });
    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({
      standardAtgarder: [{ id: "inledande-atgarder" }, { id: "gammal" }, { id: "restid-till-tingsratten", kind: "TIDSSPILLAN" }],
    });
  });

  it("sparade åtgärder hämtar om byråns inställningar (#1907)", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    onUpdateSuccess?.();
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
  });

  it("tabellen sorterar på beskrivning, tid, skede och kategori (#1907)", () => {
    renderWithNewTrpc(<StandardAtgarderSection />);
    const inledande = "Inledande åtgärder och genomgång av handlingar";
    const order = (): string[] => rowOrder([inledande, "Gammal åtgärd"]);
    sortColumn("Beskrivning", "asc");
    expect(order()).toEqual(["Gammal åtgärd", inledande]);
    sortColumn("Tid (h)", "desc");
    expect(order()).toEqual([inledande, "Gammal åtgärd"]);
    // Skedet sorterar på etiketten: "Inledande …" före "Löpande …".
    sortColumn("Skede", "desc");
    expect(order()).toEqual(["Gammal åtgärd", inledande]);
    sortColumn("Skede", "asc");
    expect(order()).toEqual([inledande, "Gammal åtgärd"]);
    // Båda är Arbete: kolumnen markeras som sorterad.
    sortColumn("Kategori", "desc");
    expect(columnHeader("Kategori").textContent).toContain("↓");
  });
});
