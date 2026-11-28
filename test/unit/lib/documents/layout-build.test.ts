/**
 * `buildLayout` (#2251, ADR 0042): layoutmarkeringen valideras och blir ett
 * typat träd — stilar ärvs, längder blir punkter och allt okänt är ett fel
 * med rad och element.
 */
import { describe, it, expect } from "vitest-compat";
import type { BlockNode, FlowNode, LayoutDocument, TableNode, TextNode } from "@/lib/shared/documents/layout-ast";
import { buildLayout } from "@/lib/shared/documents/layout-build";
import { LayoutError } from "@/lib/shared/documents/markup-parser";

const doc = (body: string, attrs = ""): LayoutDocument => buildLayout(`<document ${attrs}>${body}</document>`);
const first = (body: string, attrs = ""): FlowNode => {
  const node = doc(body, attrs).body[0];
  if (!node) throw new Error("tomt dokument");
  return node;
};
const textOf = (body: string, attrs = ""): TextNode => {
  const n = first(body, attrs);
  if (n.kind !== "text") throw new Error(n.kind);
  return n;
};
/** Tabellen i ett 595 pt brett dokument → innehållsytan 495 pt. */
const tableOf = (body: string): TableNode => {
  const n = first(body, `width="595"`);
  if (n.kind !== "table") throw new Error(n.kind);
  return n;
};
const blockOf = (body: string, attrs = ""): BlockNode => {
  const n = first(body, attrs);
  if (n.kind !== "block") throw new Error(n.kind);
  return n;
};
const fails = (markup: string, message: RegExp): void => {
  expect(() => buildLayout(markup)).toThrow(LayoutError);
  expect(() => buildLayout(markup)).toThrow(message);
};
const MM = 72 / 25.4;

describe("buildLayout — dokumentet", () => {
  it("standard: A4, 50 pt marginal, Helvetica, ingen titel", () => {
    expect(doc("")).toEqual({
      width: 595.28, height: 841.89, margins: { top: 50, right: 50, bottom: 50, left: 50 },
      fontFamily: "helvetica", title: "", subject: "", headers: [], footers: [], body: [],
    });
  });

  it("egen storlek, marginaler (pt och mm), teckensnitt och metadata", () => {
    const d = doc("", `size="A4" width="595" height="842" margin="20mm" margin-top="42" font-family="times" title="T" subject="S"`);
    expect(d).toMatchObject({ width: 595, height: 842, fontFamily: "times", title: "T", subject: "S" });
    expect(d.margins.top).toBe(42);
    expect(d.margins.left).toBeCloseTo(20 * MM, 6);
  });

  it("rotelementet måste vara <document>", () => {
    fails("<text>x</text>", /rotelementet måste vara <document>, inte <text>/);
  });

  it("okända attribut och ogiltiga värden ger rad och element", () => {
    fails(`<document colour="red"/>`, /Rad 1: <document> — okänt attribut "colour"/);
    fails(`<document>\n<text size="stor">x</text></document>`, /Rad 2: <text> — "size": en längd som 12, 12pt eller 4.5mm/);
    fails(`<document><text size="-2">x</text></document>`, /en längd som inte är negativ/);
    fails(`<document><text color="red">x</text></document>`, /en färg som #rrggbb eller en grånivå/);
    fails(`<document><text font="fet">x</text></document>`, /"font"/);
  });

  it("okända element listar de tillåtna", () => {
    fails("<document><para>x</para></document>", /<para> är inte tillåtet i <document> \(tillåtet: <text>, <image>, <table>/);
  });

  it("text direkt i <document> är fel", () => {
    fails("<document>lös text</document>", /text direkt i <document> — lägg den i <text> eller <cell>/);
  });
});

describe("buildLayout — text och stilar", () => {
  it("standardstil: 10 pt, normal, svart, radavstånd 1,4 × storleken; blanktecken komprimeras", () => {
    expect(textOf("<text>\n  Hej\n   världen  </text>")).toEqual({
      kind: "text", content: "Hej världen", spans: [{ text: "Hej världen", underline: false }], align: "left", keep: 0, spaceBefore: 0, spaceAfter: 0,
      style: { font: "regular", size: 10, color: [0, 0, 0], leading: 14 },
    });
  });

  it("namngiven stil först, elementets egna attribut går före", () => {
    const n = textOf(`<style name="dämpad" color="0.45" size="9" leading="12"/><text style="dämpad" size="11" align="right" keep="30" space-before="-4" space-after="2mm">x</text>`);
    expect(n.style).toEqual({ font: "regular", size: 11, color: [0.45, 0.45, 0.45], leading: 12 });
    expect(n).toMatchObject({ align: "right", keep: 30, spaceBefore: -4 });
    expect(n.spaceAfter).toBeCloseTo(2 * MM, 6);
  });

  it("färg som #rrggbb", () => {
    expect(textOf(`<text color="#ff8000">x</text>`).style.color).toEqual([1, 128 / 255, 0]);
  });

  it("odefinierad eller dubbel stil är fel", () => {
    fails(`<document><text style="saknas">x</text></document>`, /pekar på stilen "saknas", som inte finns/);
    fails(`<document><style name="a"/><style name="a"/></document>`, /stilen "a" är redan definierad/);
  });

  it("<text> får bara innehålla text; <spacer> och <rule> inget alls", () => {
    fails("<document><text>a <b>fet</b></text></document>", /<text> får bara innehålla text och <u>, inte <b>/);
    fails(`<document><spacer height="2"><text>x</text></spacer></document>`, /<spacer> får inte innehålla <text>/);
  });
});

describe("buildLayout — <u> och font=\"sans\" (tillägg #2255)", () => {
  it("<u> ger understrukna delar; blanktecken komprimeras över gränserna", () => {
    const n = textOf("<text>  Ange <u> endast  fakturanummer</u>\n vid betalning tack!  </text>");
    expect(n.content).toBe("Ange endast fakturanummer vid betalning tack!");
    expect(n.spans).toEqual([
      { text: "Ange ", underline: false },
      { text: "endast fakturanummer", underline: true },
      { text: " vid betalning tack!", underline: false },
    ]);
  });

  it("understruket först och sist; intilliggande delar slås ihop; tom text ger en tom del", () => {
    expect(textOf("<text><u>a</u><u> b </u></text>").spans).toEqual([{ text: "a b", underline: true }]);
    expect(textOf("<text>x<u> </u></text>").spans).toEqual([{ text: "x", underline: false }]);
    expect(textOf("<text><u></u></text>").spans).toEqual([{ text: "", underline: false }]);
  });

  it("<u> utan attribut, bara text, och bara i <text>", () => {
    fails(`<document><text><u x="1">a</u></text></document>`, /<u> — okänt attribut "x"/);
    fails(`<document><text><u>a <u>b</u></u></text></document>`, /<u> får bara innehålla text, inte <u>/);
    fails(`<document><table><col width="1"/><row><cell><u>a</u></cell></row></table></document>`, /<cell> får bara innehålla text, inte <u>/);
    fails(`<document><u>a</u></document>`, /<u> är inte tillåtet i <document>/);
  });

  it("font=\"sans\" på stil, text och cell", () => {
    expect(textOf(`<style name="sidfot" font="sans" size="8"/><text style="sidfot">x</text>`).style).toMatchObject({ font: "sans", size: 8 });
    expect(textOf(`<text font="sans">x</text>`).style.font).toBe("sans");
    fails(`<document><text font="mono">x</text></document>`, /"font"/);
  });
});

describe("buildLayout — rule, spacer, page-break, image", () => {
  it("rule: standard 0,5 pt svart; färg ur stil eller eget attribut", () => {
    expect(first("<rule/>")).toEqual({ kind: "rule", thickness: 0.5, color: [0, 0, 0], keep: 0, spaceBefore: 0, spaceAfter: 0 });
    expect(first(`<style name="linje" color="0.72"/><rule style="linje" thickness="1.2"/>`)).toMatchObject({ thickness: 1.2, color: [0.72, 0.72, 0.72] });
    expect(first(`<style name="linje"/><rule style="linje"/>`)).toMatchObject({ color: [0, 0, 0] });
    expect(first(`<rule color="#000000"/>`)).toMatchObject({ color: [0, 0, 0] });
  });

  it("spacer, page-break och image", () => {
    expect(first(`<spacer height="-3"/>`)).toEqual({ kind: "spacer", height: -3 });
    expect(first(`<page-break/>`)).toEqual({ kind: "page-break" });
    expect(first(`<image src="logo" width="170" height="56" align="right"/>`)).toEqual({
      kind: "image", src: "logo", width: 170, height: 56, align: "right", keep: 0, spaceBefore: 0, spaceAfter: 0,
    });
    expect(first(`<image src="logo" width="1" height="1"/>`)).toMatchObject({ align: "left" });
  });
});

describe("buildLayout — block", () => {
  const PAGE = `width="600" height="800" margin="50"`;

  it("at=\"window\": fönsterkuvertets adressfält (H2), 110 mm in, 45 mm ned, 80 mm brett", () => {
    const b = blockOf(`<block at="window"><text>Klient AB</text></block>`);
    expect(b.x).toBeCloseTo(110 * MM, 6);
    expect(b.top).toBeCloseTo(45 * MM, 6);
    expect(b.width).toBeCloseTo(80 * MM, 6);
    expect(b.children).toHaveLength(1);
  });

  it("at=\"top-left\" och \"top-right\" utgår från marginalerna", () => {
    expect(blockOf(`<block at="top-left"/>`, PAGE)).toMatchObject({ x: 50, top: 50, width: 500 });
    expect(blockOf(`<block at="top-left" width="100"/>`, PAGE)).toMatchObject({ width: 100 });
    expect(blockOf(`<block at="top-right" top="27" width="170"/>`, PAGE)).toMatchObject({ x: 380, top: 27, width: 170 });
    expect(blockOf(`<block at="top-right"/>`, PAGE)).toMatchObject({ x: 50, width: 500 });
  });

  it("utan at: x och top krävs, bredden går till högermarginalen", () => {
    expect(blockOf(`<block x="300" top="10"/>`, PAGE)).toMatchObject({ x: 300, top: 10, width: 250 });
    fails(`<document><block x="1"/></document>`, /<block> behöver at="…" eller både x och top/);
  });

  it("blockets barn får blockets bredd som ram (tabellens *-kolumn)", () => {
    const b = blockOf(`<block x="0" top="0" width="200"><table><col width="50"/><col width="*"/></table></block>`);
    const [table] = b.children;
    expect(table?.kind === "table" && table.columns[1]?.width).toBe(150);
  });
});

describe("buildLayout — sidhuvud och sidfot", () => {
  it("page-header/page-footer med pages och top", () => {
    const d = doc(`<page-header top="20"><text>H</text></page-header><page-footer top="800" pages="rest"><text>F</text></page-footer><text>Kropp</text>`);
    expect(d.headers).toMatchObject([{ pages: "all", top: 20, children: [{ kind: "text", content: "H" }] }]);
    expect(d.footers).toMatchObject([{ pages: "rest", top: 800 }]);
    expect(d.body).toMatchObject([{ kind: "text", content: "Kropp" }]);
  });

  it("sidhuvudet kräver top", () => {
    fails(`<document><page-header/></document>`, /"top"/);
  });
});

describe("buildLayout — table", () => {
  const TABLE = `<table size="9" keep-extra="6" repeat-header="false">
    <col width="66"/><col width="*" wrap="true"/><col width="80" align="right"/>
    <thead keep="40"><row font="bold" leading="5"><cell>Datum</cell><cell>Text</cell><cell>Belopp</cell></row><rule/></thead>
    <row leading="12" space-after="2" keep="20"><cell>2026-05-02</cell><cell>Lång text</cell><cell align="left" font="italic">1 kr</cell></row>
    <rule keep="30"/>
    <row><cell/><cell style="dämpad">x</cell><cell/></row>
    <tfoot><row font="bold"><cell>Summa</cell><cell/><cell>1 kr</cell></row></tfoot>
  </table>`;

  it("kolumner, *-bredd, sektioner, rader och ärvda stilar", () => {
    const t = tableOf(`<style name="dämpad" color="0.45"/>${TABLE}`);
    expect(t.columns).toEqual([
      { offset: 0, width: 66, align: "left", wrap: false },
      { offset: 66, width: 349, align: "left", wrap: true },
      { offset: 415, width: 80, align: "right", wrap: false },
    ]);
    expect(t).toMatchObject({ repeatHeader: false, keepExtra: 6 });
    expect(t.head?.keep).toBe(40);
    expect(t.head?.items.map((i) => i.kind)).toEqual(["row", "rule"]);
    expect(t.foot?.keep).toBe(0);
    const [row, rule, plain] = t.body;
    expect(row).toMatchObject({ kind: "row", leading: 12, keep: 20, spaceAfter: 2 });
    expect(row?.kind === "row" && row.cells[2]).toMatchObject({ content: "1 kr", align: "left", style: { font: "italic", size: 9 } });
    expect(rule).toMatchObject({ kind: "rule", keep: 30 });
    expect(plain?.kind === "row" && plain.cells[1]?.style.color).toEqual([0.45, 0.45, 0.45]);
    expect(plain).toMatchObject({ leading: 9 * 1.4, keep: undefined, spaceAfter: 0 });
  });

  it("fill: på raden, eller tabellens som standard för alla rader (tillägg #2255)", () => {
    const t = tableOf(`<table fill="0.95"><col width="10"/><row><cell/></row><row fill="#ff0000"><cell/></row><tfoot><row><cell/></row></tfoot></table>`);
    const fills = [...t.body, ...(t.foot?.items ?? [])].map((i) => (i.kind === "row" ? i.fill : null));
    expect(fills).toEqual([[0.95, 0.95, 0.95], [1, 0, 0], [0.95, 0.95, 0.95]]);
    expect(tableOf(`<table><col width="10"/><row><cell/></row></table>`).body[0]).toMatchObject({ fill: undefined });
    fails(`<document><table><col width="10"/><row fill="grå"><cell/></row></table></document>`, /"fill": en färg som #rrggbb/);
  });

  it("standard: rubriken upprepas, ingen keep-extra", () => {
    expect(tableOf(`<table><col width="10"/></table>`)).toMatchObject({ repeatHeader: true, keepExtra: 0, head: undefined, foot: undefined, body: [] });
  });

  it("fel: saknade kolumner, fel antal celler, två *, för breda kolumner, dubbla sektioner, okända barn", () => {
    fails("<document><table/></document>", /<table> saknar <col>/);
    fails(`<document><table><col width="10"/><row><cell/><cell/></row></table></document>`, /<row> har 2 celler men tabellen har 1 kolumner/);
    fails(`<document><table><col width="*"/><col width="*"/></table></document>`, /bara en <col> per tabell får ha width="\*"/);
    fails(`<document width="595"><table><col width="600"/><col width="*"/></table></document>`, /kolumnerna är bredare än ramen \(600 > 495 pt\)/);
    fails(`<document><table><col width="1"/><thead/><thead/></table></document>`, /en tabell får bara ha en <thead>/);
    fails(`<document><table><col width="1"/><text>x</text></table></document>`, /<text> är inte tillåtet i <table>/);
    fails(`<document><table><col width="1"/><tfoot><text>x</text></tfoot></table></document>`, /<text> är inte tillåtet i <tfoot> \(tillåtet: <row>, <rule>\)/);
    fails(`<document><table><col width="1"/><row><text>x</text></row></table></document>`, /<text> är inte tillåtet i <row> \(tillåtet: <cell>\)/);
    fails(`<document><table><col width="1"/><row><cell leading="3"/></row></table></document>`, /okänt attribut "leading"/);
  });
});
