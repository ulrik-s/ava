/**
 * Bilagor i förfrågningsknappen (#1788): användaren väljer en skärmbild, en
 * PDF eller ett Word- eller Excel-dokument. Bilder kodas om i webbläsaren
 * innan de skickas — omkodningen via en canvas tar bort all metadata (EXIF:
 * plats, kamera, tidpunkt) och skalar ned stora bilder. Dokument skickas som
 * de är. Filnamnet följer aldrig med — det kan innehålla klientnamn.
 */
import {
  ATTACHMENT_EXT, FEEDBACK_ATTACHMENT_TYPES, type FeedbackAttachment, type FeedbackAttachmentType, type FeedbackImageType,
  isAttachmentType, isImageType, MAX_FEEDBACK_ATTACHMENT_BYTES,
} from "@/lib/shared/feedback";

/** Längsta sidan på en bild efter omkodningen (px). */
export const MAX_IMAGE_DIMENSION = 2560;

/** En vald bilaga: det som skickas, och förhandsvisningen för bilder. */
export interface PickedAttachment extends FeedbackAttachment { preview: string | null }

/** Omkodningen av bilder — utbytbar i tester (jsdom har ingen canvas). */
export interface ImageCodec { reencode(file: Blob, type: FeedbackImageType): Promise<Blob> }

/** Webbläsarens omkodning: rita om bilden på en canvas och spara den igen. */
export const browserCodec: ImageCodec = {
  async reencode(file, type) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error("Bilden gick inte att läsa.")); }, type, 0.9);
    });
  },
};

/** Det `accept`-attributet på filväljaren tar emot. */
export const ACCEPT = [...FEEDBACK_ATTACHMENT_TYPES, ...FEEDBACK_ATTACHMENT_TYPES.map((t) => `.${ATTACHMENT_EXT[t]}`)].join(",");

/** Filens typ: webbläsarens, eller ur ändelsen när den saknas (Word-filer får ibland ingen typ). */
export function typeOfFile(file: Blob & { name?: string }): FeedbackAttachmentType | null {
  if (isAttachmentType(file.type)) return file.type;
  const ext = file.name?.split(".").at(-1)?.toLowerCase() ?? "";
  return FEEDBACK_ATTACHMENT_TYPES.find((t) => ATTACHMENT_EXT[t] === ext) ?? null;
}

/** Byten som base64 (utan `data:`-prefix), i bitar så att stora filer inte spräcker anropsstacken. */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Utfallet för en vald fil. */
export type PickResult = { ok: true; attachment: PickedAttachment } | { ok: false; error: string };

const TOO_BIG = "Filen är större än 10 MB.";

/** Förbered en vald fil: rätt typ, bilder omkodade utan metadata, högst 10 MB. */
export async function pickAttachment(file: Blob & { name?: string }, codec: ImageCodec = browserCodec): Promise<PickResult> {
  const type = typeOfFile(file);
  if (type === null) return { ok: false, error: "Bara bilder (PNG, JPEG, WebP), PDF och Word- eller Excel-dokument går att bifoga." };
  try {
    const blob = isImageType(type) ? await codec.reencode(file, type) : file;
    if (blob.size > MAX_FEEDBACK_ATTACHMENT_BYTES) return { ok: false, error: TOO_BIG };
    const data = await toBase64(blob);
    return { ok: true, attachment: { type, data, preview: isImageType(type) ? `data:${type};base64,${data}` : null } };
  } catch {
    return { ok: false, error: "Filen gick inte att läsa." };
  }
}

/** Det som skickas: utan förhandsvisningen. */
export const toUpload = (attachments: readonly PickedAttachment[]): FeedbackAttachment[] => attachments.map(({ type, data }) => ({ type, data }));
