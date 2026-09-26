/**
 * Byråns små bilder (#1218): logga och sidfotsmärke på kostnadsräkningen.
 *
 * Lagras som `data:`-URL direkt på organisationsraden — de är små, byråunika
 * och ska följa med i synk/export utan ett separat blob-lager. Därför en
 * storleksgräns och en typkontroll här, i zod, där den externa datan tolkas.
 *
 * Bara PNG och JPEG: PDF:en ritas med pdf-lib, som kan bädda in just de två
 * (SVG kan inte bäddas in som bild).
 */

import { z } from "zod";

/** Största tillåtna bild (avkodade byte). */
export const ORG_IMAGE_MAX_BYTES = 300 * 1024;

/** Bildtyperna som kan bäddas in i både HTML och PDF. */
export const orgImageMimeSchema = z.enum(["image/png", "image/jpeg"]);
export type OrgImageMime = z.infer<typeof orgImageMimeSchema>;

const DATA_URL = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Antal avkodade byte i en base64-sträng. */
function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}

/** En byråbild som `data:image/png|jpeg;base64,…`, högst `ORG_IMAGE_MAX_BYTES`. */
export const orgImageSchema = z
  .string()
  .regex(DATA_URL, "Bilden måste vara PNG eller JPEG (data-URL).")
  .refine((s) => base64Bytes(s.slice(s.indexOf(",") + 1)) <= ORG_IMAGE_MAX_BYTES, `Bilden får vara högst ${ORG_IMAGE_MAX_BYTES / 1024} kB.`)
  .brand<"OrgImage">();
export type OrgImage = z.infer<typeof orgImageSchema>;

/** Bildens typ och avkodade byte (för pdf-lib). */
export function decodeOrgImage(image: OrgImage): { mime: OrgImageMime; bytes: Uint8Array } {
  const [, mime = "", b64 = ""] = DATA_URL.exec(image) ?? [];
  return { mime: orgImageMimeSchema.parse(mime), bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) };
}
