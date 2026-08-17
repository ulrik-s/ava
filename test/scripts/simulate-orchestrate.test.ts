/**
 * Integration för den kronologiska seedningen (#880): populate(kärnentiteter) +
 * runSimulation mot ett git-target (in-memory). Speglar generateInto — verifierar
 * att simuleringen faktiskt skapar tid/dokument/fakturor per ärende, kronologiskt,
 * med inkommande dokument och kredit vid överfakturering.
 */

import { describe, it, expect } from "vitest-compat";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { createIdTranslator, translateSeed } from "../../tooling/demo-generator/id-translator";
import type { RunCtx } from "../../tooling/demo-generator/simulate/runner";
import { buildSeed } from "../../tooling/scripts/seed-data";
import { runDemoSeed } from "./_demo-seed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Kör hela seedningen mot ett in-memory git-target — samma steg som
 * `generateInto`: populate(kärnentiteter) + runSimulation. Ett anrop i st.f.
 * sex identiska rader per test, så påståendena syns i stället för riggen.
 */
async function simulateDemo(): Promise<{ c: Any; res: RunCtx["res"] }> {
  const seed = translateSeed(buildSeed(), createIdTranslator()) as Any;
  const orgId = String(seed.organizations[0].id);
  const admin = { id: asId<"UserId">("gen"), email: "g@a.se", name: "G", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">(orgId) };
  const target = createGitTarget({ principal: admin, writeBack: async () => {} });
  const res = await runDemoSeed(target.caller, seed);
  return { c: target.caller as Any, res };
}

describe("runSimulation (#880 integration)", () => {
  it("seedar kronologiskt per ärende: tid, in/ut-dokument, fakturor + kredit", async () => {
    const { c, res: simRes } = await simulateDemo();

    // Simuleringen skapade faktiskt saker (fångar "0 av allt"-regressionen).
    expect(simRes.timeEntries).toBeGreaterThan(10);
    expect(simRes.invoices).toBeGreaterThan(5);
    expect(simRes.documents).toBeGreaterThan(5);
    expect(simRes.credits).toBeGreaterThanOrEqual(1); // rättshjälp varierande → överfakturerad → kredit

    // Något dokument är INKOMMANDE (inkommande dok skapas per scenario).
    const mres = await c.matter.list({});
    const matters = mres.matters ?? mres.items ?? mres;
    const rh = matters.find((m: Any) => m.paymentMethod === "RATTSHJALP" && m.matterNumber === "2026-0020");
    expect(rh, "varierande-rättshjälp-ärendet finns").toBeTruthy();
    // `document.tree`, inte `document.list({folderId: null})`: sedan #985 filas
    // varje dokument i en mapp, så ROT-listningen är tom. Trädet är dessutom vad
    // UI:t faktiskt läser — båda dokumentvyerna bygger på `tree.data`.
    const list = (await c.document.tree({ matterId: rh.id })).documents as Any[];
    expect(list.some((d: Any) => d.direction === "INKOMMANDE")).toBe(true);
    expect(list.some((d: Any) => d.direction === "UTGAENDE")).toBe(true);

    // Ärendet har flera tidsposter (kronologin i sig täcks av runner-enhetstestet).
    const te = await c.timeEntry.list({ matterId: rh.id, pageSize: 100 });
    const teRows = te.timeEntries ?? te.items ?? te.entries ?? (Array.isArray(te) ? te : []);
    expect(teRows.length).toBeGreaterThan(2);

    // Regression: ärendet ska ha kontakter (inkl KLIENT), tjänsteanteckningar och
    // utlägg — simuleringen återskapar dem kronologiskt (annars tomma i demon).
    const full = await c.matter.getById({ id: rh.id });
    const contactRows = full.contacts ?? full.matterContacts ?? [];
    expect(contactRows.some((x: Any) => x.role === "KLIENT")).toBe(true);
    const notes = await c.serviceNote.list({ matterId: rh.id });
    expect((notes.serviceNotes ?? notes).length).toBeGreaterThan(0);
    const exp = await c.expense.list({ matterId: rh.id, pageSize: 100 });
    expect((exp.expenses ?? exp.items ?? exp).length).toBeGreaterThan(0);

    // #891: 2026-0020 spänner över ett årsskifte, innehåller tidsspillan och
    // slutregleras retroaktivt på nya normen (klient- + domstolsfaktura).
    const teAll = await c.timeEntry.list({ matterId: rh.id, pageSize: 100 });
    const teRows2 = teAll.timeEntries ?? teAll.items ?? teAll.entries ?? (Array.isArray(teAll) ? teAll : []);
    const years = new Set(teRows2.map((t: Any) => new Date(t.date).getFullYear()));
    expect(years.size).toBeGreaterThan(1); // korsar årsgränsen
    expect(teRows2.some((t: Any) => t.kind === "TIDSSPILLAN")).toBe(true);
    const settlementRuns = (await c.billingRun.list({ matterId: rh.id })).runs as Any[];
    const recips = new Set(settlementRuns.filter((r) => r.type === "FINAL").map((r) => r.recipient));
    expect(recips.has("KLIENT")).toBe(true);
    expect(recips.has("DOMSTOL")).toBe(true);
  });

  /**
   * #982: simuleringen ersatte `populate-billing.ts` men tog inte över dess
   * faktura-livscykler, så demon hade noll avbetalningsplaner och noll
   * avskrivningar. Det upptäcktes först av ett e2e-test — inget steg sa något.
   * Testet nedan är den saknade grinden: det påstår om DEMONS DATA, inte om
   * scenariomallen, att varje tillstånd faktiskt uppstår.
   */
  it("privatärendenas livscykler ger planer i alla tre tillstånd + en kundförlust", async () => {
    const { c, res: simRes } = await simulateDemo();

    const { items: plans } = (await c.paymentPlan.list({})) as { items: Any[] };
    const statuses = new Set(plans.map((p) => p.status));
    // Cykeln i `privat.ts` är sex lång och seeden har fler privatärenden än så,
    // så alla tre tillstånden ska förekomma. Slår detta fel har antingen cykeln
    // ändrats eller antalet privatärenden fallit under sex.
    expect(statuses.has("ACTIVE"), "aktiv plan").toBe(true);
    expect(statuses.has("COMPLETED"), "slutförd plan").toBe(true);
    expect(statuses.has("CANCELLED"), "avbruten plan").toBe(true);
    expect(simRes.reminders, "påminnelser skickade").toBeGreaterThan(0);

    // Kundförlusten stänger sin faktura som BAD_DEBT (ADR 0007).
    expect(simRes.writeOffs).toBeGreaterThan(0);
    const { items: invoices } = (await c.invoice.list({})) as { items: Any[] };
    expect(invoices.some((i) => i.status === "BAD_DEBT"), "avskriven faktura").toBe(true);
    // …och en plan-faktura står som INSTALLMENT_PLAN, inte som vanlig SENT.
    expect(invoices.some((i) => i.status === "INSTALLMENT_PLAN"), "faktura med plan").toBe(true);
  });

  /**
   * #985: dokumentmappar och utskickshistorik. Loadern saknade matchers för
   * båda, men bakom det låg att simuleringen aldrig skapade dem — varje dokument
   * låg i roten och fakturans utskickshistorik var tom. Testet påstår om DEMONS
   * DATA att strukturen finns, inte om scenariomallen.
   */
  it("dokument filas i mappar (inkl. nästlade) och skickade fakturor får utskickshistorik", async () => {
    const { c, res: simRes } = await simulateDemo();

    expect(simRes.folders, "mappar skapade").toBeGreaterThan(0);
    expect(simRes.dispatches, "utskick registrerade").toBeGreaterThan(0);

    // Trädet ska vara NÄSTLAT någonstans i demon (t.ex. Domstol/Domar) — annars
    // ser mapphanteringen ut som en platt lista. Ärendet letas fram i stället för
    // att pekas ut: vilka handlingar ett enskilt ärende får beror på var i sin
    // livscykel det vilar (#828 steg 6), och det hör hemma i scenariot.
    const matters = (await c.matter.list({})).matters as Any[];
    const trees = await Promise.all(matters.map(async (m: Any) => ({
      matterId: String(m.id), tree: await c.document.tree({ matterId: m.id }),
    })));
    type Folder = { id: string; name: string; parentId: string | null };
    const nestedHit = trees
      .map((t) => ({ ...t, folders: t.tree.folders as Folder[] }))
      .find((t) => t.folders.some((f) => f.parentId !== null));
    expect(nestedHit, "något ärende har en nästlad mapp").toBeTruthy();
    const nested = nestedHit!.folders.find((f) => f.parentId !== null)!;
    expect(nestedHit!.folders.some((f) => f.id === nested.parentId), "den nästlade mappens förälder finns").toBe(true);

    // Och INGET dokument ligger kvar i roten — i något ärende.
    const loose = trees.flatMap((t) => (t.tree.documents as Array<{ folderId: string | null }>)
      .filter((d) => d.folderId === null));
    expect(trees.some((t) => (t.tree.documents as unknown[]).length > 0), "demon har dokument").toBe(true);
    expect(loose, "inget dokument ligger kvar i roten").toHaveLength(0);
  });

  /**
   * #988: `SuggestionsPanel` och `EventsPanel` stod tomma i ALLA tier eftersom
   * ingenting skapade raderna. Nu extraherar seedningen parter och kallelser ur
   * dokumentens text. Testet påstår om DEMONS DATA att panelerna har något att
   * visa — och att förslagen går att koppla till ett ärende, vilket är vad
   * panelerna frågar efter.
   */
  it("dokumenttext ger kontakt- och händelseförslag som panelerna kan visa", async () => {
    const { c, res: simRes } = await simulateDemo();

    expect(simRes.partySuggestions, "kontaktförslag skapade").toBeGreaterThan(0);
    expect(simRes.eventSuggestions, "händelseförslag skapade").toBeGreaterThan(0);

    // Panelerna läser per ÄRENDE — hittar de inget där spelar det ingen roll
    // hur många rader som skapats.
    const matters = (await c.matter.list({})).matters as Any[];
    const groups = await Promise.all(matters.map((m: Any) => c.document.pendingSuggestionsGrouped({ matterId: m.id })));
    expect(groups.some((g: Any) => (g.groups ?? g).length > 0), "något ärende har kontaktförslag").toBe(true);

    const events = await Promise.all(matters.map((m: Any) => c.document.events({ matterId: m.id })));
    expect(events.some((e: Any) => (e.events ?? e).length > 0), "något ärende har händelseförslag").toBe(true);
  });

  /**
   * #824/#882: upparbetat men ofakturerat arbete. `populate-unbilled-time.ts`
   * skapade det förr; simuleringen tog aldrig över, och ingen märkte något —
   * fakturapanelen visade bara "Upparbetat ofakturerat: 0 kr" på vartenda
   * ärende och fakturaförslaget hade inget att räkna på.
   *
   * Testet frågar via `billingRun.proposal`, samma väg som panelen, och
   * påstår om DEMONS DATA — inte om scenariomallen.
   */
  it("öppna privatärenden har upparbetat ofakturerat arbete, avslutade har inte", async () => {
    const { c } = await simulateDemo();
    const matters = (await c.matter.list({})).matters as Any[];
    const privat = matters.filter((m: Any) => m.paymentMethod === "PRIVAT" || m.paymentMethod === "MIX");

    const unbilledOre = async (m: Any): Promise<number> => {
      const p = await c.billingRun.proposal({ matterId: m.id });
      return (p.timeEntries as Any[]).filter((t) => t.billable).reduce((s: number, t: Any) => s + t.valueOre, 0);
    };

    const open = privat.filter((m: Any) => m.status === "ACTIVE");
    expect(open.length, "seeden har öppna privatärenden").toBeGreaterThan(0);
    const openOre = await Promise.all(open.map(unbilledOre));
    expect(openOre.every((v) => v > 0), "varje öppet privatärende har ofakturerat arbete").toBe(true);

    // Motsatsen är lika viktig: ofakturerat arbete på ett avslutat ärende går
    // inte att fakturera — det vore inte demodata utan en bugg.
    const closed = privat.filter((m: Any) => m.status !== "ACTIVE");
    expect(closed.length, "seeden har avslutade privatärenden").toBeGreaterThan(0);
    const closedOre = await Promise.all(closed.map(unbilledOre));
    expect(closedOre.every((v) => v === 0), "avslutade privatärenden har inget ofakturerat").toBe(true);
  });

  /**
   * #882: kostnadsräkning som väntar på dom. Varje offentligt uppdrag fick förr
   * beslut och domstolsfaktura samma vecka, så fakturapanelens väntetillstånd
   * (mellan inlämnad KR och domstolens beslut) fanns inte i demon — trots att
   * panelen har en egen vy för det, och trots att seedens beskrivning av 2026-0018
   * säger att KR:n går till domstol.
   */
  it("ett offentligt uppdrag står kvar med kostnadsräkning som väntar på dom", async () => {
    const { c } = await simulateDemo();
    const runs = (await c.billingRun.list({})).runs as Any[];
    const kr = runs.filter((r) => r.type === "KOSTNADSRAKNING");
    expect(kr.length, "demon har kostnadsräkningar").toBeGreaterThan(0);
    expect(kr.some((r) => r.status === "PENDING_VERDICT"), "en KR väntar på dom").toBe(true);
    // …och de övriga har fått sitt beslut, så båda tillstånden syns.
    expect(kr.some((r) => r.status !== "PENDING_VERDICT"), "en KR är avgjord").toBe(true);
  });

  /**
   * #950: advokatberedskapens garantiersättning. Kategorin ersätts per DYGN och
   * bär noll minuter, så varje väg som räknar `minuter × taxa` ger tyst noll —
   * demon är därför den bästa grinden mot att den försvinner igen. Här påstås
   * dessutom att BÅDA utfallen finns i datan: en beredskapsdag som ersätts, och
   * en som förbrukats av en helgförhandling (DVFS 2025:9 § 2).
   */
  it("brottmålen har beredskapsdygn — både ersatta och förbrukade", async () => {
    const { c } = await simulateDemo();
    const matters = (await c.matter.list({})).matters as Any[];
    const brottmal = matters.filter((m: Any) => m.paymentMethod === "OFFENTLIGT_UPPDRAG");
    expect(brottmal.length, "seeden har brottmål").toBeGreaterThan(0);

    const entries = (await Promise.all(brottmal.map(async (m: Any) => {
      const res = await c.timeEntry.list({ matterId: m.id, pageSize: 100 });
      return (res.entries ?? res.timeEntries ?? []) as Any[];
    }))).flat();

    const beredskap = entries.filter((t: Any) => t.kind === "ADVOKATBEREDSKAP");
    expect(beredskap.length, "beredskapsdygn finns").toBeGreaterThan(0);
    expect(beredskap.every((t: Any) => t.minutes === 0), "beredskap bär noll minuter").toBe(true);

    // Minst ett dygn krockar med en helgförhandling → § 2 slår till någonstans.
    const day = (d: unknown) => new Date(String(d)).toISOString().slice(0, 10);
    const obekvamDays = new Set(entries.filter((t: Any) => t.kind === "ARBETE_OBEKVAM_TID").map((t: Any) => day(t.date)));
    expect(beredskap.some((t: Any) => obekvamDays.has(day(t.date))), "en beredskapsdag är förbrukad av helgförhandling").toBe(true);
    expect(beredskap.some((t: Any) => !obekvamDays.has(day(t.date))), "en beredskapsdag ersätts").toBe(true);
  });

  /**
   * #950 steg 4: ett ärende ska visa HELA kategoribredden tillsammans med en
   * prutning och utlägg med olika momssatser — annars går sammanställningens
   * taxerader inte att granska mot verkligheten någonstans i demon.
   */
  it("ett brottmål använder alla arvodeskategorier + flera momssatser", async () => {
    const { c } = await simulateDemo();
    const matters = (await c.matter.list({})).matters as Any[];

    const spreads = await Promise.all(matters.map(async (m: Any) => {
      const te = await c.timeEntry.list({ matterId: m.id, pageSize: 100 });
      const ex = await c.expense.list({ matterId: m.id, pageSize: 100 });
      return {
        kinds: new Set(((te.entries ?? te.timeEntries ?? []) as Any[]).map((t: Any) => t.kind ?? "ARBETE")),
        vatRates: new Set(((ex.expenses ?? ex.items ?? ex) as Any[]).map((e: Any) => e.vatRate)),
      };
    }));

    const ALL_KINDS = ["ARBETE", "ARBETE_OBEKVAM_TID", "TIDSSPILLAN", "TIDSSPILLAN_OVRIG_TID", "ADVOKATBEREDSKAP"];
    const full = spreads.find((s) => ALL_KINDS.every((k) => s.kinds.has(k)));
    expect(full, `inget ärende har alla kategorier: ${ALL_KINDS.join(", ")}`).toBeTruthy();
    expect(full!.vatRates.size, "…och mer än en momssats bland utläggen").toBeGreaterThan(1);
  });

  /**
   * #828 steg 6: demodata i ALLA lägen. Kostnadsräkningens state-maskin har fyra
   * statusar, och panelen har en egen vy per status — men demon visade bara två
   * (inskickad och fakturerad). Överklagandespåret fanns bara i koden: varken
   * "Överklaga prutning" eller "Registrera hovrättens beslut" gick att se.
   *
   * Testet påstår om DEMONS DATA att varje status finns som ett VILANDE
   * tillstånd. Att kunna klicka sig fram till dem räcker inte — då syns de
   * först efter att man ändrat data som ändå inte sparas.
   */
  it("kostnadsräkningens alla fyra statusar finns i demon samtidigt", async () => {
    const { c } = await simulateDemo();
    const runs = (await c.billingRun.list({})).runs as Any[];
    const kr = runs.filter((r) => r.type === "KOSTNADSRAKNING");
    const statuses = new Set(kr.map((r) => r.kostnadsrakningStatus));
    for (const s of ["INSKICKAD", "BESLUTAD", "OVERKLAGAD", "FAKTURERAD"]) {
      expect(statuses.has(s), `KR-status ${s} saknas i demon`).toBe(true);
    }
    // Den beslutade ska bära domstolens prutning — annars går det inte att se
    // VARFÖR man skulle överklaga, och prutningen är hela poängen med spåret.
    const beslutad = kr.find((r) => r.kostnadsrakningStatus === "BESLUTAD");
    expect(beslutad?.prutningOre, "beslutet bär en registrerad prutning").toBeLessThan(0);
    expect(beslutad?.awardedOre, "…och ett dömt belopp").toBeGreaterThan(0);
  });
});
