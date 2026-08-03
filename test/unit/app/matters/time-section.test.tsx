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
// Byråns standardåtgärder (#956) — org-inställning, samma lista för alla.
const orgSettingsQuery = {
  data: {
    standardAtgarder: [
      { id: "inledande-atgarder", description: "Inledande åtgärder och genomgång av handlingar", minutes: 30, kind: "ARBETE", stage: "OPENING", paymentMethods: [], billable: true, active: true },
      { id: "avslutande-atgarder", description: "Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman", minutes: 45, kind: "ARBETE", stage: "CLOSING", paymentMethods: [], billable: true, active: true },
      { id: "avstalld", description: "Avställd åtgärd", minutes: 15, kind: "ARBETE", stage: "ANY", paymentMethods: [], billable: true, active: false },
    ],
  } as unknown,
  isLoading: false,
};
// Ärendets billing-runs styr förslagen (#958): KOSTNADSRAKNING med awardedOre =
// dom registrerad; FINAL = slutreglerat (arbetet fryst).
const billingRunQuery = { data: { runs: [] as Array<Record<string, unknown>> }, isLoading: false };
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
    organization: { getSettings: { useQuery: () => orgSettingsQuery } },
    billingRun: { list: { useQuery: () => billingRunQuery } },
  },
}));

const matterId = asId<"MatterId">("m1");

beforeEach(() => {
  vi.clearAllMocks();
  billingRunQuery.data.runs = [];
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

/**
 * Byråns standardåtgärder (#956): en standard ska fylla beskrivning OCH tid, så
 * alla på byrån redovisar samma åtgärd likadant — men båda ska förbli
 * redigerbara, för "som huvudregel" betyder att avsteg måste vara möjligt.
 */
describe("TimeSection — standardåtgärder (#956)", () => {
  it("väljaren listar byråns AKTIVA åtgärder med tiden synlig", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    const select = screen.getByLabelText("Standardåtgärd") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels[0]).toBe("— egen beskrivning —"); // fritext är default
    // Tiden formateras med appens `formatMinutes` (0:30), samma som i tidslistan.
    expect(labels).toContain("Inledande åtgärder och genomgång av handlingar (0:30)");
    expect(labels).toContain("Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman (0:45)");
    // Avställda åtgärder föreslås inte.
    expect(labels.some((l) => l?.includes("Avställd"))).toBe(false);
  });

  it("val av åtgärd fyller beskrivning + tid och skickar standardAtgardId", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByLabelText("Standardåtgärd"), { target: { value: "avslutande-atgarder" } });

    expect(screen.getByPlaceholderText("Beskrivning *")).toHaveValue("Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman");
    expect(screen.getByLabelText("Tid (minuter) *")).toHaveValue("45");

    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({
      matterId, standardAtgardId: "avslutande-atgarder", minutes: 45,
      description: "Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman",
    }));
  });

  it("tiden är en HUVUDREGEL — den går att justera efter att åtgärden valts", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByLabelText("Standardåtgärd"), { target: { value: "inledande-atgarder" } });
    fireEvent.change(screen.getByLabelText("Tid (minuter) *"), { target: { value: "75" } });

    fireEvent.click(screen.getByText("Spara"));
    // Kopplingen behålls så byrån kan se att tiden avvikit från huvudregeln.
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({
      standardAtgardId: "inledande-atgarder", minutes: 75,
    }));
  });

  it("tillbaka till fritext nollar kopplingen men behåller texten", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    const select = screen.getByLabelText("Standardåtgärd");
    fireEvent.change(select, { target: { value: "inledande-atgarder" } });
    fireEvent.change(select, { target: { value: "" } });

    expect(screen.getByPlaceholderText("Beskrivning *")).toHaveValue("Inledande åtgärder och genomgång av handlingar");
    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ standardAtgardId: "" }));
  });
});

/**
 * Förslagsraden (#958): påminn om standardåtgärderna vid rätt tidpunkt, och
 * FÖRIFYLL formuläret i stället för att spara. Datumet måste vara handläggarens
 * val — det styr vilken årsnorm posten värderas på (#951/#954).
 */
describe("TimeSection — förslag om standardåtgärder (#958)", () => {
  it("pågående ärende med registrerat arbete → ingen förslagsrad", () => {
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" matterStatus="ACTIVE" />);
    expect(screen.queryByText(/standardåtgärder.*som inte är registrerade/i)).not.toBeInTheDocument();
  });

  it("registrerad dom → avslutande åtgärd föreslås med sin tid", () => {
    billingRunQuery.data.runs = [{ type: "KOSTNADSRAKNING", awardedOre: 500_000 }];
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" matterStatus="ACTIVE" />);
    expect(screen.getByText(/som inte är registrerade/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Avslutande åtgärder inklusive mottagande av dom/ })).toBeInTheDocument();
  });

  it("klicket FÖRIFYLLER formuläret — inget sparas", () => {
    billingRunQuery.data.runs = [{ type: "KOSTNADSRAKNING", awardedOre: 500_000 }];
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" matterStatus="ACTIVE" />);
    fireEvent.click(screen.getByRole("button", { name: /Avslutande åtgärder inklusive mottagande av dom/ }));

    // Formuläret öppnas ifyllt med byråns huvudregel …
    expect(screen.getByPlaceholderText("Beskrivning *")).toHaveValue("Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman");
    expect(screen.getByLabelText("Tid (minuter) *")).toHaveValue("45");
    expect(screen.getByLabelText("Standardåtgärd")).toHaveValue("avslutande-atgarder");
    // … men INGET är sparat förrän användaren godkänner.
    expect(createMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({
      standardAtgardId: "avslutande-atgarder", minutes: 45,
    }));
  });

  it("redan registrerad åtgärd föreslås inte igen — härleds ur ärendets tidsposter", () => {
    billingRunQuery.data.runs = [{ type: "KOSTNADSRAKNING", awardedOre: 500_000 }];
    const entries = (timeQuery.data as { entries: Array<Record<string, unknown>> }).entries;
    entries.push({
      id: "t4", date: "2026-07-01", minutes: 45, description: "Avslutande åtgärder …",
      billable: true, user: { name: "Anna" }, hourlyRate: 162_600, standardAtgardId: "avslutande-atgarder",
    });
    try {
      render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" matterStatus="ACTIVE" />);
      expect(screen.queryByText(/som inte är registrerade/i)).not.toBeInTheDocument();
    } finally {
      entries.pop();
    }
  });

  it("slutreglerat ärende → inga förslag (arbetet är fryst)", () => {
    billingRunQuery.data.runs = [
      { type: "KOSTNADSRAKNING", awardedOre: 500_000 },
      { type: "FINAL", awardedOre: null },
    ];
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" matterStatus="CLOSED" />);
    expect(screen.queryByText(/som inte är registrerade/i)).not.toBeInTheDocument();
  });
});
