/**
 * Tester för `GenerateModal` (#27) — klientsidig dokument-generering per ärende.
 *
 * Täcker mall-/mottagar-/format-väljarna + hela generera-orkestreringen
 * (handleGenerate → runGenerate → buildDocCtx → generateOneDoc → register):
 * ett dokument per vald mottagare (eller ett generellt utan val), fel-
 * hantering (mall utan innehåll) och laddnings-/tom-tillstånd. DOM-globaler
 * som happy-dom saknar (URL.createObjectURL, window.open) och FSA-skrivningen
 * stubbas; renderHandlebars mockas till en fast HTML-sträng.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { GenerateModal } from "@/app/matters/[id]/_generate-modal";

interface Tpl { id: string; name: string; category: string | null; content: string | null }
let templatesData: Tpl[] | undefined;
let templatesLoading = false;
let matterData: unknown;
let orgData: unknown;
const registerMutateAsync = vi.fn(async () => ({}));
const treeInvalidate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ document: { tree: { invalidate: treeInvalidate } } }),
    documentTemplate: { list: { useQuery: () => ({ data: templatesData, isLoading: templatesLoading }) } },
    matter: { getById: { useQuery: () => ({ data: matterData }) } },
    organization: { getSettings: { useQuery: () => ({ data: orgData }) } },
    document: { register: { useMutation: () => ({ mutateAsync: registerMutateAsync }) } },
  },
}));
vi.mock("@/lib/client/kostnadsrakning/render-handlebars", () => ({
  renderHandlebars: () => "<!doctype html><html><body>dokument</body></html>",
}));
vi.mock("@/lib/client/fsa/handle-store", () => ({ loadHandle: async () => null }));
vi.mock("@/lib/client/fsa/fs-adapter", () => ({
  FsaIsoGitAdapter: class { writeFile = async (): Promise<void> => {}; },
}));

const contacts = [
  { id: "mc1", role: "MOTPART", contact: { id: "c1", name: "Bob Motpart", email: "bob@x.se" } },
  { id: "mc2", role: "VITTNE", contact: { id: "c2", name: "Cilla Vittne" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  templatesLoading = false;
  templatesData = [
    { id: "t1", name: "Fullmakt", category: "Avtal", content: "<body>{{matter.matterNumber}}</body>" },
    { id: "t-empty", name: "Tom mall", category: null, content: null },
  ];
  matterData = {
    matterNumber: "2026-0001", title: "Tvist mot motpart", matterType: "Brottmål",
    contacts: [{ role: "KLIENT", contact: { name: "Anna Klient" } }],
  };
  orgData = { name: "Byrå AB", orgNumber: "556677-8899", address: "Storgatan 1", email: "info@byra.se" };

  globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
  globalThis.URL.revokeObjectURL = vi.fn();
  window.open = vi.fn();
});

describe("GenerateModal — vyer", () => {
  it("renderar rubrik + väljare", () => {
    render(<GenerateModal matterId="m1" contacts={contacts} onClose={() => {}} />);
    expect(screen.getByText("Generera dokument")).toBeInTheDocument();
    expect(screen.getByText("Mall")).toBeInTheDocument();
    expect(screen.getByText(/Mottagare \(0\)/)).toBeInTheDocument();
    expect(screen.getByText("Format")).toBeInTheDocument();
  });

  it("visar laddtext medan mallar hämtas", () => {
    templatesLoading = true;
    render(<GenerateModal matterId="m1" contacts={contacts} onClose={() => {}} />);
    expect(screen.getByText("Laddar mallar…")).toBeInTheDocument();
  });

  it("tom mall-lista → länk till att skapa mall", () => {
    templatesData = [];
    render(<GenerateModal matterId="m1" contacts={contacts} onClose={() => {}} />);
    expect(screen.getByText(/Inga mallar skapade/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skapa en mall" })).toBeInTheDocument();
  });

  it("inga kontakter → tomtext i mottagar-pickern", () => {
    render(<GenerateModal matterId="m1" contacts={[]} onClose={() => {}} />);
    expect(screen.getByText("Inga kontakter kopplade till ärendet.")).toBeInTheDocument();
  });
});

describe("GenerateModal — generering", () => {
  it("utan vald mottagare → ETT generellt dokument registreras + stänger", async () => {
    const onClose = vi.fn();
    render(<GenerateModal matterId="m1" contacts={contacts} onClose={onClose} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: /Generera/ }));
    await waitFor(() => expect(registerMutateAsync).toHaveBeenCalledTimes(1));
    expect(window.open).toHaveBeenCalled();
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1", mimeType: "text/html; charset=utf-8" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(treeInvalidate).toHaveBeenCalledWith({ matterId: "m1" });
  });

  it("två valda mottagare → ETT dokument per mottagare", async () => {
    render(<GenerateModal matterId="m1" contacts={contacts} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t1" } });
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect(screen.getByText(/Mottagare \(2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Generera/ }));
    await waitFor(() => expect(registerMutateAsync).toHaveBeenCalledTimes(2));
  });

  it("av/på-toggle av mottagare uppdaterar antalet", () => {
    render(<GenerateModal matterId="m1" contacts={contacts} onClose={() => {}} />);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    expect(screen.getByText(/Mottagare \(1\)/)).toBeInTheDocument();
    fireEvent.click(boxes[0]!);
    expect(screen.getByText(/Mottagare \(0\)/)).toBeInTheDocument();
  });

  it("mall utan innehåll → felmeddelande, stänger inte", async () => {
    const onClose = vi.fn();
    render(<GenerateModal matterId="m1" contacts={contacts} onClose={onClose} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t-empty" } });
    fireEvent.click(screen.getByRole("button", { name: /Generera/ }));
    await waitFor(() => expect(screen.getByText("Mallen saknar innehåll.")).toBeInTheDocument());
    expect(registerMutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("format docx går att välja", () => {
    render(<GenerateModal matterId="m1" contacts={contacts} onClose={() => {}} />);
    const docx = screen.getByRole("radio", { name: /HTML-fil/ }) as HTMLInputElement;
    fireEvent.click(docx);
    expect(docx.checked).toBe(true);
  });
});
