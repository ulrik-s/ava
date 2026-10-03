/**
 * `renderKostnadsrakningPdf` — client-side PDF (pdf-lib) av en kostnadsräkning
 * i byråns layout (#1218): sida 1 = sammanställning (inget sidnummer), sida 2+
 * = arbetsredogörelse med "Sida N". Texten läses tillbaka ur PDF:en.
 * Endast syntetisk data.
 */
import { describe, it, expect } from "vitest-compat";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import { renderKostnadsrakningPdf } from "@/lib/client/kostnadsrakning/render-pdf";
import { buildKostnadsrakningContext, type BuildInput, type TimeEntryInput } from "@/lib/shared/kostnadsrakning";
import { FOOTER_SEPARATOR } from "@/lib/shared/kostnadsrakning-document";
import { KOSTNADSRAKNING_DEFAULT_HTML } from "@/lib/shared/kostnadsrakning-template";
import { pdfPageContents, pdfPageTexts } from "../../../helpers/pdf-text";
import { BROKEN_PNG, TINY_JPEG, TINY_PNG } from "../../../helpers/tiny-images";

const ORG = {
  name: "Testbyrån Advokater AB", orgNumber: "556000-0001", address: "Testvägen 2, 123 45 TESTSTAD",
  phone: "010-000 00 00", email: "kontakt@testbyran.se", bankgiro: "111-2222",
};

function arbete(n: number, description = "Genomgång av handlingar"): TimeEntryInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `a${i}`, date: "2026-06-10", description, minutes: 30, kind: "ARBETE" as const }));
}

const FORSVARARE: BuildInput = {
  matter: { matterNumber: "T-0001", title: "Syntetiskt brottmål", courtCaseNumber: "B 1-26" },
  defender: { name: "Test Testsson", title: "Advokat" },
  organization: ORG,
  courtName: "Teststads tingsrätt",
  hufStart: new Date("2026-06-20T09:00:00"), hufEnd: new Date("2026-06-20T09:00:00"),
  yrkandeDate: new Date("2026-06-24T12:00:00"),
  isTaxeArende: false,
  timeEntries: [
    ...arbete(3),
    { id: "s1", date: "2026-06-11", description: "Tidsspillan resa t/r", minutes: 90, kind: "TIDSSPILLAN" },
  ],
  expenses: [{ id: "e1", date: "2026-06-11", description: "Milersättning t/r", amount: 15_200, vatRate: 2500, vatIncluded: false, quantity: 16, unitPriceOre: 950 }],
};

async function renderBytes(input: BuildInput): Promise<Uint8Array> {
  const result = buildKostnadsrakningContext(input);
  return renderKostnadsrakningPdf({
    result,
    meta: { matterNumber: input.matter.matterNumber, matterTitle: input.matter.title, clientName: "", courtName: input.courtName ?? "", defenderName: input.defender.name },
  });
}

async function render(input: BuildInput): Promise<string[][]> {
  const bytes = await renderBytes(input);
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
  return pdfPageTexts(bytes);
}

describe("renderKostnadsrakningPdf — sida 1 (sammanställning)", () => {
  it("brevhuvud, mottagare via e-post, rubrik med målnummer, referens och bankgiro", async () => {
    const [p1] = await render(FORSVARARE);
    expect(p1).toEqual(expect.arrayContaining([
      "Testbyrån Advokater AB", "Teststads tingsrätt", "via e-post", "KOSTNADSRÄKNING i mål B 1-26",
      "Faktura-/ärendenr: ", "T-0001 Anges vid betalning", "Bankgiro: 111-2222",
    ]));
  });

  it("sammanställningen: grå rubrikrad, kategorirader med á-pris, utlägg och summor", async () => {
    const [p1 = []] = await render(FORSVARARE);
    expect(p1).toEqual(expect.arrayContaining(["Enligt bifogad specifikation", "tid/antal", "kr", "ARVODE", "1,50 á 1 626 kr", "TIDSSPILLAN", "1,50 á 1 487 kr", "UTLÄGG"]));
    // 1,5 h à 1 626 = 2 439 kr; tidsspillan 1,5 h à 1 487 = 2 230,50 → 2 231 kr (hela kronor, #1218); utlägg 152 kr.
    expect(p1.join("|")).toMatch(/2\s439,00 kr\|TIDSSPILLAN\|1,50 á 1\s487 kr\|2\s231,00 kr\|UTLÄGG\|152,00 kr/);
    expect(p1).toEqual(expect.arrayContaining(["Belopp exkl. moms", "Moms (25%)", "Belopp inkl. moms"]));
    expect(p1.join("|")).toContain("Teststad den 24 juni 2026|Test Testsson|Advokat");
  });

  it("sidfoten: byrå, kontakt, bankgiro, VAT och F-skatt — delarna åtskilda av en mittpunkt", async () => {
    const [p1 = []] = await render(FORSVARARE);
    const footer = p1.join("|");
    for (const part of ["Tel: 010-000 00 00", "kontakt@testbyran.se", "Arvoden bankgiro 111-2222"]) expect(footer).toContain(part);
    expect(footer).toContain("VAT nr: SE556000000101 · Godkänd för F-skatt");
  });

  it("sidfotens tecken finns alla i teckensnittets kodning — inget ritas som ett trasigt tecken", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const charset = new Set(font.getCharacterSet());
    const doc = buildKostnadsrakningContext({ ...FORSVARARE, organization: { ...ORG, website: "https://www.testbyran.se/" } }).document;
    const text = doc.footerLines.map((parts) => parts.join(FOOTER_SEPARATOR)).join("");
    expect([...text].filter((c) => !charset.has(c.codePointAt(0) ?? 0))).toEqual([]);
    expect(text).toContain(FOOTER_SEPARATOR.trim());
  });

  it("sida 1 har inget sidnummer", async () => {
    const [p1 = []] = await render(FORSVARARE);
    expect(p1.some((t) => t.startsWith("Sida "))).toBe(false);
  });

  it("rådgivningsnotisen står efter summorna och före ort/datum", async () => {
    const [p1 = []] = await render({ ...FORSVARARE, matter: { ...FORSVARARE.matter, radgivningPaid: true } });
    const notice = p1.findIndex((t) => t.startsWith("Rådgivningstimme (1 tim) har redan fakturerats"));
    expect(notice).toBeGreaterThan(p1.indexOf("Belopp inkl. moms"));
    expect(notice).toBeLessThan(p1.findIndex((t) => t.startsWith("Teststad den")));
  });

  it("utan domstol, målnummer och byrå: inget mottagarblock, rubriken utan mål", async () => {
    const { courtName: _court, ...utanDomstol } = FORSVARARE;
    const [p1 = []] = await render({ ...utanDomstol, matter: { matterNumber: "T-2", title: "x" }, organization: {}, hasFTax: false });
    expect(p1).not.toContain("via e-post");
    expect(p1).toContain("KOSTNADSRÄKNING");
    expect(p1.join("|")).not.toContain("Godkänd för F-skatt");
  });
});

describe("renderKostnadsrakningPdf — arbetsredogörelsen", () => {
  it("sida 2: rubrik, avsnitt per kategori med Summa, utlägg med antal/á-pris och Sida 2", async () => {
    const pages = await render(FORSVARARE);
    expect(pages).toHaveLength(2);
    const p2 = pages[1] ?? [];
    expect(p2[0]).toBe("ARBETSREDOGÖRELSE");
    expect(p2.join("|")).toContain("Arvode|2026-06-10|Genomgång av handlingar|0,50");
    expect(p2.join("|")).toContain("Summa|1,50|Tidsspillan");
    expect(p2.join("|")).toContain("Utlägg|2026-06-11|Milersättning t/r|16|9,50|152|Summa|152");
    expect(p2.at(-1)).toBe("Sida 2");
  });

  it("långa redogörelser bryts över flera sidor, var och en numrerad", async () => {
    const long = "Mycket lång beskrivning av utfört arbete som måste radbrytas över flera rader i kolumnen för att rymmas inom sidans bredd";
    const pages = await render({ ...FORSVARARE, timeEntries: arbete(60, long), expenses: [] });
    expect(pages.length).toBeGreaterThan(3);
    pages.slice(1).forEach((p, i) => expect(p.at(-1)).toBe(`Sida ${i + 2}`));
    expect(pages.at(-1)).toContain("Summa");
  });

  it("utan tid och utlägg blir det ingen arbetsredogörelse", async () => {
    const pages = await render({ ...FORSVARARE, timeEntries: [], expenses: [] });
    expect(pages).toHaveLength(1);
  });

  it("tecken som WinAnsi saknar ersätts i stället för att spräcka PDF:en", async () => {
    const pages = await render({ ...FORSVARARE, timeEntries: [{ id: "u", date: "2026-06-10", description: "Resa A → B ≥ 2 mil 🚗", minutes: 60, kind: "ARBETE" }] });
    expect(pages[1]).toContain("Resa A -> B ? 2 mil ?");
  });
});

describe("renderKostnadsrakningPdf — taxeärenden", () => {
  it("brottmålstaxa: taxeraden och noterna på sida 1, HUF i redogörelsen (ingår i taxan)", async () => {
    const pages = await render({
      ...FORSVARARE, isTaxeArende: true, taxaLevel: 1,
      hufStart: new Date("2026-06-20T09:00:00"), hufEnd: new Date("2026-06-20T11:10:00"),
    });
    expect(pages[0]).toContain("ARVODE ENLIGT BROTTMÅLSTAXAN");
    expect((pages[0] ?? []).some((t) => t.startsWith("Brottmålstaxa (DVFS 2025:6), nivå 1"))).toBe(true);
    expect(pages[1]).toContain("Arvode (ingår i taxan)");
    expect(pages[1]).toContain("Huvudförhandling kl. 09:00–11:10");
  });
});

describe("byråns webbplats, logga och sidfotsmärke (#1218)", () => {
  const branded: BuildInput = { ...FORSVARARE, organization: { ...ORG, website: "https://www.testbyran.se/", logo: TINY_PNG, footerSeal: TINY_JPEG } };

  it("PDF: loggan ersätter namnet i brevhuvudet, märket ritas i sidfoten, webbplatsen i sidfotsraden", async () => {
    const bytes = await renderBytes(branded);
    const [p1 = []] = await pdfPageTexts(bytes);
    expect(p1[0]).toBe("Teststads tingsrätt"); // inget namn som brevhuvud
    expect(p1.join("|")).toContain("www.testbyran.se");
    const [c1 = ""] = await pdfPageContents(bytes);
    expect(c1.match(/ Do/g)).toHaveLength(2); // logga + märke
  });

  it("PDF: en bild som inte går att läsa faller tillbaka på byråns namn", async () => {
    const bytes = await renderBytes({ ...FORSVARARE, organization: { ...ORG, logo: BROKEN_PNG, footerSeal: BROKEN_PNG } });
    const [p1 = []] = await pdfPageTexts(bytes);
    expect(p1[0]).toBe("Testbyrån Advokater AB");
    const [c1 = ""] = await pdfPageContents(bytes);
    expect(c1).not.toMatch(/ Do/);
  });

  it("HTML: loggan och märket som bilder, webbplatsen i sidfoten", () => {
    const html = renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, buildKostnadsrakningContext(branded).templateContext);
    expect(html).toContain('<div class="letterhead"><img src="data:image/png;base64,');
    expect(html).toContain('<img class="seal" src="data:image/jpeg;base64,');
    expect(html).toContain("www.testbyran.se");
    const plain = renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, buildKostnadsrakningContext(FORSVARARE).templateContext);
    expect(plain).toContain('<div class="letterhead">Testbyrån Advokater AB</div>');
    expect(plain).not.toContain('class="seal"');
  });
});
