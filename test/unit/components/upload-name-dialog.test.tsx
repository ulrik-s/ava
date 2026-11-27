/**
 * Namnrutan före uppladdning (#1614): förifyllt namn, hjälptext, Spara/Avbryt
 * och kön (en namnruta per fil, i tur och ordning). Mejl (`.eml`) förifylls
 * med ämnesraden (#1616).
 */

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import {
  defaultUploadName, readEmlSubject, UploadNameDialog, useUploadNameQueue, type NameQueueItem,
} from "@/components/documents/_upload-name-dialog";
import type { UploadOptions } from "@/components/documents/_use-file-upload";
import type { FolderSelectFolder } from "@/components/documents/folder-select";
import { cleanFileName } from "@/lib/shared/document-file-name";
import { asId, type DocumentFolderId } from "@/lib/shared/schemas/ids";

const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });
const eml = (name: string, body: string, type = "message/rfc822") => new File([body], name, { type });
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

function renderDialog(item: NameQueueItem | null, folders: FolderSelectFolder[] = []) {
  const onSave = vi.fn((_file: File, _options: UploadOptions) => {});
  const onNext = vi.fn();
  render(<UploadNameDialog item={item} folders={folders} onSave={onSave} onNext={onNext} />);
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
      <UploadNameDialog item={queue.current} folders={[]} onSave={onSave} onNext={queue.next} />
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

describe("readEmlSubject", () => {
  it("läser ämnet ur en .eml", async () => {
    expect(await readEmlSubject(eml("mejl.eml", "Subject: =?UTF-8?B?w6XDpMO2?=\r\n\r\nText"))).toBe("åäö");
  });

  it("känner igen mejl på mimetypen", async () => {
    expect(await readEmlSubject(eml("mejl", "Subject: Hej\r\n\r\n"))).toBe("Hej");
  });

  it("andra filer läses inte", async () => {
    expect(await readEmlSubject(new File(["Subject: Hej\r\n\r\n"], "a.txt", { type: "text/plain" }))).toBeNull();
  });

  it("ett läsfel ger null", async () => {
    const file = eml("mejl.eml", "Subject: Hej\r\n\r\n");
    const broken = Object.assign(file, { slice: () => ({ arrayBuffer: () => Promise.reject(new Error("läsfel")) }) });
    expect(await readEmlSubject(broken)).toBeNull();
  });
});

describe("UploadNameDialog: fältet Mapp (#1974)", () => {
  const other = asId<"DocumentFolderId">("f2");
  const FOLDERS: FolderSelectFolder[] = [
    { id: folder, name: "Domstol", parentId: null },
    { id: other, name: "Kallelse", parentId: folder },
  ];
  const folderSelect = () => screen.getByLabelText("Mapp");

  it("visar släppmålet förvalt", () => {
    renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: folder }, FOLDERS);
    expect(folderSelect()).toHaveValue(folder);
  });

  it("ett annat val sparas i den valda mappen", () => {
    const file = pdf("skiss.pdf");
    const { onSave } = renderDialog({ key: 1, file, folderId: folder }, FOLDERS);
    fireEvent.change(folderSelect(), { target: { value: other } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(onSave).toHaveBeenCalledWith(file, { folderId: other, fileName: "skiss.pdf" });
  });

  it("utan släppmål är Överst, utan mapp förvald", () => {
    renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: null }, FOLDERS);
    expect(folderSelect()).toHaveValue("");
    expect(screen.getByRole("option", { name: "Överst, utan mapp", selected: true })).toBeInTheDocument();
  });
});

describe("UploadNameDialog med mejl (#1616)", () => {
  it("släppt .eml med ämne → förifylld med ämnet; Spara → <ämne>.eml", async () => {
    const file = eml("x7f3.eml", "From: a@b.se\r\nSubject: =?UTF-8?Q?Ang=C3=A5ende_f=C3=B6rlikning?=\r\n\r\nText");
    const { onSave } = renderDialog({ key: 1, file, folderId: folder });
    await waitFor(() => expect(nameInput()).toHaveValue("Angående förlikning"));
    expect(screen.getByText("Sparas som: Angående förlikning.eml")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(onSave).toHaveBeenCalledWith(file, { folderId: folder, fileName: "Angående förlikning.eml" });
  });

  it(".eml utan ämne → filnamnet utan ändelse", async () => {
    const { onSave } = renderDialog({ key: 1, file: eml("mejl.eml", "From: a@b.se\r\n\r\nText"), folderId: null });
    await act(async () => { await Promise.resolve(); });
    expect(nameInput()).toHaveValue("mejl");
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(onSave).toHaveBeenCalledWith(expect.any(File), { folderId: null, fileName: "mejl.eml" });
  });

  it("ett namn som användaren redan skrivit skrivs inte över av ämnet", async () => {
    renderDialog({ key: 1, file: eml("mejl.eml", "Subject: Ämnet\r\n\r\n"), folderId: null });
    fireEvent.change(nameInput(), { target: { value: "Eget namn" } });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(nameInput()).toHaveValue("Eget namn");
  });

  it("stängs rutan innan ämnet lästs händer inget", async () => {
    const item = { key: 1, file: eml("mejl.eml", "Subject: Ämnet\r\n\r\n"), folderId: null };
    const { rerender } = render(<UploadNameDialog item={item} folders={[]} onSave={vi.fn()} onNext={vi.fn()} />);
    rerender(<UploadNameDialog item={null} folders={[]} onSave={vi.fn()} onNext={vi.fn()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("PDF → filnamnet", async () => {
    renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: null });
    await act(async () => { await Promise.resolve(); });
    expect(nameInput()).toHaveValue("skiss");
  });
});

describe("UploadNameDialog: förslaget i Mapp (#1975)", () => {
  const domstol = asId<"DocumentFolderId">("domstol");
  const kallelse = asId<"DocumentFolderId">("kallelse");
  const avtal = asId<"DocumentFolderId">("avtal");
  const ovrigt = asId<"DocumentFolderId">("ovrigt");
  const korr = asId<"DocumentFolderId">("korr");
  const TREE: FolderSelectFolder[] = [
    { id: domstol, name: "Domstol", parentId: null },
    { id: kallelse, name: "Kallelse", parentId: domstol },
    { id: avtal, name: "Avtal", parentId: null },
    { id: ovrigt, name: "Övrigt", parentId: null },
    { id: korr, name: "Korrespondens", parentId: null },
  ];
  const folderSelect = () => screen.getByLabelText("Mapp");

  it("utan släppmål visar Mapp förslaget ur filnamnet direkt", () => {
    renderDialog({ key: 1, file: pdf("Kallelse HF.pdf"), folderId: null }, TREE);
    expect(folderSelect()).toHaveValue(kallelse);
  });

  it("förslaget följer när namnet skrivs om, och sparas i den mappen", () => {
    const file = pdf("skiss.pdf");
    const { onSave } = renderDialog({ key: 1, file, folderId: null }, TREE);
    expect(folderSelect()).toHaveValue(ovrigt);
    fireEvent.change(nameInput(), { target: { value: "Hyresavtal" } });
    expect(folderSelect()).toHaveValue(avtal);
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(onSave).toHaveBeenCalledWith(file, { folderId: avtal, fileName: "Hyresavtal.pdf" });
  });

  it("ett mejl: Korrespondens, och Domstol › Kallelse när ämnesraden fylls i", async () => {
    renderDialog({ key: 1, file: eml("x7f3.eml", "Subject: Kallelse till huvudförhandling\r\n\r\nText"), folderId: null }, TREE);
    await waitFor(() => expect(nameInput()).toHaveValue("Kallelse till huvudförhandling"));
    expect(folderSelect()).toHaveValue(kallelse);
    fireEvent.change(nameInput(), { target: { value: "Angående mötet" } });
    expect(folderSelect()).toHaveValue(korr);
  });

  it("efter ett eget val ändras mappen inte när namnet ändras", () => {
    renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: null }, TREE);
    fireEvent.change(folderSelect(), { target: { value: domstol } });
    fireEvent.change(nameInput(), { target: { value: "Hyresavtal" } });
    expect(folderSelect()).toHaveValue(domstol);
  });

  it("med släppmål ändras mappen inte när namnet ändras", () => {
    renderDialog({ key: 1, file: pdf("skiss.pdf"), folderId: domstol }, TREE);
    fireEvent.change(nameInput(), { target: { value: "Kallelse" } });
    expect(folderSelect()).toHaveValue(domstol);
  });
});
