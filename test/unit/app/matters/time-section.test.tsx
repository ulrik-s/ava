/**
 * `TimeSection` — tidsredovisningen i ett ärende. Fokus här är ARVODESKATEGORIN
 * (#953): den avgör vilken av Domstolsverkets årsnormer posten ersätts på vid
 * slutregleringen, så den måste både gå att VÄLJA och SYNAS. Utan väljaren kunde
 * en advokat inte registrera tidsspillan eller obekväm tid alls.
 */

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest-compat";
import { callsTo, settled, type FakeTrpcRender } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths } from "../../../helpers/trpc-fake";
import { forMatter, renderTimeSection, TIME_MATTER_ID as matterId } from "./time-section-fixture";

type TimeData = { entries: Array<Record<string, unknown>>; totalMinutes: number };
/** Ärendets tre poster: arbete, tidsspillan och helgarbete. */
const DEFAULT_TIME: TimeData = {
  entries: [
    { id: "t1", date: "2026-03-01", minutes: 120, description: "Genomgång av handlingar", billable: true, user: { name: "Anna" }, hourlyRate: 162_600 },
    { id: "t2", date: "2026-03-02", minutes: 90, description: "Restid till sammanträde", billable: true, user: { name: "Anna" }, hourlyRate: 148_700, kind: "TIDSSPILLAN" },
    { id: "t3", date: "2026-03-07", minutes: 60, description: "Jourärende under helg", billable: true, user: { name: "Anna" }, hourlyRate: 325_600, kind: "ARBETE_OBEKVAM_TID" },
  ],
  totalMinutes: 270,
};
// Byråns standardåtgärder (#956) — org-inställning, samma lista för alla.
const ORG_SETTINGS = {
  standardAtgarder: [
    { id: "inledande-atgarder", description: "Inledande åtgärder och genomgång av handlingar", minutes: 30, kind: "ARBETE", stage: "OPENING", paymentMethods: [], billable: true, active: true },
    { id: "avslutande-atgarder", description: "Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman", minutes: 45, kind: "ARBETE", stage: "CLOSING", paymentMethods: [], billable: true, active: true },
    { id: "avstalld", description: "Avställd åtgärd", minutes: 15, kind: "ARBETE", stage: "ANY", paymentMethods: [], billable: true, active: false },
  ],
};
const MATTERS = [
  { id: "m1", matterNumber: "2026-0001", title: "Vårdnad" },
  { id: "m2", matterNumber: "2026-0002", title: "Arvskifte" },
];

let timeData: TimeData = DEFAULT_TIME;
// Ärendets billing-runs styr förslagen (#958): KOSTNADSRAKNING med awardedOre =
// dom registrerad; FINAL = slutreglerat (arbetet fryst).
let runs: Array<Record<string, unknown>> = [];
// Rådgivningspostens status (#1207): `missing` = legacy-ärende utan låst post.
let radgivningStatus: unknown = { kind: "present", invoiceId: "inv-r" };
/** Spärr för `timeEntry.update`: svaret dröjer tills testet släpper den. */
let updateGate: Promise<void> = Promise.resolve();
/** Fel som `timeEntry.moveToMatter` ger, eller null. */
let moveError: string | null = null;

const HANDLERS = {
  "timeEntry.list": () => timeData,
  "organization.getSettings": () => ORG_SETTINGS,
  "billingRun.list": () => ({ runs }),
  "timeEntry.radgivningStatus": () => radgivningStatus,
  "matter.list": () => ({ matters: MATTERS }),
  "timeEntry.update": async () => { await updateGate; return { id: "t1" }; },
  "timeEntry.moveToMatter": () => {
    if (moveError) throw new Error(moveError);
    return { moved: 1 };
  },
};

type Props = Parameters<typeof renderTimeSection>[1];
const renderTime = (props?: Props): Promise<FakeTrpcRender> => renderTimeSection(HANDLERS, props);

/** Håller `timeEntry.update` tills den returnerade funktionen anropas. */
function holdUpdate(): () => void {
  let release: () => void = () => {};
  updateGate = new Promise((resolve) => { release = resolve; });
  return () => release();
}

/** Väntar på att `timeEntry.create` anropats en gång med fälten. */
async function expectCreated(view: FakeTrpcRender, fields: Record<string, unknown>): Promise<void> {
  await waitFor(() => expect(callsTo(view.fake, "timeEntry.create")).toEqual([expect.objectContaining(fields)]));
}

/** Väntar på att `timeEntry.update` anropats en gång med fälten. */
async function expectUpdated(view: FakeTrpcRender, fields: Record<string, unknown>): Promise<void> {
  await waitFor(() => expect(callsTo(view.fake, "timeEntry.update")).toEqual([expect.objectContaining(fields)]));
}

/** Det n:te elementet med texten — felar tydligt om det saknas. */
function nthText(text: string, n: number): HTMLElement {
  const el = screen.getAllByText(text)[n];
  if (!el) throw new Error(`saknar ${text} nr ${n}`);
  return el;
}

beforeEach(() => {
  timeData = DEFAULT_TIME;
  runs = [];
  radgivningStatus = { kind: "present", invoiceId: "inv-r" };
  updateGate = Promise.resolve();
  moveError = null;
});
afterEach(() => { vi.restoreAllMocks(); });

describe("TimeSection — arvodeskategori (#953)", () => {
  it("visar kategorin per rad — inte bara för arbete", async () => {
    await renderTime();
    expect(screen.getByText("Kategori")).toBeInTheDocument();
    expect(screen.getByText("Tidsspillan")).toBeInTheDocument();
    expect(screen.getByText("Timarvode helg/kväll")).toBeInTheDocument();
    // Poster utan kind visas som Timarvode (default), inte som tomt.
    expect(screen.getByText("Timarvode")).toBeInTheDocument();
  });

  it("rubriken visar ärendets totala tid", async () => {
    await renderTime();
    expect(screen.getByText("(totalt 4,5 h)")).toBeInTheDocument();
  });

  it("beskrivningen bryter rad i stället för att rinna in i grannkolumnen (#1197)", async () => {
    await renderTime();
    expect(screen.getByText("Genomgång av handlingar").closest("td")).toHaveClass("whitespace-normal");
  });

  it("datum och beskrivning är toppjusterade, så att de står i höjd med varandra (#1752)", async () => {
    await renderTime();
    expect(screen.getByText("Genomgång av handlingar").closest("td")).toHaveClass("align-top");
    expect(screen.getByText(new Date("2026-03-01").toLocaleDateString("sv-SE")).closest("td")).toHaveClass("align-top");
  });

  it("formuläret erbjuder alla arvodeskategorier och skickar den valda", async () => {
    const view = await renderTime();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    const select = screen.getByLabelText<HTMLSelectElement>("Arvodeskategori *");
    expect(select).toHaveValue("ARBETE"); // default
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([
      "ARBETE", "ARBETE_OBEKVAM_TID", "TIDSSPILLAN", "TIDSSPILLAN_OVRIG_TID", "ADVOKATBEREDSKAP", "FORHANDLING", "FORHOR",
    ]);

    fireEvent.change(select, { target: { value: "TIDSSPILLAN_OVRIG_TID" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Hemresa efter kvällssammanträde" } });
    fireEvent.click(screen.getByText("Spara"));
    await expectCreated(view, { matterId, kind: "TIDSSPILLAN_OVRIG_TID", description: "Hemresa efter kvällssammanträde" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Registrera tid" })).not.toBeInTheDocument());
  });

  /**
   * Advokatberedskap ersätts per dygn (#950): det finns ingen tid att mata in,
   * och minuterna måste nollas när kategorin väljs — annars följer förra
   * postens halvtimme med in i varje timbaserad summa.
   */
  it("beredskap byter ut minutfältet mot ett dygn och skickar noll minuter", async () => {
    const view = await renderTime();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.getByLabelText("Tid (h) *")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "ADVOKATBEREDSKAP" } });
    expect(screen.queryByLabelText("Tid (h) *")).not.toBeInTheDocument();
    expect(screen.getByText("1 dygns beredskap")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Helgjour tingsrätten" } });
    fireEvent.click(screen.getByText("Spara"));
    await expectCreated(view, { matterId, kind: "ADVOKATBEREDSKAP", minutes: 0 });
  });

  it("en beredskapspost visas som 1 dygn i listan", async () => {
    timeData = { entries: [{ id: "t9", date: "2026-03-01", minutes: 0, description: "Jour", billable: true, kind: "ADVOKATBEREDSKAP" }], totalMinutes: 0 };
    await renderTime();
    expect(screen.getByText("1 dygn")).toBeInTheDocument();
  });

  it("kategorin är rättbar i efterhand — ändra-formuläret förifylls och skickar kind", async () => {
    const view = await renderTime();
    fireEvent.click(nthText("Ändra", 1)); // raden med TIDSSPILLAN
    expect(screen.getByLabelText("Arvodeskategori *")).toHaveValue("TIDSSPILLAN");
    fireEvent.click(screen.getByText("Spara"));
    await expectUpdated(view, { id: "t2", kind: "TIDSSPILLAN" });
  });

  it("normhjälptexten visas bara för täckningsärenden (rättshjälp/rättsskydd)", async () => {
    const { unmount } = await renderTime({ paymentMethod: "PRIVAT" });
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.queryByText(/slutregleringsårets normer/)).not.toBeInTheDocument();
    unmount();

    await renderTime({ paymentMethod: "RATTSSKYDD" });
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
  async function openForm(paymentMethod: "PRIVAT" | "RATTSHJALP"): Promise<void> {
    await renderTime({ paymentMethod });
    fireEvent.click(screen.getByText("+ Registrera tid"));
  }

  it("Arbete har ingen tillämpningsregel att visa", async () => {
    await openForm("RATTSHJALP");
    expect(screen.queryByText(/07\.00/)).not.toBeInTheDocument();
  });

  it("Tidsspillan visar 07–22-fönstret och måltidspausen", async () => {
    await openForm("RATTSHJALP");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "TIDSSPILLAN" } });
    const text = screen.getByText(/måltidspaus/);
    expect(text).toHaveTextContent("mellan 07.00 och 22.00");
    expect(text).toHaveTextContent("DVFS 2025:4 §§ 2–4");
  });

  it("Tidsspillan helg/kväll visar övernattningsregeln — den gäller just 18–22", async () => {
    await openForm("RATTSHJALP");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "TIDSSPILLAN_OVRIG_TID" } });
    const text = screen.getByText(/övernattning/);
    expect(text).toHaveTextContent("18.00–22.00 endast om den avser restid");
    // Natten är inte "lägre taxa" utan INGEN ersättning — lätt att tro fel.
    expect(text).toHaveTextContent("22.00 och 07.00 ersätts inte alls");
  });

  it("Timarvode helg/kväll anger föreskrifternas tider och att tidsspillan då registreras som Tidsspillan", async () => {
    await openForm("RATTSHJALP");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "ARBETE_OBEKVAM_TID" } });
    const text = screen.getByText(/^Häktningsförhandling/);
    expect(text).toHaveTextContent("polisförhör vardagar 00.00–07.00 och 18.00–24.00 samt helg (DVFS 2025:8 § 1)");
    expect(text).toHaveTextContent("registreras som Tidsspillan (vardagstaxan)");
  });

  it("Tidsspillan helg/kväll pekar ut undantaget: helghäktning/nattförhör registreras som Tidsspillan", async () => {
    await openForm("RATTSHJALP");
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "TIDSSPILLAN_OVRIG_TID" } });
    expect(screen.getByText(/övernattning/)).toHaveTextContent("DVFS 2025:7 § 1, 2025:8 § 3");
  });

  it("privatärenden får ingen hjälptext — normerna styr inte deras arvode", async () => {
    await openForm("PRIVAT");
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
  it("väljaren listar byråns AKTIVA åtgärder med tiden synlig", async () => {
    await renderTime();
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

  it("val av åtgärd fyller beskrivning + tid och skickar standardAtgardId", async () => {
    const view = await renderTime();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByLabelText("Standardåtgärd"), { target: { value: "avslutande-atgarder" } });

    expect(screen.getByPlaceholderText("Beskrivning *")).toHaveValue("Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman");
    expect(screen.getByLabelText("Tid (h) *")).toHaveValue("0,75");

    fireEvent.click(screen.getByText("Spara"));
    await expectCreated(view, {
      matterId, standardAtgardId: "avslutande-atgarder", minutes: 45,
      description: "Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman",
    });
  });

  it("tiden är en HUVUDREGEL — den går att justera efter att åtgärden valts", async () => {
    const view = await renderTime();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByLabelText("Standardåtgärd"), { target: { value: "inledande-atgarder" } });
    fireEvent.change(screen.getByLabelText("Tid (h) *"), { target: { value: "1,25" } });

    fireEvent.click(screen.getByText("Spara"));
    // Kopplingen behålls så byrån kan se att tiden avvikit från huvudregeln.
    await expectCreated(view, { standardAtgardId: "inledande-atgarder", minutes: 75 });
  });

  it("tillbaka till fritext nollar kopplingen men behåller texten", async () => {
    const view = await renderTime();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    const select = screen.getByLabelText("Standardåtgärd");
    fireEvent.change(select, { target: { value: "inledande-atgarder" } });
    fireEvent.change(select, { target: { value: "" } });

    expect(screen.getByPlaceholderText("Beskrivning *")).toHaveValue("Inledande åtgärder och genomgång av handlingar");
    fireEvent.click(screen.getByText("Spara"));
    await expectCreated(view, { standardAtgardId: "" });
  });
});

/**
 * Förslagsraden (#958): påminn om standardåtgärderna vid rätt tidpunkt, och
 * FÖRIFYLL formuläret i stället för att spara. Datumet måste vara handläggarens
 * val — det styr vilken årsnorm posten värderas på (#951/#954).
 */
describe("TimeSection — förslag om standardåtgärder (#958)", () => {
  it("pågående ärende med registrerat arbete → ingen förslagsrad", async () => {
    await renderTime({ paymentMethod: "RATTSHJALP", matterStatus: "ACTIVE" });
    expect(screen.queryByText(/standardåtgärder.*som inte är registrerade/i)).not.toBeInTheDocument();
  });

  it("registrerad dom → avslutande åtgärd föreslås med sin tid", async () => {
    runs = [{ type: "KOSTNADSRAKNING", awardedOre: 500_000 }];
    const view = await renderTime({ paymentMethod: "RATTSHJALP", matterStatus: "ACTIVE" });
    expect(screen.getByText(/som inte är registrerade/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Avslutande åtgärder inklusive mottagande av dom/ })).toBeInTheDocument();
    expect(callsTo(view.fake, "billingRun.list")).toEqual([{ matterId }]);
  });

  it("klicket FÖRIFYLLER formuläret — inget sparas", async () => {
    runs = [{ type: "KOSTNADSRAKNING", awardedOre: 500_000 }];
    const view = await renderTime({ paymentMethod: "RATTSHJALP", matterStatus: "ACTIVE" });
    fireEvent.click(screen.getByRole("button", { name: /Avslutande åtgärder inklusive mottagande av dom/ }));

    // Formuläret öppnas ifyllt med byråns huvudregel …
    expect(screen.getByPlaceholderText("Beskrivning *")).toHaveValue("Avslutande åtgärder inklusive mottagande av dom och kontakt med huvudman");
    expect(screen.getByLabelText("Tid (h) *")).toHaveValue("0,75");
    expect(screen.getByLabelText("Standardåtgärd")).toHaveValue("avslutande-atgarder");
    // … men INGET är sparat förrän användaren godkänner.
    expect(callsTo(view.fake, "timeEntry.create")).toEqual([]);

    fireEvent.click(screen.getByText("Spara"));
    await expectCreated(view, { standardAtgardId: "avslutande-atgarder", minutes: 45 });
  });

  it("redan registrerad åtgärd föreslås inte igen — härleds ur ärendets tidsposter", async () => {
    runs = [{ type: "KOSTNADSRAKNING", awardedOre: 500_000 }];
    timeData = {
      ...DEFAULT_TIME,
      entries: [...DEFAULT_TIME.entries, {
        id: "t4", date: "2026-07-01", minutes: 45, description: "Avslutande åtgärder …",
        billable: true, user: { name: "Anna" }, hourlyRate: 162_600, standardAtgardId: "avslutande-atgarder",
      }],
    };
    await renderTime({ paymentMethod: "RATTSHJALP", matterStatus: "ACTIVE" });
    expect(screen.queryByText(/som inte är registrerade/i)).not.toBeInTheDocument();
  });

  it("slutreglerat ärende → inga förslag (arbetet är fryst)", async () => {
    runs = [
      { type: "KOSTNADSRAKNING", awardedOre: 500_000 },
      { type: "FINAL", awardedOre: null },
    ];
    await renderTime({ paymentMethod: "RATTSHJALP", matterStatus: "CLOSED" });
    expect(screen.queryByText(/som inte är registrerade/i)).not.toBeInTheDocument();
  });
});

describe("TimeSection — Markera som rådgivning (#1207)", () => {
  const MARK = "Markera som rådgivning";

  it("visas på olåsta debiterbara rader när ärendet saknar låst rådgivningspost", async () => {
    radgivningStatus = { kind: "missing", invoiceId: "inv-r" };
    await renderTime({ paymentMethod: "RATTSHJALP" });
    expect(screen.getAllByText(MARK)).toHaveLength(3);
  });

  it("visas inte när ärendet redan har en rådgivningspost", async () => {
    await renderTime({ paymentMethod: "RATTSHJALP" });
    expect(screen.queryByText(MARK)).toBeNull();
  });

  it("visas inte utan status (t.ex. inte rättshjälp)", async () => {
    radgivningStatus = { kind: "missing", invoiceId: "inv-r" };
    const view = await renderTime({ paymentMethod: "PRIVAT" });
    expect(screen.queryByText(MARK)).toBeNull();
    expect(callsTo(view.fake, "timeEntry.radgivningStatus")).toEqual([]);
  });

  it("prod-formen (#1235): ej debiterbart möte fryst av KR visar åtgärden bredvid Låst; debiterbar fryst tid gör det inte", async () => {
    timeData = {
      entries: [
        { id: "mote", date: "2026-03-01", minutes: 60, description: "Möte med huvudman", billable: false, user: { name: "Anna" }, hourlyRate: 162_600, frozenAt: "2026-05-01", frozenByBillingRunId: "run-kr" },
        { id: "arbete", date: "2026-03-02", minutes: 90, description: "Genomgång", billable: true, user: { name: "Anna" }, hourlyRate: 162_600, frozenAt: "2026-05-01", frozenByBillingRunId: "run-kr" },
      ],
      totalMinutes: 150,
    };
    radgivningStatus = { kind: "missing", invoiceId: "inv-r" };
    vi.spyOn(globalThis, "confirm").mockReturnValueOnce(true);
    const view = await renderTime({ paymentMethod: "RATTSHJALP" });
    expect(screen.getAllByText(MARK)).toHaveLength(1);
    expect(screen.getAllByText("🔒 Låst")).toHaveLength(2);
    fireEvent.click(screen.getByText(MARK));
    await waitFor(() => expect(callsTo(view.fake, "timeEntry.markAsRadgivning")).toEqual([{ id: "mote" }]));
  });

  it("bekräftar först — avbryt markerar inte, bekräfta markerar raden", async () => {
    radgivningStatus = { kind: "missing", invoiceId: "inv-r" };
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const view = await renderTime({ paymentMethod: "RATTSHJALP" });
    fireEvent.click(nthText(MARK, 0));
    expect(callsTo(view.fake, "timeEntry.markAsRadgivning")).toEqual([]);
    expect(confirmSpy.mock.calls[0]?.[0]).toContain("delas");
    fireEvent.click(nthText(MARK, 0));
    await waitFor(() => expect(callsTo(view.fake, "timeEntry.markAsRadgivning"))
      .toEqual([{ id: expect.stringMatching(/^t[123]$/) }]));
  });
});

describe("TimeSection — tid i timmar med decimal (#1545)", () => {
  const openCreate = async (): Promise<{ view: FakeTrpcRender; input: HTMLElement }> => {
    const view = await renderTime();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Telefonsamtal" } });
    return { view, input: screen.getByLabelText("Tid (h) *") };
  };

  it("ny post har 0,5 timmar som standard", async () => {
    expect((await openCreate()).input).toHaveValue("0,5");
  });

  it.each(["1,5", "1.5"])("%s sparas som 90 minuter", async (value) => {
    const { view, input } = await openCreate();
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByText("Spara"));
    await expectCreated(view, { matterId, minutes: 90 });
  });

  it("1,33 ger ett felmeddelande och sparas inte", async () => {
    const { view, input } = await openCreate();
    fireEvent.change(input, { target: { value: "1,33" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ändra värdet");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByText("Spara"));
    await settled(view);
    expect(callsTo(view.fake, "timeEntry.create")).toEqual([]);
  });

  it("en befintlig post visas i timmar när den ändras", async () => {
    await renderTime();
    fireEvent.click(nthText("Ändra", 1)); // raden med 90 minuter
    expect(screen.getByLabelText("Tid (h) *")).toHaveValue("1,5");
  });
});

/**
 * Förhör (#1855): en tidspost med starttid och längd. Klockslaget behövs för
 * förordnandetaxans 3 §, så formuläret tar det för den här kategorin och läser
 * tillbaka det när posten ändras.
 */
describe("TimeSection — förhör med starttid (#1855)", () => {
  it("Förhör visar Starttid och hjälptexten, också utanför rättshjälp och rättsskydd", async () => {
    await renderTime({ paymentMethod: "OFFENTLIGT_UPPDRAG" });
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.queryByLabelText("Starttid *")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "FORHOR" } });
    expect(screen.getByLabelText("Starttid *")).toBeRequired();
    expect(screen.getByText(/Ett uppehåll på 15 minuter eller mer/)).toHaveTextContent("registrera förhöret som två poster");
    expect(screen.queryByText(/slutregleringsårets normer/)).not.toBeInTheDocument();
  });

  it("ett nytt förhör sparas med starttiden i svensk tid", async () => {
    const view = await renderTime();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByLabelText("Arvodeskategori *"), { target: { value: "FORHOR" } });
    fireEvent.change(screen.getByLabelText("Datum *"), { target: { value: "2026-03-02" } });
    fireEvent.change(screen.getByLabelText("Starttid *"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Förhör med klienten" } });
    fireEvent.click(screen.getByText("Spara"));
    await expectCreated(view, { matterId, kind: "FORHOR", date: "2026-03-02T08:30:00.000Z" });
    expect(callsTo(view.fake, "timeEntry.create")[0]).not.toHaveProperty("startTime");
  });

  it("att ändra ett förhör behåller klockslaget", async () => {
    timeData = {
      entries: [{ id: "t4", date: "2026-03-09T08:15:00.000Z", minutes: 45, description: "Förhör hos polisen", billable: true, user: { name: "Anna" }, hourlyRate: 162_600, kind: "FORHOR" }],
      totalMinutes: 45,
    };
    const view = await renderTime();
    fireEvent.click(nthText("Ändra", 0));
    expect(screen.getByLabelText("Starttid *")).toHaveValue("09:15");
    fireEvent.click(screen.getByText("Spara"));
    await expectUpdated(view, { id: "t4", kind: "FORHOR", date: "2026-03-09T08:15:00.000Z" });
  });

  it("andra kategorier skickar bara dagen", async () => {
    const view = await renderTime();
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.click(screen.getByText("Spara"));
    await expectUpdated(view, { id: "t1", date: "2026-03-01" });
  });
});

/** Tidslistan och upparbetat för ett ärende, som `refreshMatters` läser om dem. */
const refreshedFor = (id: string): string[] => [forMatter("timeEntry.list", id), forMatter("matter.coverageUsage", id)];
const editDialog = () => screen.queryByRole("dialog", { name: "Ändra tidregistrering" });

describe("TimeSection — flytta posten till ett annat ärende (#2042)", () => {
  it("fältet Ärende finns i Ändra tidregistrering, förvalt postens ärende", async () => {
    await renderTime();
    fireEvent.click(nthText("Ändra", 0));
    expect(await screen.findByDisplayValue("2026-0001 — Vårdnad")).toBe(screen.getByLabelText("Ärende"));
  });

  it("Registrera tid har inget ärendefält — posten hör till ärendet", async () => {
    await renderTime();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.queryByLabelText("Ärende")).not.toBeInTheDocument();
  });

  it("samma ärende: bara update, och dialogen stängs", async () => {
    const view = await renderTime();
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(editDialog()).not.toBeInTheDocument());
    await settled(view);
    expect(callsTo(view.fake, "timeEntry.moveToMatter")).toEqual([]);
    expect(invalidatedPaths(view.invalidate)).toContain(forMatter("timeEntry.list", "m1"));
  });

  it("ett annat ärende: update, sedan moveToMatter med postens id, och båda ärendena läses om", async () => {
    const release = holdUpdate();
    const view = await renderTime();
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.change(screen.getByLabelText("Ärende"), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(callsTo(view.fake, "timeEntry.update")).toEqual([expect.objectContaining({ id: "t1" })]));
    expect(callsTo(view.fake, "timeEntry.moveToMatter")).toEqual([]);
    expect(editDialog()).toBeInTheDocument();
    release();
    await waitFor(() => expect(callsTo(view.fake, "timeEntry.moveToMatter")).toEqual([{ ids: ["t1"], matterId: "m2" }]));
    await waitFor(() => expect(editDialog()).not.toBeInTheDocument());
    expect(invalidatedPaths(view.invalidate)).toEqual(expect.arrayContaining([...refreshedFor("m1"), ...refreshedFor("m2")]));
  });

  it("ett rensat ärendefält flyttar inte", async () => {
    const view = await renderTime();
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.change(screen.getByLabelText("Ärende"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(callsTo(view.fake, "timeEntry.update")).toHaveLength(1));
    await settled(view);
    expect(callsTo(view.fake, "timeEntry.moveToMatter")).toEqual([]);
  });
});

describe("TimeSection — markera flera poster och flytta dem (#2043)", () => {
  const rowOf = (text: string) => {
    const row = screen.getByText(text).closest("tr");
    if (!row) throw new Error(`ingen rad för ${text}`);
    return within(row);
  };

  /** Markerar alla rader och flyttar dem till Arvskifte. */
  function moveAllToM2(): void {
    fireEvent.click(screen.getByRole("checkbox", { name: "Markera alla" }));
    fireEvent.click(screen.getByRole("button", { name: "Flytta till ärende… (3)" }));
    const dialog = screen.getByRole("dialog", { name: "Flytta till ärende" });
    fireEvent.change(within(dialog).getByLabelText("3 tidsposter flyttas till:"), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Flytta" }));
  }

  it("en låst post går inte att markera", async () => {
    timeData = { entries: [
      { id: "t1", date: "2026-03-01", minutes: 60, description: "Öppen post", billable: true },
      { id: "t2", date: "2026-03-02", minutes: 60, description: "Fryst post", billable: true, frozenAt: "2026-04-01" },
    ], totalMinutes: 120 };
    await renderTime();
    expect(rowOf("Öppen post").getByRole("checkbox", { name: "Markera rad" })).toBeInTheDocument();
    expect(rowOf("Fryst post").queryByRole("checkbox")).toBeNull();
  });

  it("knappen visar antalet, och det nuvarande ärendet är inte valbart", async () => {
    await renderTime();
    fireEvent.click(rowOf("Genomgång av handlingar").getByRole("checkbox", { name: "Markera rad" }));
    fireEvent.click(rowOf("Restid till sammanträde").getByRole("checkbox", { name: "Markera rad" }));
    fireEvent.click(screen.getByRole("button", { name: "Flytta till ärende… (2)" }));
    const dialog = screen.getByRole("dialog", { name: "Flytta till ärende" });
    const values = Array.from(dialog.querySelectorAll("datalist option")).map((o) => o.getAttribute("value"));
    expect(values).toEqual(["2026-0002 — Arvskifte"]);
  });

  it("efter Flytta läses båda ärendena om och markeringen töms", async () => {
    const view = await renderTime();
    moveAllToM2();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Flytta till ärende/ })).toBeNull());
    expect(callsTo(view.fake, "timeEntry.moveToMatter")).toEqual([{ ids: ["t1", "t2", "t3"], matterId: "m2" }]);
    expect(invalidatedPaths(view.invalidate)).toEqual(expect.arrayContaining([...refreshedFor("m1"), ...refreshedFor("m2")]));
    expect(screen.queryByRole("checkbox", { name: "Markera rad", checked: true })).toBeNull();
  });

  it("ett misslyckat anrop loggas, aldrig tyst", async () => {
    moveError = "låst";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderTime();
    moveAllToM2();
    await waitFor(() => expect(log).toHaveBeenCalledWith("[timeEntry.moveToMatter] misslyckades:", expect.objectContaining({ message: "låst" })));
  });
});

describe("TimeSection — fakturaförslaget hämtas om (#2201)", () => {
  const PROPOSAL = (id: string): string => forMatter("billingRun.proposal", id);

  it("att skapa tid hämtar om ärendets förslag", async () => {
    const view = await renderTime();
    expect(invalidatedPaths(view.invalidate)).not.toContain(PROPOSAL("m1"));
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Samtal" } });
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(invalidatedPaths(view.invalidate)).toContain(PROPOSAL("m1")));
  });

  it("att ta bort tid hämtar om ärendets förslag", async () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const view = await renderTime();
    fireEvent.click(nthText("Ta bort", 0));
    await waitFor(() => expect(invalidatedPaths(view.invalidate)).toContain(PROPOSAL("m1")));
    expect(callsTo(view.fake, "timeEntry.delete")).toEqual([{ id: "t1" }]);
  });

  it("att ändra tid hämtar om förslaget först när ändringen lyckats", async () => {
    const release = holdUpdate();
    const view = await renderTime();
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(callsTo(view.fake, "timeEntry.update")).toHaveLength(1));
    expect(invalidatedPaths(view.invalidate)).not.toContain(PROPOSAL("m1"));
    release();
    await waitFor(() => expect(invalidatedPaths(view.invalidate)).toContain(PROPOSAL("m1")));
  });

  it("en flytt hämtar om båda ärendenas förslag", async () => {
    const view = await renderTime();
    fireEvent.click(nthText("Ändra", 0));
    fireEvent.change(screen.getByLabelText("Ärende"), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(invalidatedPaths(view.invalidate)).toEqual(expect.arrayContaining([PROPOSAL("m1"), PROPOSAL("m2")])));
  });
});
