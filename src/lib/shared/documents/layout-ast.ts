/**
 * Dokumentmotorns typade layoutträd (ADR 0042) — det `buildLayout` gör av den
 * tolkade markeringen och det renderaren ritar. Alla stilar är färdigt ärvda
 * och alla längder är punkter, så renderaren behöver varken slå upp eller
 * räkna om något.
 *
 * Koordinater: `top` mäts från sidans överkant. Flödets markör är NÄSTA
 * BASLINJE — en text ritas på markören och flyttar den `leading` per rad.
 */

/**
 * Teckensnittets variant inom dokumentets familj — `sans` är Helvetica också i
 * ett Times-dokument (t.ex. en sidfot i sans-serif).
 */
export type LayoutFont = "regular" | "bold" | "italic" | "sans";

/** Dokumentets teckensnittsfamilj (pdf-libs standardteckensnitt). */
export type FontFamily = "helvetica" | "times";

/** Vågrät justering. */
export type LayoutAlign = "left" | "center" | "right";

/** En färg som RGB-andelar 0–1. */
export type LayoutColor = readonly [number, number, number];

/** En färdigt ärvd textstil. `leading` = avståndet mellan baslinjerna. */
export interface TextStyle {
  font: LayoutFont;
  size: number;
  color: LayoutColor;
  leading: number;
}

/** Utrymme före och efter ett flödeselement, och hur mycket plats det kräver. */
export interface FlowSpacing {
  /** Minsta utrymme (pt) under markören — annars bryts sidan före elementet. */
  keep: number;
  /** Markören flyttas så här långt före elementet (negativt = uppåt). */
  spaceBefore: number;
  spaceAfter: number;
}

/** En del av en text: `<u>…</u>` ger `underline`. */
export interface TextSpan {
  text: string;
  underline: boolean;
}

/** Löptext; radbryts inom ramens bredd. `content` = delarna ihopslagna. */
export interface TextNode extends FlowSpacing {
  kind: "text";
  content: string;
  /** Texten i delar, blanktecken komprimerade över gränserna (minst en del). */
  spans: TextSpan[];
  style: TextStyle;
  align: LayoutAlign;
}

/** Tomrum — flyttar markören. */
export interface SpacerNode {
  kind: "spacer";
  height: number;
}

/** Ny sida. */
export interface PageBreakNode {
  kind: "page-break";
}

/** Vågrät linje över ramens bredd, på markören. */
export interface RuleNode extends FlowSpacing {
  kind: "rule";
  thickness: number;
  color: LayoutColor;
}

/** En namngiven bild (t.ex. byråns logga), inskalad i rutan; överkanten på markören. */
export interface ImageNode extends FlowSpacing {
  kind: "image";
  src: string;
  width: number;
  height: number;
  align: LayoutAlign;
}

/** Ett fritt placerat block med eget flöde (bryter aldrig sidan). */
export interface BlockNode {
  kind: "block";
  x: number;
  top: number;
  width: number;
  children: FlowNode[];
}

/** En tabellkolumn. `wrap`: kolumnens text radbryts i tabellkroppens rader. */
export interface TableColumn {
  /** Vänsterkantens avstånd från tabellens vänsterkant (pt). */
  offset: number;
  width: number;
  align: LayoutAlign;
  wrap: boolean;
}

/** En tabellcell i sin kolumn. */
export interface TableCell {
  column: TableColumn;
  content: string;
  style: TextStyle;
  align: LayoutAlign;
}

/** En tabellrad. `keep` saknas → raderna × `leading` + tabellens `keepExtra`. */
export interface TableRow {
  kind: "row";
  cells: TableCell[];
  leading: number;
  keep: number | undefined;
  spaceAfter: number;
  /** Bakgrund bakom raden över tabellens bredd; `undefined` = ingen. */
  fill: LayoutColor | undefined;
}

/** Det en tabell kan innehålla mellan raderna. */
export type TableItem = TableRow | RuleNode;

/** `thead`/`tfoot`: hålls ihop (`keep`) och radbryts inte. */
export interface TableSection {
  keep: number;
  items: TableItem[];
}

/** En tabell med fasta kolumner. */
export interface TableNode {
  kind: "table";
  columns: TableColumn[];
  head: TableSection | undefined;
  body: TableItem[];
  foot: TableSection | undefined;
  repeatHeader: boolean;
  keepExtra: number;
}

/** Ett element i ett flöde. */
export type FlowNode = TextNode | SpacerNode | PageBreakNode | RuleNode | ImageNode | BlockNode | TableNode;

/** Vilka sidor ett sidhuvud eller en sidfot står på. */
export type BandPages = "all" | "first" | "rest";

/** Sidhuvud/sidfot: ritas på varje sida (enligt `pages`) med markören på `top`. */
export interface PageBand {
  pages: BandPages;
  top: number;
  children: FlowNode[];
}

/** Sidans marginaler (pt). `top` = första baslinjen. */
export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Ett helt dokument. */
export interface LayoutDocument {
  width: number;
  height: number;
  margins: PageMargins;
  fontFamily: FontFamily;
  title: string;
  subject: string;
  headers: PageBand[];
  footers: PageBand[];
  body: FlowNode[];
}
