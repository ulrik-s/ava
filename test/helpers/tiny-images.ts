/**
 * Minsta giltiga PNG och JPEG (1×1 px) som data-URL — syntetiska testbilder
 * för byråns logga/sidfotsmärke (#1218). pdf-lib kan bädda in båda.
 */
import { orgImageSchema, type OrgImage } from "@/lib/shared/org-image";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const JPEG_B64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

export const TINY_PNG: OrgImage = orgImageSchema.parse(`data:image/png;base64,${PNG_B64}`);
export const TINY_JPEG: OrgImage = orgImageSchema.parse(`data:image/jpeg;base64,${JPEG_B64}`);
/** Giltig data-URL-form men inte en riktig PNG — ska falla tillbaka på text. */
export const BROKEN_PNG: OrgImage = orgImageSchema.parse("data:image/png;base64,AAAA");
export const TINY_PNG_BYTES: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
