/**
 * `TimeSection` — tidsredovisningen i ett ärende. Fokus här är ARVODESKATEGORIN
 * (#953): den avgör vilken av Domstolsverkets årsnormer posten ersätts på vid
 * slutregleringen, så den måste både gå att VÄLJA och SYNAS. Utan väljaren kunde
 * en advokat inte registrera tidsspillan eller obekväm tid alls.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { TimeSection } from "@/app/matters/[id]/_time-section";
import { asId } from "@/lib/shared/schemas/ids";

const timeQuery = {
  data: {
    entries: [
      { id: "t1", date: "2026-03-01", minutes: 120, description: "Genomgång av handlingar", billable: true, user: { name: "Anna" }, hourlyRate: 162_600 },
      { id: "t2", date: "2026-03-02", minutes: 90, description: "Restid till sammanträde", billable: true, user: { name: "Anna" }, hourlyRate: 148_700, kind: "TIDSSPILLAN" },
      { id: "t3", date: "2026-03-07", minutes: 60, description: "Jourärende under helg", billable: true, user: { name: "Anna" }, hourlyRate: 325_600, kind: "ARBETE_OBEKVAM_TID" },
    ],
    totalMinutes: 270,
  } as unknown,
  isLoading: false,
};
const createMutate = vi.fn();
const updateMutate = vi.fn();
const noopMut = () => ({ mutate: vi.fn(), isPending: false });

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ timeEntry: { list: { invalidate: vi.fn() } } }),
    timeEntry: {
      list: { useQuery: () => timeQuery },
      create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
      delete: { useMutation: noopMut },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: noopMut },
      clear: { useMutation: noopMut },
      setOrgDefault: { useMutation: noopMut },
      clearOrgDefault: { useMutation: noopMut },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
  },
}));

const matterId = asId<"MatterId">("m1");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TimeSection — arvodeskategori (#953)", () => {
  it("visar kategorin per rad — inte bara för arbete", () => {
    render(<TimeSection matterId={matterId} />);
    expect(screen.getByText("Kategori")).toBeInTheDocument();
    expect(screen.getByText("Tidsspillan")).toBeInTheDocument();
    expect(screen.getByText("Obekväm tid")).toBeInTheDocument();
    // Poster utan kind visas som Arbete (default), inte som tomt.
    expect(screen.getByText("Arbete")).toBeInTheDocument();
  });

  it("formuläret erbjuder alla fyra kategorierna och skickar den valda", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    const select = screen.getByLabelText("Arvodeskategori *");
    expect(select).toHaveValue("ARBETE"); // default
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual(["ARBETE", "ARBETE_OBEKVAM_TID", "TIDSSPILLAN", "TIDSSPILLAN_OVRIG_TID"]);

    fireEvent.change(select, { target: { value: "TIDSSPILLAN_OVRIG_TID" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Hemresa efter kvällssammanträde" } });
    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({
      matterId, kind: "TIDSSPILLAN_OVRIG_TID", description: "Hemresa efter kvällssammanträde",
    }));
  });

  it("kategorin är rättbar i efterhand — ändra-formuläret förifylls och skickar kind", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getAllByText("Ändra")[1]!); // raden med TIDSSPILLAN
    expect(screen.getByLabelText("Arvodeskategori *")).toHaveValue("TIDSSPILLAN");
    fireEvent.click(screen.getByText("Spara"));
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ id: "t2", kind: "TIDSSPILLAN" }));
  });

  it("normhjälptexten visas bara för täckningsärenden (rättshjälp/rättsskydd)", () => {
    const { unmount } = render(<TimeSection matterId={matterId} paymentMethod="PRIVAT" />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.queryByText(/slutregleringsårets normer/)).not.toBeInTheDocument();
    unmount();

    render(<TimeSection matterId={matterId} paymentMethod="RATTSSKYDD" />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.getByText(/slutregleringsårets normer/)).toBeInTheDocument();
  });
});
