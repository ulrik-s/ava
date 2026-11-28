"use client";

/**
 * `PdfWriter` — tunn rit-yta över pdf-lib för kostnadsräkningen (#1218).
 *
 * Koordinater anges som avstånd från sidans ÖVERKANT (`top`), som i en
 * layout, och räknas om till pdf-libs nedifrån-y här. Samlar teckensnitten,
 * radbrytning, höger-/centrering och ersättning av tecken som standard-
 * teckensnitten (WinAnsi) saknar — ett okänt tecken ska aldrig spräcka PDF:en.
 */

import type { PDFDocument, PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";
import { decodeOrgImage, type OrgImage } from "@/lib/shared/org-image";

/** A4 i punkter. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

/** Sidans storlek i punkter. */
export interface PageSize {
  width: number;
  height: number;
}

/** A4 (ISO 216) — standardstorleken för `PdfWriter`. */
const A4_SIZE: PageSize = { width: PAGE_WIDTH, height: PAGE_HEIGHT };

/** En färg som RGB-andelar 0–1 (pdf-libs `rgb(r, g, b)`). */
export type RgbTuple = readonly [number, number, number];

/** Teckensnitten dokumentet använder. */
export interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  sans: PDFFont;
}

export type FontKey = keyof PdfFonts;

/** Hur en textsträng ritas. */
export interface TextOpts {
  font?: FontKey;
  size?: number;
  /** x är vänsterkant (left), högerkant (right) eller mitt (center). */
  align?: "left" | "right" | "center";
  grey?: boolean;
  /** Exakt färg — går före `grey`. */
  color?: RgbTuple;
}

/** Rutan en bild skalas in i (bevarat bildförhållande). `top` = överkant. */
export interface ImageBox {
  x: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  /** x är bildens mitt (center), vänsterkant (left) eller högerkant (right). */
  align: "center" | "left" | "right";
}

/** En inbäddad byråbild, inskalad i en ruta (bevarat bildförhållande). */
export interface ScaledImage {
  embedded: PDFImage;
  width: number;
  height: number;
}

/**
 * Bädda in en byråbild (PNG/JPEG) och skala den så den ryms i
 * `maxWidth` × `maxHeight`. `null` om bilden inte går att bädda in — anroparen
 * ritar då utan bild. Delas av kostnadsräkningen och fakturan (#1439).
 */
export async function embedOrgImage(pdf: PDFDocument, image: OrgImage, maxWidth: number, maxHeight: number): Promise<ScaledImage | null> {
  try {
    const { mime, bytes } = decodeOrgImage(image);
    const embedded = mime === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height);
    return { embedded, width: embedded.width * scale, height: embedded.height * scale };
  } catch {
    return null;
  }
}

/** Tecken som saknas i WinAnsi men har en rimlig ersättning. */
const REPLACEMENTS: Readonly<Record<string, string>> = {
  "−": "-", // minustecken (sv-SE negativa tal)
  " ": " ", // smalt hårt mellanslag
  " ": " ",
  "→": "->",
};

/** Bildens vänsterkant: rutans x är vänsterkant, mitt eller högerkant. */
function imageLeft(box: ImageBox, width: number): number {
  if (box.align === "center") return box.x - width / 2;
  return box.align === "right" ? box.x - width : box.x;
}

export class PdfWriter {
  readonly pages: PDFPage[] = [];
  private current: PDFPage;
  private readonly charsets = new Map<PDFFont, Set<number>>();

  constructor(
    private readonly pdf: PDFDocument,
    readonly fonts: PdfFonts,
    private readonly rgb: (r: number, g: number, b: number) => RGB,
    readonly size: PageSize = A4_SIZE,
  ) {
    this.current = this.addPage();
  }

  /** Ny sida (blir den aktuella). */
  addPage(): PDFPage {
    const page = this.pdf.addPage([this.size.width, this.size.height]);
    this.pages.push(page);
    this.current = page;
    return page;
  }

  /** Byt ut tecken som teckensnittet inte kan koda. */
  safe(text: string, font: FontKey = "regular"): string {
    const set = this.charset(this.fonts[font]);
    return [...text].map((ch) => (set.has(ch.codePointAt(0) ?? 0) ? ch : this.replacement(ch, set))).join("");
  }

  private replacement(ch: string, set: Set<number>): string {
    const r = REPLACEMENTS[ch];
    return r !== undefined && [...r].every((c) => set.has(c.codePointAt(0) ?? 0)) ? r : "?";
  }

  private charset(font: PDFFont): Set<number> {
    const cached = this.charsets.get(font);
    if (cached) return cached;
    const set = new Set(font.getCharacterSet());
    this.charsets.set(font, set);
    return set;
  }

  /** Textens bredd i punkter. */
  width(text: string, font: FontKey, size: number): number {
    return this.fonts[font].widthOfTextAtSize(this.safe(text, font), size);
  }

  /** Rita text med `top` = baslinjens avstånd från överkanten. Returnerar bredden. */
  text(text: string, x: number, top: number, opts: TextOpts = {}): number {
    if (text === "") return 0;
    const font = opts.font ?? "regular";
    const size = opts.size ?? 12;
    const safe = this.safe(text, font);
    const w = this.fonts[font].widthOfTextAtSize(safe, size);
    const left = opts.align === "right" ? x - w : opts.align === "center" ? x - w / 2 : x;
    this.current.drawText(safe, { x: left, y: this.size.height - top, size, font: this.fonts[font], color: opts.color ? this.rgb(...opts.color) : this.colour(opts.grey) });
    return w;
  }

  /**
   * Kör `draw` med `page` som aktuell sida och återställ sedan — för det som
   * ritas på en tidigare sida i efterhand (sidhuvud, sidfot, sidnummer).
   */
  async withPage<T>(page: PDFPage, draw: () => Promise<T>): Promise<T> {
    const previous = this.current;
    this.current = page;
    try {
      return await draw();
    } finally {
      this.current = previous;
    }
  }

  /** Som `text`, men på en given (tidigare) sida — t.ex. sidnummer i efterhand. */
  textOn(page: PDFPage, text: string, x: number, top: number, opts: TextOpts = {}): number {
    const previous = this.current;
    this.current = page;
    try {
      return this.text(text, x, top, opts);
    } finally {
      this.current = previous;
    }
  }

  private colour(grey: boolean | undefined): RGB {
    return grey ? this.rgb(0.5, 0.5, 0.5) : this.rgb(0, 0, 0);
  }

  /** Vågrät linje på avståndet `top` från överkanten — grå, svart eller en exakt färg. */
  rule(x1: number, x2: number, top: number, thickness: number, grey: boolean | RgbTuple = false): void {
    const y = this.size.height - top;
    this.current.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: this.ruleColour(grey) });
  }

  /** Fylld rektangel (ingen ram) med överkanten `top` från sidans överkant. */
  rect(x: number, top: number, width: number, height: number, color: RgbTuple): void {
    this.current.drawRectangle({ x, y: this.size.height - top - height, width, height, color: this.rgb(...color) });
  }

  private ruleColour(grey: boolean | RgbTuple): RGB {
    if (typeof grey !== "boolean") return this.rgb(...grey);
    return grey ? this.rgb(0.75, 0.75, 0.75) : this.rgb(0, 0, 0);
  }

  /**
   * Rita en byråbild (PNG/JPEG) inskalad i rutan. Returnerar false om bilden
   * inte gick att bädda in — anroparen faller då tillbaka på text.
   */
  async image(image: OrgImage, box: ImageBox): Promise<boolean> {
    const scaled = await embedOrgImage(this.pdf, image, box.maxWidth, box.maxHeight);
    if (!scaled) return false;
    const { embedded, width, height } = scaled;
    this.current.drawImage(embedded, { x: imageLeft(box, width), y: this.size.height - box.top - height, width, height });
    return true;
  }

  /** Radbryt `text` så att varje rad ryms inom `maxWidth`. */
  wrap(text: string, font: FontKey, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.width(next, font, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    // Tom text ger en tom rad, så raden ändå tar sin plats i tabellen.
    return [...lines, line];
  }
}
