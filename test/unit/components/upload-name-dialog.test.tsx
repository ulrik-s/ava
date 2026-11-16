/**
 * Namnrutan före uppladdning (#1614): förifyllt namn, hjälptext, Spara/Avbryt
 * och kön (en namnruta per fil, i tur och ordning).
 */

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import {
  defaultUploadName, UploadNameDialog, useUploadNameQueue, type NameQueueItem,
} from "@/components/documents/_upload-name-dialog";
import type { UploadOptions } from "@/components/documents/_use-file-upload";
import { cleanFileName } from "@/lib/shared/document-file-name";
import { asId, type DocumentFolderId } from "@/lib/shared/schemas/ids";

const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });
const folder = asId<"DocumentFolderId">("f1");

describe("defaultUploadName", () => {
  it("tar bort ändelsen", () => expect(defaultUploadName("skiss.pdf")).toBe("skiss"));
  it("behåller namn utan ändelse", () => expect(defaultUploadName("README")).toBe("README"));
  it("tar bara bort den sista ändelsen", () => expect(defaultUploadName("avtal.v2.final.docx")).toBe("avtal.v2.final"));
  it("ett namn som bara är en ändelse behålls", () => expect(defaultUploadName(".pdf")).toBe(".pdf"));
});

describe("sparat namn (cleanFileName)", () => {
  it("lägger tillbaka ändelsen", () => expect(cleanFileName("Avtal", "skiss.pdf")).toBe("Avtal.pdf"));
  it("tomt → null", () => expect(cleanFileName("  ", "skiss.pdf")).toBeNull());
});

function renderDialog(item: NameQueueItem | null) {
  const onSave = vi.fn((_file: File, _options: UploadOptions) => {});
  const onNext = vi.fn();
  render(<UploadNameDialog item={item} onSave={onSave} onNext={onNext} />);
  return { onSave, onNext };
}

const nameInput = () => screen.getByLabelText("Namn");

describe("UploadNameDialog", () => {
  it("visas inte utan fil", () => {
    renderDialog(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("är förifylld med filens namn utan ändelse och visar det sparade namnet", () => {
    renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: null });
    expect(nameInput()).toHaveValue("skiss");
    expect(screen.getByText("Sparas som: skiss.pdf")).toBeInTheDocument();
  });

  it("Spara → onSave med städat namn och målmapp, sedan nästa fil", () => {
    const file = pdf("skiss.pdf");
    const { onSave, onNext } = renderDialog({ key: 1, file, folderId: folder });
    fireEvent.change(nameInput(), { target: { value: "Avtal" } });
    expect(screen.getByText("Sparas som: Avtal.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(onSave).toHaveBeenCalledWith(file, { folderId: folder, fileName: "Avtal.pdf" });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("Avbryt → ingen uppladdning, nästa fil", () => {
    const { onSave, onNext } = renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: null });
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("krysset och Esc laddar inte upp", () => {
    const { onSave, onNext } = renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: null });
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it("tomt namn → Spara inaktiverad och Enter sparar inte", () => {
    const { onSave } = renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: null });
    fireEvent.change(nameInput(), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
    expect(screen.getByText("Ange ett namn.")).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Namnge dokumentet" }));
    expect(onSave).not.toHaveBeenCalled();
  });
});

/** Kön + dialogen ihop, som i DocumentBrowser. */
function QueueHarness({ files, folderId, onSave }: {
  files: File[]; folderId: DocumentFolderId | null; onSave: (file: File, options: UploadOptions) => void;
}) {
  const queue = useUploadNameQueue();
  return (
    <>
      <button type="button" onClick={() => queue.enqueue(files, folderId)}>öppna</button>
      <UploadNameDialog item={queue.current} onSave={onSave} onNext={queue.next} />
    </>
  );
}

describe("useUploadNameQueue", () => {
  it("är tom från början", () => {
    const { result } = renderHook(() => useUploadNameQueue());
    expect(result.current.current).toBeNull();
  });

  it("två filer → två namnrutor i tur och ordning; Avbryt på första sparar ändå den andra", () => {
    const onSave = vi.fn((_file: File, _options: UploadOptions) => {});
    const second = pdf("svaromal.pdf");
    render(<QueueHarness files={[pdf("stamning.pdf"), second]} folderId={folder} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "öppna" }));
    expect(nameInput()).toHaveValue("stamning");
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(nameInput()).toHaveValue("svaromal");
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(second, { folderId: folder, fileName: "svaromal.pdf" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("nya filer läggs sist i kön", () => {
    const { result } = renderHook(() => useUploadNameQueue());
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    act(() => result.current.enqueue([a], null));
    act(() => result.current.enqueue([b], folder));
    expect(result.current.current?.file).toBe(a);
    act(() => result.current.next());
    expect(result.current.current).toMatchObject({ file: b, folderId: folder });
  });
});
