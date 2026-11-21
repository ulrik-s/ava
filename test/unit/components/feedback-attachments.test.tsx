/**
 * Bilagorna i förfrågningsknappen (#1788): välja, se dem, ta bort, högst
 * fem — och användarens egna bilagor i dialogen: bilder som miniatyrer,
 * dokument som nedladdningslänkar.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import type { ImageCodec, PickedAttachment } from "@/lib/client/feedback/feedback-attachments";

let file: { data?: { type: string; data: string } } = {};
vi.mock("@/lib/client/backend/server-feedback", () => ({ useFeedbackAttachment: () => file }));

const { AttachmentPicker, FeedbackAttachments } = await import("@/components/shell/feedback-attachments");

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const codec: ImageCodec = { reencode: (f) => Promise.resolve(f) };
const png = (n: number): File => new File([new Uint8Array([n])], `kund-${n}.png`, { type: "image/png" });
const chosen = (n: number): PickedAttachment => ({ type: "image/png", data: `D${n}`, preview: `data:image/png;base64,D${n}` });
const doc: PickedAttachment = { type: DOCX, data: "RE9D", preview: null };

async function choose(input: HTMLElement, files: File[] | null): Promise<void> {
  await act(async () => { fireEvent.change(input, { target: { files } }); await Promise.resolve(); });
}

describe("AttachmentPicker", () => {
  it("valda filer läggs till utan filnamn; bilder visas, dokument som typ; Ta bort tar bort; varningen syns", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<AttachmentPicker attachments={[]} onChange={onChange} codec={codec} />);
    expect(screen.getByText(/Ta bort klientnamn, personnummer och ärendeuppgifter/)).toBeInTheDocument();
    await choose(screen.getByLabelText(/Bifoga fil/), [png(1), new File(["x"], "mall-andersson.docx", { type: "" })]);
    const added = onChange.mock.calls.at(-1)?.[0] as PickedAttachment[];
    expect(added.map((a) => a.type)).toEqual(["image/png", DOCX]);
    expect(JSON.stringify(added)).not.toContain("andersson");
    rerender(<AttachmentPicker attachments={[chosen(1), doc]} onChange={onChange} codec={codec} />);
    expect(screen.getByRole("img", { name: "Bild 1" })).toBeInTheDocument();
    expect(screen.getByText("Word 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ta bort Bild 1" }));
    expect(onChange).toHaveBeenLastCalledWith([doc]);
  });

  it("högst fem: överskottet tas inte med, och knappen försvinner vid fem", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<AttachmentPicker attachments={[1, 2, 3, 4].map(chosen)} onChange={onChange} codec={codec} />);
    await choose(screen.getByLabelText(/Bifoga fil/), [png(5), png(6)]);
    expect(onChange.mock.calls.at(-1)?.[0] as PickedAttachment[]).toHaveLength(5);
    expect(screen.getByRole("alert")).toHaveTextContent("Högst 5 bilagor.");
    rerender(<AttachmentPicker attachments={[1, 2, 3, 4, 5].map(chosen)} onChange={onChange} codec={codec} />);
    expect(screen.queryByLabelText(/Bifoga fil/)).not.toBeInTheDocument();
  });

  it("en fil av fel typ ger besked och läggs inte till; ingen fil gör ingenting", async () => {
    const onChange = vi.fn();
    render(<AttachmentPicker attachments={[]} onChange={onChange} codec={codec} />);
    await choose(screen.getByLabelText(/Bifoga fil/), [new File(["x"], "a.txt", { type: "text/plain" })]);
    expect(screen.getByRole("alert")).toHaveTextContent("Bara bilder (PNG, JPEG, WebP), PDF och Word- eller Excel-dokument");
    expect(onChange).toHaveBeenLastCalledWith([]);
    await choose(screen.getByLabelText(/Bifoga fil/), null);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("FeedbackAttachments", () => {
  it("inga bilagor: inget; en bild laddas och visas som miniatyr; ett dokument blir en nedladdningslänk", () => {
    const { container, rerender } = render(<FeedbackAttachments number={1} paths={[]} />);
    expect(container).toBeEmptyDOMElement();
    file = {};
    rerender(<FeedbackAttachments number={1} paths={["attachments/2026-11/a.png"]} />);
    expect(screen.getByLabelText("Bilaga 1 laddas")).toBeInTheDocument();
    file = { data: { type: "image/png", data: "QUJD" } };
    rerender(<FeedbackAttachments number={1} paths={["attachments/2026-11/b.png"]} />);
    expect(screen.getByRole("img", { name: "Bild 1" })).toHaveAttribute("src", "data:image/png;base64,QUJD");
    expect(screen.getByRole("link", { name: "Visa Bild 1" })).toHaveAttribute("target", "_blank");
    file = { data: { type: DOCX, data: "RE9D" } };
    rerender(<FeedbackAttachments number={1} paths={["attachments/2026-11/c.docx"]} />);
    expect(screen.getByRole("link", { name: /Word 1/ })).toHaveAttribute("download", "bilaga-1.docx");
  });
});
