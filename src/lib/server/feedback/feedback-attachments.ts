/**
 * Bilagor i förfrågningar (#1788): kontroll vid förtroendegränsen, sparande i
 * intag-repot och länkarna i issuens text.
 *
 * Bilagan kontrolleras här och inte bara i klienten: typen ska stämma med de
 * första byten (en PDF börjar med `%PDF-`, ett Word-dokument är en zip eller
 * ett äldre OLE-dokument), storleken med gränsen. Den sparas under ett slumpat
 * namn — användarens filnamn kan innehålla klientnamn och skickas aldrig.
 * Länkarna pekar på filen i det privata repot; användaren når den genom
 * `feedback.attachment`, som bara lämnar ut bilagor i hennes egna förfrågningar.
 */
import { TRPCError } from "@trpc/server";
import {
  ATTACHMENT_EXT, attachmentKind, FEEDBACK_ATTACHMENT_PATH, FEEDBACK_ATTACHMENT_TYPES, type FeedbackAttachment,
  type FeedbackAttachmentType, MAX_FEEDBACK_ATTACHMENT_BYTES,
} from "@/lib/shared/feedback";
import { stockholmDay } from "@/lib/shared/stockholm-time";
import type { IFeedbackSink } from "../ports";

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean => sig.every((x, i) => b[at + i] === x);
const bytesOf = (text: string): number[] => [...new TextEncoder().encode(text)];

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Stämmer byten med typen? (docx/xlsx är zip-filer, doc/xls OLE-dokument.) */
const MAGIC: Readonly<Record<FeedbackAttachmentType, (b: Uint8Array) => boolean>> = {
  "image/png": (b) => startsWith(b, PNG),
  "image/jpeg": (b) => startsWith(b, JPEG),
  "image/webp": (b) => startsWith(b, bytesOf("RIFF")) && startsWith(b, bytesOf("WEBP"), 8),
  "application/pdf": (b) => startsWith(b, bytesOf("%PDF-")),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => startsWith(b, ZIP),
  "application/msword": (b) => startsWith(b, OLE),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b) => startsWith(b, ZIP),
  "application/vnd.ms-excel": (b) => startsWith(b, OLE),
};

/** Bilagan som byte, eller ett fel som säger vad som är fel med den. */
export function checkAttachment(a: FeedbackAttachment): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(a.data, "base64"));
  if (bytes.length > MAX_FEEDBACK_ATTACHMENT_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "En bilaga är större än 10 MB." });
  if (!MAGIC[a.type](bytes)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `En av filerna är inte den ${attachmentKind(a.type).toLowerCase()}-fil den säger sig vara.` });
  }
  return bytes;
}

/** Var bilagan sparas: `attachments/<år-månad>/<uuid>.<typ>` (månaden i svensk tid). */
export const attachmentPath = (type: FeedbackAttachmentType, now: Date, id: string): string =>
  `attachments/${stockholmDay(now).slice(0, 7)}/${id}.${ATTACHMENT_EXT[type]}`;

/** Typen för en sparad bilaga, ur filändelsen. */
export function attachmentTypeOf(path: string): FeedbackAttachmentType {
  const ext = path.split(".").at(-1) ?? "";
  const type = FEEDBACK_ATTACHMENT_TYPES.find((t) => ATTACHMENT_EXT[t] === ext);
  if (!type || !FEEDBACK_ATTACHMENT_PATH.test(path)) throw new TRPCError({ code: "NOT_FOUND", message: "Bilagan finns inte." });
  return type;
}

/** En länk till en bilaga i issuens text (en per rad); bilder visas som bilder. Sökvägen är gruppen. */
const ATTACHMENT_LINE = /^!?\[(?:Bild|PDF|Word|Excel) \d+\]\(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/main\/(attachments\/[\w/.-]+)\?raw=true\)$/;

/** Raderna med länkar till bilagorna, numrerade i ordning. */
export function attachmentMarkdown(saved: ReadonlyArray<{ type: FeedbackAttachmentType; url: string }>): string {
  return saved.map(({ type, url }, i) => {
    const kind = attachmentKind(type);
    return `${kind === "Bild" ? "!" : ""}[${kind} ${i + 1}](${url}?raw=true)`;
  }).join("\n");
}

/** Bilagornas sökvägar i en text. */
export function attachmentPathsIn(body: string): string[] {
  return body.split("\n").flatMap((line) => {
    const path = ATTACHMENT_LINE.exec(line.trim())?.[1];
    return path !== undefined && FEEDBACK_ATTACHMENT_PATH.test(path) ? [path] : [];
  });
}

/** Texten utan länkarna till bilagorna. */
export const withoutAttachments = (body: string): string => body.split("\n").filter((line) => !ATTACHMENT_LINE.test(line.trim())).join("\n");

/** Kontrollera och spara bilagorna i intag-repot; ger deras typ och länk i samma ordning. */
export async function uploadAttachments(
  sink: IFeedbackSink, attachments: readonly FeedbackAttachment[], now: Date,
): Promise<Array<{ type: FeedbackAttachmentType; url: string }>> {
  const checked = attachments.map((a) => ({ a, bytes: checkAttachment(a) }));
  const saved: Array<{ type: FeedbackAttachmentType; url: string }> = [];
  for (const { a, bytes } of checked) {
    const { url } = await sink.attach(attachmentPath(a.type, now, crypto.randomUUID()), Buffer.from(bytes).toString("base64"));
    saved.push({ type: a.type, url });
  }
  return saved;
}
