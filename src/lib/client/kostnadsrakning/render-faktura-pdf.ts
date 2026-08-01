"use client";

/**
 * `renderFakturaPdf` (#938) — faktura-PDF client-side via pdf-lib, med SAMMA
 * upplägg som det arkiverade HTML-dokumentet:
 *   sida 1  Sammanställning (rad per timtaxa, utlägg, moms, summa) + uppdelning
 *           klient/betalare + "att betala".
 *   sida 2+ Specifikation — tidsspecifikation + utläggsspecifikation, med
 *           automatisk sidbrytning när raderna inte får plats.
 *
 * Renderaren räknar INGENTING: den tar en färdig `FakturaView`
 * (`buildFakturaView` i `faktura-template.ts`), så bilagan som mejlas och
 * dokumentet som arkiveras aldrig kan visa olika belopp.
 *
 * Används av det manuella fakturautskicket (#179).
 */

import type { PDFDocument, PDFFont, PDFPage, RGB } from "pdf-lib";
import type { FakturaView } from "./faktura-template";

const A4: [number, number] = [595, 842];
const M = 50;
const RIGHT = 545;
const TOP = 800;
/** Under den här y:en får inget mer plats — bryt sidan. */
const BOTTOM = 64;

/**
 * WinAnsi (pdf-lib:s standardkodning för StandardFonts) kan inte koda t.ex.
 * U+2212 MINUS SIGN eller typografiska citattecken — pdf-lib KASTAR då i st.f.
 * att ersätta. Vy-modellen använder "−" för avdrag, så texten måste tvättas.
 * Svenska å/ä/ö ligger i Latin-1 och klarar sig.
 */
const WIN_ANSI_SUBST: Record<string, string> = {
  "−": "-", "–": "-", "—": "-",
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "…": "...", " ": " ",
};

export function toWinAnsi(s: string): string {
  return [...s]
    .map((c) => WIN_ANSI_SUBST[c] ?? c)
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0;
      // 0x00–0x1F och 0x7F–0x9F är styrtecken utan glyf i WinAnsi.
      if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp > 0xff) return "?";
      return c;
    })
    .join("");
}

interface Ctx {
  pdf: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  /** Färger — `rgb()` är en runtime-import ur pdf-lib, så de bärs i kontexten. */
  gray: RGB;
  rule: RGB;
}

interface TextOpts { x?: number; size?: number; b?: boolean; gray?: boolean }

function addPage(c: Ctx): void {
  c.page = c.pdf.addPage(A4);
  c.y = TOP;
}

/** Bryt sidan om `needed` punkter inte får plats under markören. */
function ensure(c: Ctx, needed: number): void {
  if (c.y - needed < BOTTOM) addPage(c);
}

function font(c: Ctx, b: boolean): PDFFont {
  return b ? c.bold : c.font;
}

/** Rita text vid markören (utan att flytta den). Returnerar textens bredd. */
function draw(c: Ctx, s: string, o: TextOpts = {}): number {
  const size = o.size ?? 10;
  const f = font(c, o.b ?? false);
  const t = toWinAnsi(s);
  c.page.drawText(t, {
    x: o.x ?? M, y: c.y, size, font: f,
    ...(o.gray ? { color: c.gray } : {}),
  });
  return f.widthOfTextAtSize(t, size);
}

/** Rita högerjusterad text med `rightX` som högerkant. */
function drawRight(c: Ctx, s: string, rightX: number, o: TextOpts = {}): void {
  const size = o.size ?? 10;
  const t = toWinAnsi(s);
  const w = font(c, o.b ?? false).widthOfTextAtSize(t, size);
  draw(c, s, { ...o, x: rightX - w });
}

/** Korta av texten så den ryms inom `maxWidth`. */
function fit(c: Ctx, s: string, maxWidth: number, o: TextOpts = {}): string {
  const size = o.size ?? 10;
  const f = font(c, o.b ?? false);
  let t = toWinAnsi(s);
  if (f.widthOfTextAtSize(t, size) <= maxWidth) return t;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

function rule(c: Ctx, thickness = 0.5): void {
  c.page.drawLine({ start: { x: M, y: c.y }, end: { x: RIGHT, y: c.y }, thickness, color: c.rule });
}

/** Ordbrytning — etiketter kan vara långa meningar (rådgivningsnotisen, info-
 *  rader ur nedbrytningen) och ska INTE kapas bort, som i HTML-mallen. */
function wrap(c: Ctx, s: string, maxWidth: number, size: number): string[] {
  const words = toWinAnsi(s).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (c.font.widthOfTextAtSize(next, size) > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Tabellrad med (ev. flerradig) etikett till vänster. `cells` ritar radens
 * övriga kolumner på FÖRSTA radens baslinje; markören flyttas sedan förbi hela
 * etiketten. Håller beloppen på rad med etikettens början även när den bryts.
 */
function labelRow(c: Ctx, label: string, maxLabelWidth: number, cells: () => void, o: TextOpts = {}): void {
  const size = o.size ?? 10;
  const lineH = size + 5;
  const lines = wrap(c, label, maxLabelWidth, size);
  ensure(c, lineH * lines.length + 5);
  cells();
  for (const line of lines) { draw(c, line, o); c.y -= lineH; }
}

// ── Sida 1: huvud + sammanställning + uppdelning ────────────────────────────

function drawHeader(c: Ctx, v: FakturaView): void {
  draw(c, v.heading.toUpperCase(), { size: 20, b: true });
  c.y -= 26;
  if (v.organizationName) { draw(c, v.organizationName, { b: true }); c.y -= 13; }
  if (v.organizationOrgNumber) { draw(c, `Org.nr ${v.organizationOrgNumber}`, { size: 9, gray: true }); c.y -= 13; }
  c.y -= 6;
  draw(c, `Ärende ${v.matterNumber} — ${v.matterTitle}`, { size: 11, b: true });
  c.y -= 16;
  draw(c, `Fakturanr: ${v.invoiceNumber}`);
  c.y -= 14;
  draw(c, `Fakturadatum: ${v.date}`);
  c.y -= 14;
  draw(c, `Mottagare: ${v.recipient}`);
  c.y -= 14;
  if (v.ocr) { draw(c, `OCR-referens: ${v.ocr}`, { b: true }); c.y -= 14; }
  c.y -= 8;
}

/** Kolumnernas högerkanter i sammanställningen (benämning flödar från M). */
const SUM_RATE_X = 385;
const SUM_HOURS_X = 440;

function drawSummary(c: Ctx, v: FakturaView): void {
  ensure(c, 90);
  draw(c, "Sammanställning", { size: 13, b: true });
  c.y -= 18;
  draw(c, "Benämning", { size: 9, b: true });
  drawRight(c, "Timtaxa", SUM_RATE_X, { size: 9, b: true });
  drawRight(c, "Tim", SUM_HOURS_X, { size: 9, b: true });
  drawRight(c, "Belopp", RIGHT, { size: 9, b: true });
  c.y -= 5;
  rule(c);
  c.y -= 13;
  for (const row of v.summary) {
    labelRow(c, row.label, SUM_RATE_X - M - 55, () => {
      if (row.rateLabel) drawRight(c, row.rateLabel, SUM_RATE_X);
      if (row.hours) drawRight(c, row.hours, SUM_HOURS_X);
      drawRight(c, row.amount, RIGHT);
    });
  }
  c.y += 3;
  rule(c);
  c.y -= 15;
  draw(c, "Summa (inkl moms)", { b: true });
  drawRight(c, v.summaryTotal, RIGHT, { b: true });
  c.y -= 22;
}

function drawSplit(c: Ctx, v: FakturaView): void {
  if (v.hasSplit) {
    ensure(c, 40);
    draw(c, "Uppdelning klient / betalare", { size: 11, b: true });
    c.y -= 16;
  }
  for (const row of v.splitRows) {
    const style: TextOpts = row.muted ? { gray: true } : {};
    labelRow(c, row.label, RIGHT - M - 110, () => drawRight(c, row.amount, RIGHT, style), style);
  }
  ensure(c, 40);
  c.y += 3;
  rule(c, 1.2);
  c.y -= 17;
  draw(c, v.totalLabel, { size: 12, b: true });
  drawRight(c, v.total, RIGHT, { size: 12, b: true });
  c.y -= 20;
  if (v.footnote) {
    ensure(c, 30);
    for (const line of wrap(c, v.footnote, RIGHT - M, 9)) { draw(c, line, { size: 9, gray: true }); c.y -= 12; }
  }
}

// ── Sida 2+: specifikationen ────────────────────────────────────────────────

const SPEC_DATE_W = 66;
const SPEC_HOURS_X = 445;

interface SpecCol { header: string; rightX: number }

/** Rita en specifikationstabells rubrikrad (datum + beskrivning + två tal). */
function specHead(c: Ctx, cols: [SpecCol, SpecCol]): void {
  draw(c, "Datum", { size: 9, b: true });
  draw(c, "Beskrivning", { size: 9, b: true, x: M + SPEC_DATE_W });
  drawRight(c, cols[0].header, cols[0].rightX, { size: 9, b: true });
  drawRight(c, cols[1].header, cols[1].rightX, { size: 9, b: true });
  c.y -= 5;
  rule(c);
  c.y -= 13;
}

/** En specifikationsrad: datum, beskrivning och tabellens två talkolumner. */
interface SpecRow { date: string; description: string; a: string; b: string }

function specRow(c: Ctx, r: SpecRow, cols: [SpecCol, SpecCol]): void {
  ensure(c, 20);
  draw(c, r.date, { size: 9 });
  draw(c, fit(c, r.description, cols[0].rightX - (M + SPEC_DATE_W) - 46, { size: 9 }), { size: 9, x: M + SPEC_DATE_W });
  drawRight(c, r.a, cols[0].rightX, { size: 9 });
  drawRight(c, r.b, cols[1].rightX, { size: 9 });
  c.y -= 14;
}

function drawTimeSpec(c: Ctx, v: FakturaView): void {
  if (v.timeLines.length === 0) return;
  const cols: [SpecCol, SpecCol] = [{ header: "Tim", rightX: SPEC_HOURS_X }, { header: "Belopp", rightX: RIGHT }];
  ensure(c, 60);
  draw(c, "Tidsspecifikation", { size: 11, b: true });
  c.y -= 16;
  specHead(c, cols);
  for (const l of v.timeLines) specRow(c, { date: l.date, description: l.description, a: l.hours, b: l.amount }, cols);
  c.y -= 8;
}

function drawExpenseSpec(c: Ctx, v: FakturaView): void {
  if (v.expenseLines.length === 0) return;
  const cols: [SpecCol, SpecCol] = [{ header: "Netto", rightX: 470 }, { header: "Brutto", rightX: RIGHT }];
  ensure(c, 60);
  draw(c, "Utläggsspecifikation", { size: 11, b: true });
  c.y -= 16;
  specHead(c, cols);
  for (const l of v.expenseLines) specRow(c, { date: l.date, description: l.description, a: l.net, b: l.gross }, cols);
}

/** Specifikationen börjar ALLTID på ny sida — speglar HTML-mallens sidbrytning. */
function drawSpecification(c: Ctx, v: FakturaView): void {
  if (!v.hasSpec) return;
  addPage(c);
  draw(c, "Specifikation", { size: 13, b: true });
  c.y -= 15;
  draw(c, "Underlag till beloppen i sammanställningen ovan.", { size: 9, gray: true });
  c.y -= 20;
  drawTimeSpec(c, v);
  drawExpenseSpec(c, v);
}

export async function renderFakturaPdf(view: FakturaView): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${view.heading} ${view.invoiceNumber}`);
  pdf.setSubject("Faktura");
  const c: Ctx = {
    pdf,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    page: pdf.addPage(A4),
    y: TOP,
    gray: rgb(0.45, 0.45, 0.45),
    rule: rgb(0.72, 0.72, 0.72),
  };
  drawHeader(c, view);
  drawSummary(c, view);
  drawSplit(c, view);
  drawSpecification(c, view);
  return pdf.save();
}
