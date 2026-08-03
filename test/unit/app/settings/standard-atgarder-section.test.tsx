/**
 * `StandardAtgarderSection` (#956) — admin underhåller byråns standardåtgärder.
 * Listan är byråkonfiguration: den sparas som en ENHET, så en borttagen åtgärd
 * försvinner ur den sparade listan. Avställning finns för åtgärder som redan
 * använts i ärenden — de får inte bara raderas, då tappar historiken sin referens.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { StandardAtgarderSection } from "@/app/settings/_standard-atgarder-section";

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

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ organization: { getSettings: { invalidate: vi.fn() } } }),
    organization: {
      getSettings: { useQuery: () => settingsQuery },
      updateSettings: { useMutation: () => ({ mutate: updateMutate, isPending: false, error: null }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StandardAtgarderSection", () => {
  it("listar byråns åtgärder med tid, skede och kategori", () => {
    render(<StandardAtgarderSection />);
    // Skede-/kategori-etiketterna finns även i lägg-till-formulärets dropdowns,
    // så tabellen frågas ut för sig.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Inledande åtgärder och genomgång av handlingar")).toBeInTheDocument();
    expect(table.getByText("0:30")).toBeInTheDocument();
    expect(table.getByText("Inledande — vid uppdragets början")).toBeInTheDocument();
    // Avställda visas kvar (historiken refererar dem) men märks med Aktivera.
    expect(table.getByText("Gammal åtgärd")).toBeInTheDocument();
    expect(screen.getByLabelText("Aktivera Gammal åtgärd")).toBeInTheDocument();
  });

  it("ny åtgärd får ett läsbart slug-id ur beskrivningen", () => {
    render(<StandardAtgarderSection />);
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Avslutande åtgärder inklusive dom" } });
    fireEvent.change(screen.getByLabelText("Minuter"), { target: { value: "45" } });
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
    render(<StandardAtgarderSection />);
    // "Gammal åtgärd" slug:as till "gammal-atgard"; skriv en beskrivning vars
    // slug blir exakt ett BEFINTLIGT id ("gammal") → kollision.
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Gammal" } });
    fireEvent.click(screen.getByText("Lägg till"));
    const saved = updateMutate.mock.calls[0]![0] as { standardAtgarder: Array<{ id: string }> };
    expect(saved.standardAtgarder.map((a) => a.id)).toEqual(["inledande-atgarder", "gammal", "gammal-2"]);
  });

  it("avställning växlar active utan att röra övriga åtgärder", () => {
    render(<StandardAtgarderSection />);
    fireEvent.click(screen.getByLabelText("Avställ Inledande åtgärder och genomgång av handlingar"));
    const saved = updateMutate.mock.calls[0]![0] as { standardAtgarder: Array<{ id: string; active: boolean }> };
    expect(saved.standardAtgarder).toEqual([
      expect.objectContaining({ id: "inledande-atgarder", active: false }),
      expect.objectContaining({ id: "gammal", active: false }),
    ]);
  });

  it("borttagning sparar listan UTAN åtgärden (hela listan ersätts)", () => {
    render(<StandardAtgarderSection />);
    fireEvent.click(screen.getByLabelText("Ta bort Gammal åtgärd"));
    const saved = updateMutate.mock.calls[0]![0] as { standardAtgarder: Array<{ id: string }> };
    expect(saved.standardAtgarder.map((a) => a.id)).toEqual(["inledande-atgarder"]);
  });

  it("tom beskrivning eller 0 minuter går inte att spara", () => {
    render(<StandardAtgarderSection />);
    const button = screen.getByText("Lägg till");
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "   " } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Åtgärd" } });
    fireEvent.change(screen.getByLabelText("Minuter"), { target: { value: "0" } });
    expect(button).toBeDisabled();
  });
});
