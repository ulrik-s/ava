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
import { pdfPageContents, pdfPageLayouts, pdfPageTexts, type PdfLineItem, type PdfPageLayout, type PdfTextItem } from "../../../helpers/pdf-text";
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
    expect(p1).toEqual(expect.arrayContaining(["Enligt bifogad specifikation", "tid/antal", "kr", "ARVODE", "1,5 á 1 626 kr", "TIDSSPILLAN", "1,5 á 1 487 kr", "UTLÄGG"]));
    // 1,5 h à 1 626 = 2 439 kr; tidsspillan 1,5 h à 1 487 = 2 230,50 → 2 231 kr (hela kronor, #1218); utlägg 152 kr.
    expect(p1.join("|")).toMatch(/2\s439,00 kr\|TIDSSPILLAN\|1,5 á 1\s487 kr\|2\s231,00 kr\|UTLÄGG\|152,00 kr/);
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
    expect(p2.join("|")).toContain("Arvode|2026-06-10|Genomgång av handlingar|0,5");
    expect(p2.join("|")).toContain("Summa|1,5|Tidsspillan");
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

describe("arbetsredogörelsens summarader (#1505)", () => {
  /** Avståndet sista post → summa före #1505 (radhöjd 12,6 + 2,5). */
  const OLD_GAP = 15.1;

  async function rightEdge(item: PdfTextItem): Promise<number> {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const name = item.font === "Times-Bold" ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman;
    const font = await (await PDFDocument.create()).embedFont(name);
    return item.x + font.widthOfTextAtSize(item.text, item.size);
  }

  /** Summaraden ("Summa" + beloppet) och raden före den. */
  function sumRow(page: PdfPageLayout, nth = 0): { label: PdfTextItem; value: PdfTextItem; previous: PdfTextItem } {
    const labels = page.texts.flatMap((t, i) => (t.text === "Summa" ? [i] : []));
    const at = labels[nth] ?? -1;
    const [previous, label, value] = [page.texts[at - 1], page.texts[at], page.texts[at + 1]];
    if (!previous || !label || !value) throw new Error("ingen summarad");
    return { label, value, previous };
  }

  function ruleBetween(page: PdfPageLayout, above: number, below: number): PdfLineItem | undefined {
    return page.lines.find((l) => l.y < above && l.y > below);
  }

  async function specPage(input: BuildInput = FORSVARARE): Promise<PdfPageLayout> {
    const [, p2] = await pdfPageLayouts(await renderBytes(input));
    if (!p2) throw new Error("ingen arbetsredogörelse");
    return p2;
  }

  it("tidssektionens summa är högerjusterad i timkolumnen, fet", async () => {
    const page = await specPage();
    for (const nth of [0, 1]) {
      const { label, value, previous } = sumRow(page, nth);
      expect(previous.text).toMatch(/^\d+(,\d{1,2})?$/); // sista postens timmar i decimaltimmar (#1543)
      expect(await rightEdge(value)).toBeCloseTo(await rightEdge(previous), 3);
      expect([label.font, value.font]).toEqual(["Times-Bold", "Times-Bold"]);
    }
  });

  it("utläggssektionens summa står i beloppskolumnen", async () => {
    const { value, previous } = sumRow(await specPage(), 2);
    expect(previous.text).toBe("152");
    expect(await rightEdge(value)).toBeCloseTo(await rightEdge(previous), 3);
  });

  it("ett tunt streck över talkolumnen, med luft mot sista posten och mot summan", async () => {
    const page = await specPage();
    for (const nth of [0, 1, 2]) {
      const { value, previous } = sumRow(page, nth);
      expect(previous.y - value.y).toBeGreaterThan(OLD_GAP + 5);
      const rule = ruleBetween(page, previous.y, value.y);
      if (!rule) throw new Error("inget streck före summan");
      expect(previous.y - rule.y).toBeGreaterThan(5);
      expect(rule.y - value.y).toBeGreaterThan(8);
      expect(rule.x1).toBeGreaterThan(400); // inte hela sidbredden
      expect(rule.x2).toBeCloseTo(await rightEdge(value), 0);
    }
  });

  it("strecket och summan hamnar på samma sida även när sektionen slutar vid sidslutet", async () => {
    let movedToNewPage = 0;
    for (let n = 34; n <= 42; n++) {
      const pages = (await pdfPageLayouts(await renderBytes({ ...FORSVARARE, timeEntries: arbete(n), expenses: [] }))).slice(1);
      const last = pages.at(-1);
      if (!last) throw new Error("ingen arbetsredogörelse");
      const label = last.texts.find((t) => t.text === "Summa");
      if (!label) throw new Error("summan saknas på sista sidan");
      expect(ruleBetween(last, label.y + 20, label.y)).toBeDefined();
      pages.slice(0, -1).forEach((p) => expect(p.lines.filter((l) => l.x1 > 400)).toEqual([]));
      if (pages.length > 1 && !last.texts.some((t) => t.text === "2026-06-10")) movedToNewPage++;
    }
    expect(movedToNewPage).toBeGreaterThan(0);
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
