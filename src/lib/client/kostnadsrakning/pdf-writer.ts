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
}

/** Rutan en bild skalas in i (bevarat bildförhållande). `top` = överkant. */
export interface ImageBox {
  x: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  /** x är bildens mitt (center) eller vänsterkant (left). */
  align: "center" | "left";
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
  "∽": "~",
};

export class PdfWriter {
  readonly pages: PDFPage[] = [];
  private current: PDFPage;
  private readonly charsets = new Map<PDFFont, Set<number>>();

  constructor(private readonly pdf: PDFDocument, readonly fonts: PdfFonts, private readonly rgb: (r: number, g: number, b: number) => RGB) {
    this.current = this.addPage();
  }

  /** Ny sida (blir den aktuella). */
  addPage(): PDFPage {
    const page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
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
    this.current.drawText(safe, { x: left, y: PAGE_HEIGHT - top, size, font: this.fonts[font], color: this.colour(opts.grey) });
    return w;
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

  /** Vågrät linje på avståndet `top` från överkanten. */
  rule(x1: number, x2: number, top: number, thickness: number, grey = false): void {
    const y = PAGE_HEIGHT - top;
    this.current.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: grey ? this.rgb(0.75, 0.75, 0.75) : this.rgb(0, 0, 0) });
  }

  /** Omvänd tilde (∽) som vektor — WinAnsi saknar tecknet. `x` = vänsterkant. */
  tilde(x: number, top: number, size: number): void {
    const s = size / 8;
    this.current.drawSvgPath(`M0 0 C${1.2 * s} ${1.6 * s} ${2.4 * s} ${1.6 * s} ${3.6 * s} 0 S${6 * s} ${-1.6 * s} ${7.2 * s} 0`, {
      x, y: PAGE_HEIGHT - top + size * 0.3, borderColor: this.rgb(0, 0, 0), borderWidth: 0.45,
    });
  }

  /**
   * Rita en byråbild (PNG/JPEG) inskalad i rutan. Returnerar false om bilden
   * inte gick att bädda in — anroparen faller då tillbaka på text.
   */
  async image(image: OrgImage, box: ImageBox): Promise<boolean> {
    const scaled = await embedOrgImage(this.pdf, image, box.maxWidth, box.maxHeight);
    if (!scaled) return false;
    const { embedded, width, height } = scaled;
    const x = box.align === "center" ? box.x - width / 2 : box.x;
    this.current.drawImage(embedded, { x, y: PAGE_HEIGHT - box.top - height, width, height });
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
