/**
 * Attributscheman för layoutspråket (ADR 0042). Varje element har ett strikt
 * zod-schema: ett okänt attribut eller ett ogiltigt värde blir ett
 * `LayoutError` med elementets namn och rad, aldrig en tyst gissning.
 *
 * Längder skrivs i punkter (`12`, `12pt`) eller millimeter (`45mm`). Färger
 * som `#rrggbb` eller som en grånivå 0–1 (`0.45`, 0 = svart).
 */

import { z } from "zod";
import type { LayoutColor } from "./layout-ast";
import { LayoutError, type MarkupElement } from "./markup-parser";

const PT_PER_MM = 72 / 25.4;

/** En längd i pt eller mm → punkter. Får vara negativ (t.ex. `space-before`). */
export const length = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?(?:mm|pt)?$/, "en längd som 12, 12pt eller 4.5mm")
  .transform((s) => (s.endsWith("mm") ? Number.parseFloat(s) * PT_PER_MM : Number.parseFloat(s)));

/** En längd som inte får vara negativ. */
export const size = length.refine((n) => n >= 0, "en längd som inte är negativ");

function hexColor(s: string): LayoutColor {
  const channel = (i: number): number => Number.parseInt(s.slice(i, i + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

/** `#rrggbb` eller en grånivå 0–1. */
export const color = z.union([
  z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(hexColor),
  z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/).transform((s): LayoutColor => {
    const g = Number.parseFloat(s);
    return [g, g, g];
  }),
], { error: "en färg som #rrggbb eller en grånivå mellan 0 och 1" });

const bool = z.enum(["true", "false"]).transform((s) => s === "true");
const align = z.enum(["left", "center", "right"]);

/** Teckensnitt, storlek och färg. `sans` = Helvetica också i ett Times-dokument. */
const fontShape = {
  font: z.enum(["regular", "bold", "italic", "sans"]).optional(),
  size: size.optional(),
  color: color.optional(),
};

/** Textstilens attribut (ärvs nedåt; `style` pekar på en `<style>`). */
const styleShape = { ...fontShape, style: z.string().min(1).optional(), leading: size.optional() };

/** Utrymmesattributen för flödeselement. */
const spacingShape = {
  keep: size.optional(),
  "space-before": length.optional(),
  "space-after": length.optional(),
};

/** Ett elementattributs tolkade värden per element. */
export const ATTRS = {
  document: z.strictObject({
    size: z.literal("A4").optional(),
    width: size.optional(),
    height: size.optional(),
    margin: size.optional(),
    "margin-top": size.optional(),
    "margin-right": size.optional(),
    "margin-bottom": size.optional(),
    "margin-left": size.optional(),
    "font-family": z.enum(["helvetica", "times"]).optional(),
    title: z.string().optional(),
    subject: z.string().optional(),
  }),
  style: z.strictObject({ ...fontShape, leading: size.optional(), name: z.string().min(1) }),
  band: z.strictObject({ pages: z.enum(["all", "first", "rest"]).optional(), top: size }),
  block: z.strictObject({
    at: z.enum(["window", "top-left", "top-right"]).optional(),
    x: size.optional(),
    top: size.optional(),
    width: size.optional(),
  }),
  text: z.strictObject({ ...styleShape, ...spacingShape, align: align.optional() }),
  u: z.strictObject({}),
  spacer: z.strictObject({ height: length }),
  "page-break": z.strictObject({}),
  rule: z.strictObject({ ...spacingShape, style: z.string().min(1).optional(), color: color.optional(), thickness: size.optional() }),
  image: z.strictObject({ ...spacingShape, src: z.string().min(1), width: size, height: size, align: align.optional() }),
  table: z.strictObject({ ...styleShape, "keep-extra": size.optional(), "repeat-header": bool.optional(), fill: color.optional() }),
  col: z.strictObject({ width: z.union([z.literal("*"), size]), align: align.optional(), wrap: bool.optional() }),
  section: z.strictObject({ keep: size.optional() }),
  row: z.strictObject({ ...styleShape, keep: size.optional(), "space-after": length.optional(), fill: color.optional() }),
  cell: z.strictObject({ ...fontShape, style: z.string().min(1).optional(), align: align.optional() }),
} as const;

/** Elementnamnen som har ett attributschema. */
type AttrKind = keyof typeof ATTRS;

/** De tolkade attributen för ett element av sorten `K`. */
export type Attrs<K extends AttrKind> = z.output<(typeof ATTRS)[K]>;

/** Textstilens attribut, som de står på ett element. */
export type StyleAttrs = Partial<Pick<Attrs<"text">, "style" | "font" | "size" | "color" | "leading">>;

/** Läsbart felmeddelande för ett zod-fel på ett element. */
function describe(el: MarkupElement, error: z.ZodError): string {
  const issues = error.issues.map((i) => {
    const key = i.path.join(".");
    if (i.code === "unrecognized_keys") return `okänt attribut ${i.keys.map((k) => `"${k}"`).join(", ")}`;
    return key ? `"${key}": ${i.message}` : i.message;
  });
  return `Rad ${el.line}: <${el.name}> — ${issues.join("; ")}.`;
}

/** Validera ett elements attribut mot ett schema ur `ATTRS`. Kastar `LayoutError`. */
export function attrsOf<S extends z.ZodType>(schema: S, el: MarkupElement): z.output<S> {
  const parsed = schema.safeParse(el.attrs);
  if (!parsed.success) throw new LayoutError(describe(el, parsed.error));
  return parsed.data;
}
