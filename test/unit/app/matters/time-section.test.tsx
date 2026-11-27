/**
 * `TimeSection` — tidsredovisningen i ett ärende. Fokus här är ARVODESKATEGORIN
 * (#953): den avgör vilken av Domstolsverkets årsnormer posten ersätts på vid
 * slutregleringen, så den måste både gå att VÄLJA och SYNAS. Utan väljaren kunde
 * en advokat inte registrera tidsspillan eller obekväm tid alls.
 */

import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest-compat";
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
const moveMutate = vi.fn();
/** Felhanterarna som flyttarna registrerat (#2043). */
const moveOnError: Array<(e: { message: string }) => void> = [];
const listInvalidate = vi.fn();
const usageInvalidate = vi.fn();
/** Fakturaförslaget (#2201). */
const proposalInvalidate = vi.fn();
/** onSuccess som skapa och ta bort registrerat (#2201). */
const mutationOnSuccess: Record<"create" | "delete", (() => void) | undefined> = { create: undefined, delete: undefined };
const MATTERS = [
  { id: "m1", matterNumber: "2026-0001", title: "Vårdnad" },
  { id: "m2", matterNumber: "2026-0002", title: "Arvskifte" },
];
// Rådgivningspostens status (#1207): `missing` = legacy-ärende utan låst post.
const radgivningStatusQuery: { data: unknown } = { data: undefined };
const markMutate = vi.fn();
const noopMut = () => ({ mutate: vi.fn(), isPending: false });

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      timeEntry: { list: { invalidate: listInvalidate } },
      matter: { coverageUsage: { invalidate: usageInvalidate } },
      billingRun: { proposal: { invalidate: proposalInvalidate } },
    }),
    // Takvarningen i tidssektionen (#1520) — under taket här.
    matter: {
      coverageUsage: { useQuery: () => ({ data: { billableMinutes: 0, billableValueOre: 0 } }) },
      // Ärendena posten kan flyttas till (#2042).
      list: { useQuery: () => ({ data: { matters: MATTERS } }) },
    },
    timeEntry: {
      list: { useQuery: () => timeQuery },
      create: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          mutationOnSuccess.create = opts?.onSuccess;
          return { mutate: createMutate, isPending: false };
        },
      },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
      moveToMatter: {
        useMutation: (opts?: { onError?: (e: { message: string }) => void }) => {
          if (opts?.onError) moveOnError.push(opts.onError);
          return { mutate: moveMutate, isPending: false };
        },
      },
      delete: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          mutationOnSuccess.delete = opts?.onSuccess;
          return { mutate: vi.fn(), isPending: false };
        },
      },
      radgivningStatus: { useQuery: () => radgivningStatusQuery },
      markAsRadgivning: { useMutation: () => ({ mutate: markMutate, isPending: false }) },
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

/** Det n:te elementet med texten — felar tydligt om det saknas. */
function nthText(text: string, n: number): HTMLElement {
  const el = screen.getAllByText(text)[n];
  if (!el) throw new Error(`saknar ${text} nr ${n}`);
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  billingRunQuery.data.runs = [];
  radgivningStatusQuery.data = undefined;
});

describe("TimeSection — arvodeskategori (#953)", () => {
  it("visar kategorin per rad — inte bara för arbete", () => {
    render(<TimeSection matterId={matterId} />);
    expect(screen.getByText("Kategori")).toBeInTheDocument();
    expect(screen.getByText("Tidsspillan")).toBeInTheDocument();
    expect(screen.getByText("Timarvode helg/kväll")).toBeInTheDocument();
    // Poster utan kind visas som Timarvode (default), inte som tomt.
    expect(screen.getByText("Timarvode")).toBeInTheDocument();
  });

  it("beskrivningen bryter rad i stället för att rinna in i grannkolumnen (#1197)", () => {
    render(<TimeSection matterId={matterId} />);
    expect(screen.getByText("Genomgång av handlingar").closest("td")).toHaveClass("whitespace-normal");
  });

  it("datum och beskrivning är toppjusterade, så att de står i höjd med varandra (#1752)", () => {
    render(<TimeSection matterId={matterId} />);
    expect(screen.getByText("Genomgång av handlingar").closest("td")).toHaveClass("align-top");
    expect(screen.getByText(new Date("2026-03-01").toLocaleDateString("sv-SE")).closest("td")).toHaveClass("align-top");
  });

  it("formuläret erbjuder alla arvodeskategorier och skickar den valda", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    const select = screen.getByLabelText("Arvodeskategori *");
    expect(select).toHaveValue("ARBETE"); // default
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual([
      "ARBETE", "ARBETE_OBEKVAM_TID", "TIDSSPILLAN", "TIDSSPILLAN_OVRIG_TID", "ADVOKATBEREDSKAP", "FORHANDLING", "FORHOR",
    ]);

    fireEvent.change(select, { target: { value: "TIDSSPILLAN_OVRIG_TID" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Hemresa efter kvällssammanträde" } });
    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({
      matterId, kind: "TIDSSPILLAN_OVRIG_TID", description: "Hemresa efter kvällssammanträde",
    }));
  });

  /**
   * Advokatberedskap ersätts per dygn (#950): det finns ingen tid att mata in,
   * och minuterna måste nollas när kategorin väljs — annars följer förra
   * postens halvtimme med in i varje timbaserad summa.
   */
  it("beredskap byter ut minutfältet mot ett dygn och skickar noll minuter", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.getByLabelText("Tid (h) *")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "ADVOKATBEREDSKAP" } });
    expect(screen.queryByLabelText("Tid (h) *")).not.toBeInTheDocument();
    expect(screen.getByText("1 dygns beredskap")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Helgjour tingsrätten" } });
    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({
      matterId, kind: "ADVOKATBEREDSKAP", minutes: 0,
    }));
  });

  it("kategorin är rättbar i efterhand — ändra-formuläret förifylls och skickar kind", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(nthText("Ändra", 1)); // raden med TIDSSPILLAN
    expect(screen.getByLabelText("Arvodeskategori *")).toHaveValue("TIDSSPILLAN");
    fireEvent.click(screen.getByText("Spara"));
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ id: "t2", kind: "TIDSSPILLAN" }), expect.anything());
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
 * Föreskriftens tillämpningsregler vid kategorivalet (#969). AVA kan inte AVGÖRA
 * om en post faller inom 07–22 eller om pausen var en måltidspaus — bara juristen
 * vet det. Därför visas regeln VID valet; testet vaktar att den syns för rätt
 * kategori, inte att någon kontroll körs.
 */
describe("TimeSection — DVFS-hjälptext vid kategorivalet (#969)", () => {
  function openForm(paymentMethod: "PRIVAT" | "RATTSHJALP"): void {
    render(<TimeSection matterId={matterId} paymentMethod={paymentMethod} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
  }

  it("Arbete har ingen tillämpningsregel att visa", () => {
    openForm("RATTSHJALP");
    expect(screen.queryByText(/07\.00/)).not.toBeInTheDocument();
  });

  it("Tidsspillan visar 07–22-fönstret och måltidspausen", () => {
    openForm("RATTSHJALP");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "TIDSSPILLAN" } });
    const text = screen.getByText(/måltidspaus/);
    expect(text).toHaveTextContent("mellan 07.00 och 22.00");
    expect(text).toHaveTextContent("DVFS 2025:4 §§ 2–4");
  });

  it("Tidsspillan helg/kväll visar övernattningsregeln — den gäller just 18–22", () => {
    openForm("RATTSHJALP");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "TIDSSPILLAN_OVRIG_TID" } });
    const text = screen.getByText(/övernattning/);
    expect(text).toHaveTextContent("18.00–22.00 endast om den avser restid");
    // Natten är inte "lägre taxa" utan INGEN ersättning — lätt att tro fel.
    expect(text).toHaveTextContent("22.00 och 07.00 ersätts inte alls");
  });

  it("Timarvode helg/kväll anger föreskrifternas tider och att tidsspillan då registreras som Tidsspillan", () => {
    openForm("RATTSHJALP");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "ARBETE_OBEKVAM_TID" } });
    const text = screen.getByText(/^Häktningsförhandling/);
    expect(text).toHaveTextContent("polisförhör vardagar 00.00–07.00 och 18.00–24.00 samt helg (DVFS 2025:8 § 1)");
    expect(text).toHaveTextContent("registreras som Tidsspillan (vardagstaxan)");
  });

  it("Tidsspillan helg/kväll pekar ut undantaget: helghäktning/nattförhör registreras som Tidsspillan", () => {
    openForm("RATTSHJALP");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "TIDSSPILLAN_OVRIG_TID" } });
    expect(screen.getByText(/övernattning/)).toHaveTextContent("DVFS 2025:7 § 1, 2025:8 § 3");
  });

  it("privatärenden får ingen hjälptext — normerna styr inte deras arvode", () => {
    openForm("PRIVAT");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "TIDSSPILLAN" } });
    expect(screen.queryByText(/måltidspaus/)).not.toBeInTheDocument();
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
    const select = screen.getByLabelText<HTMLSelectElement>("Standardåtgärd");
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels[0]).toBe("— egen beskrivning —"); // fritext är default
    // Tiden visas i decimaltimmar (#1542), samma formatterare som i tidslistan.
    expect(labels).toContain("Inledande åtgärder och genomgång av handlingar (0,5 h)");
    expect(labels).toContain("Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman (0,75 h)");
    // Avställda åtgärder föreslås inte.
    expect(labels.some((l) => l?.includes("Avställd"))).toBe(false);
  });

  it("val av åtgärd fyller beskrivning + tid och skickar standardAtgardId", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByLabelText("Standardåtgärd"), { target: { value: "avslutande-atgarder" } });

    expect(screen.getByPlaceholderText("Beskrivning *")).toHaveValue("Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman");
    expect(screen.getByLabelText("Tid (h) *")).toHaveValue("0,75");

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
    fireEvent.change(screen.getByLabelText("Tid (h) *"), { target: { value: "1,25" } });

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
    expect(screen.getByLabelText("Tid (h) *")).toHaveValue("0,75");
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

describe("TimeSection — Markera som rådgivning (#1207)", () => {
  const MARK = "Markera som rådgivning";

  it("visas på olåsta debiterbara rader när ärendet saknar låst rådgivningspost", () => {
    radgivningStatusQuery.data = { kind: "missing", invoiceId: "inv-r" };
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" />);
    expect(screen.getAllByText(MARK)).toHaveLength(3);
  });

  it("visas inte när ärendet redan har en rådgivningspost", () => {
    radgivningStatusQuery.data = { kind: "present", invoiceId: "inv-r" };
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" />);
    expect(screen.queryByText(MARK)).toBeNull();
  });

  it("visas inte utan status (t.ex. inte rättshjälp)", () => {
    render(<TimeSection matterId={matterId} paymentMethod="PRIVAT" />);
    expect(screen.queryByText(MARK)).toBeNull();
  });

  it("prod-formen (#1235): ej debiterbart möte fryst av KR visar åtgärden bredvid Låst; debiterbar fryst tid gör det inte", () => {
    const original = timeQuery.data;
    timeQuery.data = {
      entries: [
        { id: "mote", date: "2026-03-01", minutes: 60, description: "Möte med huvudman", billable: false, user: { name: "Anna" }, hourlyRate: 162_600, frozenAt: "2026-05-01", frozenByBillingRunId: "run-kr" },
        { id: "arbete", date: "2026-03-02", minutes: 90, description: "Genomgång", billable: true, user: { name: "Anna" }, hourlyRate: 162_600, frozenAt: "2026-05-01", frozenByBillingRunId: "run-kr" },
      ],
      totalMinutes: 150,
    };
    radgivningStatusQuery.data = { kind: "missing", invoiceId: "inv-r" };
    vi.spyOn(globalThis, "confirm").mockReturnValueOnce(true);
    try {
      render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" />);
      expect(screen.getAllByText(MARK)).toHaveLength(1);
      expect(screen.getAllByText("🔒 Låst")).toHaveLength(2);
      fireEvent.click(screen.getByText(MARK));
      expect(markMutate).toHaveBeenCalledWith({ id: "mote" });
    } finally {
      timeQuery.data = original;
    }
  });

  it("bekräftar först — avbryt markerar inte, bekräfta markerar raden", () => {
    radgivningStatusQuery.data = { kind: "missing", invoiceId: "inv-r" };
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" />);
    fireEvent.click(nthText(MARK, 0));
    expect(markMutate).not.toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0]?.[0]).toContain("delas");
    fireEvent.click(nthText(MARK, 0));
    expect(markMutate).toHaveBeenCalledTimes(1);
    expect(markMutate.mock.calls[0]?.[0]).toEqual({ id: expect.stringMatching(/^t[123]$/) });
    confirmSpy.mockRestore();
  });
});

describe("TimeSection — tid i timmar med decimal (#1545)", () => {
  const openCreate = (): HTMLElement => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Telefonsamtal" } });
    return screen.getByLabelText("Tid (h) *");
  };

  it("ny post har 0,5 timmar som standard", () => {
    expect(openCreate()).toHaveValue("0,5");
  });

  it.each(["1,5", "1.5"])("%s sparas som 90 minuter", (value) => {
    fireEvent.change(openCreate(), { target: { value } });
    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ matterId, minutes: 90 }));
  });

  it("1,33 ger ett felmeddelande och sparas inte", () => {
    const input = openCreate();
    fireEvent.change(input, { target: { value: "1,33" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ändra värdet");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByText("Spara"));
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("en befintlig post visas i timmar när den ändras", () => {
    render(<TimeSection matterId={matterId} />);
    const [, second] = screen.getAllByText("Ändra"); // raden med 90 minuter
    if (second) fireEvent.click(second);
    expect(screen.getByLabelText("Tid (h) *")).toHaveValue("1,5");
  });
});

/**
 * Förhör (#1855): en tidspost med starttid och längd. Klockslaget behövs för
 * förordnandetaxans 3 §, så formuläret tar det för den här kategorin och läser
 * tillbaka det när posten ändras.
 */
/** Första radens Ändra-knapp. */
function firstEdit(): HTMLElement {
  const [button] = screen.getAllByText("Ändra");
  if (!button) throw new Error("ingen rad att ändra");
  return button;
}

describe("TimeSection — förhör med starttid (#1855)", () => {
  it("Förhör visar Starttid och hjälptexten, också utanför rättshjälp och rättsskydd", () => {
    render(<TimeSection matterId={matterId} paymentMethod="OFFENTLIGT_UPPDRAG" />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.queryByLabelText("Starttid *")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "FORHOR" } });
    expect(screen.getByLabelText("Starttid *")).toBeRequired();
    expect(screen.getByText(/Ett uppehåll på 15 minuter eller mer/)).toHaveTextContent("registrera förhöret som två poster");
    expect(screen.queryByText(/slutregleringsårets normer/)).not.toBeInTheDocument();
  });

  it("ett nytt förhör sparas med starttiden i svensk tid", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "FORHOR" } });
    fireEvent.change(screen.getByLabelText("Datum *"), { target: { value: "2026-03-02" } });
    fireEvent.change(screen.getByLabelText("Starttid *"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Förhör med klienten" } });
    fireEvent.click(screen.getByText("Spara"));
    const sent = createMutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ matterId, kind: "FORHOR", date: "2026-03-02T08:30:00.000Z" });
    expect(sent).not.toHaveProperty("startTime");
  });

  it("att ändra ett förhör behåller klockslaget", () => {
    const original = timeQuery.data;
    const forhor = { id: "t4", date: "2026-03-09T08:15:00.000Z", minutes: 45, description: "Förhör hos polisen", billable: true, user: { name: "Anna" }, hourlyRate: 162_600, kind: "FORHOR" };
    timeQuery.data = { entries: [forhor], totalMinutes: 45 };
    try {
      render(<TimeSection matterId={matterId} />);
      fireEvent.click(firstEdit());
      expect(screen.getByLabelText("Starttid *")).toHaveValue("09:15");
      fireEvent.click(screen.getByText("Spara"));
      expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ id: "t4", kind: "FORHOR", date: "2026-03-09T08:15:00.000Z" }), expect.anything());
    } finally {
      timeQuery.data = original;
    }
  });

  it("andra kategorier skickar bara dagen", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(firstEdit());
    fireEvent.click(screen.getByText("Spara"));
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", date: "2026-03-01" }), expect.anything());
  });
});

describe("TimeSection — flytta posten till ett annat ärende (#2042)", () => {
  type CallOpts = { onSuccess?: () => void } | undefined;
  /** Kör anropets egen onSuccess, som när servern svarat. */
  function succeed(mutate: ReturnType<typeof vi.fn>): void {
    const callOpts = mutate.mock.calls.at(-1)?.[1] as CallOpts;
    callOpts?.onSuccess?.();
  }

  it("fältet Ärende finns i Ändra tidregistrering, förvalt postens ärende", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(nthText("Ändra", 0));
    expect(screen.getByLabelText("Ärende")).toHaveValue("2026-0001 — Vårdnad");
  });

  it("Registrera tid har inget ärendefält — posten hör till ärendet", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.queryByLabelText("Ärende")).not.toBeInTheDocument();
  });

  it("samma ärende: bara update, och dialogen stängs", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.click(screen.getByText("Spara"));
    act(() => succeed(updateMutate));
    expect(moveMutate).not.toHaveBeenCalled();
    expect(listInvalidate).toHaveBeenCalledWith({ matterId });
    expect(screen.queryByRole("dialog", { name: "Ändra tidregistrering" })).not.toBeInTheDocument();
  });

  it("ett annat ärende: update, sedan moveToMatter med postens id, och båda ärendena läses om", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.change(screen.getByLabelText("Ärende"), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(screen.getByText("Spara"));
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), expect.anything());
    expect(moveMutate).not.toHaveBeenCalled();
    act(() => succeed(updateMutate));
    expect(moveMutate).toHaveBeenCalledWith({ ids: ["t1"], matterId: "m2" }, expect.anything());
    expect(screen.getByRole("dialog", { name: "Ändra tidregistrering" })).toBeInTheDocument();
    act(() => succeed(moveMutate));
    for (const id of ["m1", "m2"]) {
      expect(listInvalidate).toHaveBeenCalledWith({ matterId: id });
      expect(usageInvalidate).toHaveBeenCalledWith({ matterId: id });
    }
    expect(screen.queryByRole("dialog", { name: "Ändra tidregistrering" })).not.toBeInTheDocument();
  });

  it("ett rensat ärendefält flyttar inte", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.change(screen.getByLabelText("Ärende"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Spara"));
    act(() => succeed(updateMutate));
    expect(moveMutate).not.toHaveBeenCalled();
  });
});

describe("TimeSection — markera flera poster och flytta dem (#2043)", () => {
  type CallOpts = { onSuccess?: () => void } | undefined;
  const rowOf = (text: string) => within(screen.getByText(text).closest("tr") as HTMLElement);
  const original = timeQuery.data;
  afterEach(() => { timeQuery.data = original; });

  it("en låst post går inte att markera", () => {
    timeQuery.data = { entries: [
      { id: "t1", date: "2026-03-01", minutes: 60, description: "Öppen post", billable: true },
      { id: "t2", date: "2026-03-02", minutes: 60, description: "Fryst post", billable: true, frozenAt: "2026-04-01" },
    ], totalMinutes: 120 };
    render(<TimeSection matterId={matterId} />);
    expect(rowOf("Öppen post").getByRole("checkbox", { name: "Markera rad" })).toBeInTheDocument();
    expect(rowOf("Fryst post").queryByRole("checkbox")).toBeNull();
  });

  it("knappen visar antalet, och det nuvarande ärendet är inte valbart", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(rowOf("Genomgång av handlingar").getByRole("checkbox", { name: "Markera rad" }));
    fireEvent.click(rowOf("Restid till sammanträde").getByRole("checkbox", { name: "Markera rad" }));
    fireEvent.click(screen.getByRole("button", { name: "Flytta till ärende… (2)" }));
    const dialog = screen.getByRole("dialog", { name: "Flytta till ärende" });
    const values = Array.from(dialog.querySelectorAll("datalist option")).map((o) => o.getAttribute("value"));
    expect(values).toEqual(["2026-0002 — Arvskifte"]);
  });

  it("efter Flytta läses båda ärendena om och markeringen töms", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Markera alla" }));
    fireEvent.click(screen.getByRole("button", { name: "Flytta till ärende… (3)" }));
    const dialog = screen.getByRole("dialog", { name: "Flytta till ärende" });
    fireEvent.change(within(dialog).getByLabelText("3 tidsposter flyttas till:"), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Flytta" }));
    expect(moveMutate).toHaveBeenCalledWith({ ids: ["t1", "t2", "t3"], matterId: "m2" }, expect.anything());
    act(() => (moveMutate.mock.calls.at(-1)?.[1] as CallOpts)?.onSuccess?.());
    expect(listInvalidate).toHaveBeenCalledWith({ matterId: "m1" });
    expect(listInvalidate).toHaveBeenCalledWith({ matterId: "m2" });
    expect(usageInvalidate).toHaveBeenCalledWith({ matterId: "m2" });
    expect(screen.queryByRole("button", { name: /Flytta till ärende/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Markera rad", checked: true })).toBeNull();
  });

  it("ett misslyckat anrop loggas, aldrig tyst", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<TimeSection matterId={matterId} />);
    for (const onError of moveOnError) onError({ message: "låst" });
    expect(log).toHaveBeenCalledWith("[timeEntry.moveToMatter] misslyckades:", { message: "låst" });
    log.mockRestore();
  });
});

describe("TimeSection — fakturaförslaget hämtas om (#2201)", () => {
  type CallOpts = { onSuccess?: () => void } | undefined;
  const succeedLast = (mutate: ReturnType<typeof vi.fn>): void => (mutate.mock.calls.at(-1)?.[1] as CallOpts)?.onSuccess?.();

  it("att skapa tid hämtar om ärendets förslag", () => {
    render(<TimeSection matterId={matterId} />);
    expect(proposalInvalidate).not.toHaveBeenCalled();
    act(() => mutationOnSuccess.create?.());
    expect(proposalInvalidate).toHaveBeenCalledWith({ matterId });
  });

  it("att ta bort tid hämtar om ärendets förslag", () => {
    render(<TimeSection matterId={matterId} />);
    act(() => mutationOnSuccess.delete?.());
    expect(proposalInvalidate).toHaveBeenCalledWith({ matterId });
  });

  it("att ändra tid hämtar om förslaget först när ändringen lyckats", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.click(screen.getByText("Spara"));
    expect(proposalInvalidate).not.toHaveBeenCalled();
    act(() => succeedLast(updateMutate));
    expect(proposalInvalidate).toHaveBeenCalledWith({ matterId });
  });

  it("en flytt hämtar om båda ärendenas förslag", () => {
    render(<TimeSection matterId={matterId} />);
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.change(screen.getByLabelText("Ärende"), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(screen.getByText("Spara"));
    act(() => succeedLast(updateMutate));
    act(() => succeedLast(moveMutate));
    expect(proposalInvalidate).toHaveBeenCalledWith({ matterId: "m1" });
    expect(proposalInvalidate).toHaveBeenCalledWith({ matterId: "m2" });
  });
});
