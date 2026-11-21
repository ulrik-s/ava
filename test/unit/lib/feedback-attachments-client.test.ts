/**
 * Bilagan förbereds i webbläsaren (#1788): rätt typ (även ur ändelsen när
 * webbläsaren inte vet), bilder omkodade (då försvinner metadata) och
 * nedskalade, dokument som de är, högst 10 MB, aldrig filnamnet.
 */
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import {
  ACCEPT, browserCodec, type ImageCodec, MAX_IMAGE_DIMENSION, pickAttachment, toUpload, typeOfFile,
} from "@/lib/client/feedback/feedback-attachments";
import { MAX_FEEDBACK_ATTACHMENT_BYTES } from "@/lib/shared/feedback";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const blob = (type: string, bytes = [1, 2, 3]): Blob => new Blob([new Uint8Array(bytes)], { type });
const codec = (out: Blob): ImageCodec => ({ reencode: () => Promise.resolve(out) });

describe("typeOfFile och ACCEPT", () => {
  it("webbläsarens typ, annars ändelsen; okänt är null", () => {
    expect(typeOfFile(blob("application/pdf"))).toBe("application/pdf");
    expect(typeOfFile(new File(["x"], "Mall.DOCX", { type: "" }))).toBe(DOCX);
    expect(typeOfFile(new File(["x"], "anteckning.txt", { type: "text/plain" }))).toBeNull();
    expect(typeOfFile(blob(""))).toBeNull();
    expect(ACCEPT).toContain(".docx");
    expect(ACCEPT).toContain("application/pdf");
  });
});

describe("pickAttachment", () => {
  it("en bild kodas om och får förhandsvisning — utan filnamn", async () => {
    const r = await pickAttachment(new File(["x"], "kund-andersson.png", { type: "image/png" }), codec(blob("image/png", [65, 66, 67])));
    expect(r).toEqual({ ok: true, attachment: { type: "image/png", data: "QUJD", preview: "data:image/png;base64,QUJD" } });
    if (r.ok) expect(toUpload([r.attachment])).toEqual([{ type: "image/png", data: "QUJD" }]);
  });

  it("ett dokument skickas som det är, utan förhandsvisning och utan att kodas om", async () => {
    const reencode = vi.fn();
    const r = await pickAttachment(new File([new Uint8Array([65, 66, 67])], "mall.docx", { type: "" }), { reencode });
    expect(r).toEqual({ ok: true, attachment: { type: DOCX, data: "QUJD", preview: null } });
    expect(reencode).not.toHaveBeenCalled();
  });

  it("fel typ, för stor, eller en fil som inte går att läsa ger ett besked", async () => {
    expect(await pickAttachment(blob("text/plain"), codec(blob("image/png")))).toEqual({ ok: false, error: "Bara bilder (PNG, JPEG, WebP), PDF och Word- eller Excel-dokument går att bifoga." });
    const big = { size: MAX_FEEDBACK_ATTACHMENT_BYTES + 1 } as Blob; // ponytail: bara storleken läses — ingen 10 MB-blob i testet
    expect(await pickAttachment(blob("image/jpeg"), codec(big))).toEqual({ ok: false, error: "Filen är större än 10 MB." });
    const broken: ImageCodec = { reencode: () => Promise.reject(new Error("trasig")) };
    expect(await pickAttachment(blob("image/webp"), broken)).toEqual({ ok: false, error: "Filen gick inte att läsa." });
  });
});

describe("browserCodec", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function stubCanvas(out: Blob | null) {
    const drawImage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", () => Promise.resolve({ width: 5120, height: 2560, close }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage });
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => { cb(out); });
    return { drawImage, close, toBlob };
  }

  it("ritar om bilden nedskalad till högst 2560 px och sparar den i samma typ", async () => {
    const out = blob("image/png");
    const s = stubCanvas(out);
    expect(await browserCodec.reencode(blob("image/png"), "image/png")).toBe(out);
    expect(s.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, MAX_IMAGE_DIMENSION, 1280);
    expect(s.close).toHaveBeenCalled();
    expect(s.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", 0.9);
  });

  it("ger ett fel om canvasen inte kan spara bilden", async () => {
    stubCanvas(null);
    await expect(browserCodec.reencode(blob("image/png"), "image/png")).rejects.toThrow("Bilden gick inte att läsa.");
  });
});
