/**
 * Bilagornas kontroll och länkar (#1788): typen ska stämma med byten,
 * storleken med gränsen, och bara rätt formade länkar räknas.
 */
import { describe, expect, it } from "vitest-compat";
import {
  attachmentMarkdown, attachmentPath, attachmentPathsIn, attachmentTypeOf, checkAttachment, withoutAttachments,
} from "@/lib/server/feedback/feedback-attachments";
import { attachmentKind, MAX_FEEDBACK_ATTACHMENT_BYTES } from "@/lib/shared/feedback";

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString("base64");
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
const PATH = "attachments/2026-11/0b8f2c6e-1d2a-4c3b-9e8f-1234567890ab.png";
const DOC_PATH = "attachments/2026-11/1b8f2c6e-1d2a-4c3b-9e8f-1234567890ab.docx";
const base = "https://github.com/ulrik-s/ava-feedback/blob/main";

describe("checkAttachment", () => {
  it("godtar varje typ när byten stämmer med den", () => {
    const ok: Array<[Parameters<typeof checkAttachment>[0]["type"], number[]]> = [
      ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]],
      ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
      ["image/webp", [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]],
      ["application/pdf", [...Buffer.from("%PDF-1.7")]],
      [DOCX, ZIP], [XLSX, ZIP], ["application/msword", OLE], ["application/vnd.ms-excel", OLE],
    ];
    for (const [type, bytes] of ok) expect(checkAttachment({ type, data: b64(bytes) }).length).toBe(bytes.length);
  });

  it("avvisar en fil vars byte inte stämmer, och en för stor fil", () => {
    expect(() => checkAttachment({ type: "application/msword", data: b64(ZIP) })).toThrow("inte den word-fil den säger sig vara");
    expect(() => checkAttachment({ type: "image/jpeg", data: b64([0x89, 0x50]) })).toThrow("inte den bild-fil");
    const big = Buffer.alloc(MAX_FEEDBACK_ATTACHMENT_BYTES + 1, 0);
    big.set([...Buffer.from("%PDF-")]);
    expect(() => checkAttachment({ type: "application/pdf", data: big.toString("base64") })).toThrow("större än 10 MB");
  });
});

describe("sökvägar och länkar", () => {
  it("sökvägen: svensk år-månad och ett id, med typens ändelse — och tillbaka", () => {
    expect(attachmentPath(DOCX, new Date("2026-11-30T23:30:00Z"), "abc")).toBe("attachments/2026-12/abc.docx");
    expect(attachmentTypeOf(PATH)).toBe("image/png");
    expect(attachmentTypeOf(DOC_PATH)).toBe(DOCX);
    expect(() => attachmentTypeOf("attachments/2026-11/x.gif")).toThrow("Bilagan finns inte");
  });

  it("vad bilagan kallas: Bild, PDF, Word eller Excel", () => {
    expect([attachmentKind("image/webp"), attachmentKind("application/pdf"), attachmentKind("application/msword"), attachmentKind(XLSX)])
      .toEqual(["Bild", "PDF", "Word", "Excel"]);
  });

  it("bilder blir bildlänkar och dokument vanliga länkar, numrerade; de läses tillbaka och andra länkar räknas inte", () => {
    const md = attachmentMarkdown([{ type: "image/png", url: `${base}/${PATH}` }, { type: DOCX, url: `${base}/${DOC_PATH}` }]);
    expect(md).toBe(`![Bild 1](${base}/${PATH}?raw=true)\n[Word 2](${base}/${DOC_PATH}?raw=true)`);
    const body = `text\n${md}\n![Bild 3](${base}/attachments/2026-11/inte-ett-id.png?raw=true)\n[annat](https://example.com/a.pdf)`;
    expect(attachmentPathsIn(body)).toEqual([PATH, DOC_PATH]);
    expect(withoutAttachments(body)).toBe("text\n[annat](https://example.com/a.pdf)");
  });
});
