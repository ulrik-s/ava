/**
 * Tester för `GenerateModal` (#27) — klientsidig dokument-generering per ärende.
 *
 * Täcker mall-/mottagar-/format-väljarna + hela generera-orkestreringen
 * (handleGenerate → runGenerate → buildTemplateContext → generateOneDoc → register):
 * ett dokument per vald mottagare (eller ett generellt utan val), fel-
 * hantering (mall utan innehåll) och laddnings-/tom-tillstånd. DOM-globaler
 * som happy-dom saknar (URL.createObjectURL, window.open) och FSA-skrivningen
 * stubbas; renderHandlebars mockas till en fast HTML-sträng.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { GenerateModal } from "@/app/matters/[id]/_generate-modal";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, invalidatedPaths, testQueryClient, TrpcTestProvider, type FakeTrpcLink } from "../../../helpers/trpc-fake";

interface Tpl { id: string; name: string; category: string | null; content: string | null }
let templatesData: Tpl[] | undefined;
let templatesLoading = false;
let matterData: unknown;
let orgData: unknown;
let officesData: unknown;
let userData: unknown;
/** Renderingen: en fast HTML-sträng, eller (i kontexttestet) riktig Handlebars. */
let renderImpl: (tpl: string, ctx: Record<string, unknown>) => string = () => "<!doctype html><html><body>dokument</body></html>";
vi.mock("@/lib/client/kostnadsrakning/render-handlebars", () => ({
  renderHandlebars: (tpl: string, ctx: Record<string, unknown>) => renderImpl(tpl, ctx),
}));
vi.mock("@/lib/client/fsa/handle-store", () => ({ loadHandle: async () => null }));
vi.mock("@/lib/client/fsa/fs-adapter", () => ({
  FsaIsoGitAdapter: class { writeFile = async (): Promise<void> => {}; },
}));

const contacts: ComponentProps<typeof GenerateModal>["contacts"] = [
  { id: "mc1", role: "MOTPART", contact: { id: "c1", name: "Bob Motpart", email: "bob@x.se" } },
  { id: "mc2", role: "VITTNE", contact: { id: "c2", name: "Cilla Vittne" } },
];

/** Mallistan; `templatesLoading` håller frågan öppen. */
function templatesAnswer(): unknown {
  return templatesLoading ? new Promise(() => {}) : templatesData;
}

/** Renderar dialogen mot en fejkad tRPC-länk och väntar tills ärendets data har hämtats. */
async function renderModal(props: Partial<ComponentProps<typeof GenerateModal>> = {}) {
  const fake = fakeTrpcLink({
    "documentTemplate.list": templatesAnswer,
    "matter.getById": () => matterData,
    "organization.getSettings": () => orgData,
    "organization.listOffices": () => officesData,
    "user.current": () => userData,
    "document.register": () => ({}),
  });
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <TrpcTestProvider link={fake.link} queryClient={queryClient}>
      <GenerateModal matterId={asId<"MatterId">("m1")} contacts={contacts} onClose={() => {}} {...props} />
    </TrpcTestProvider>,
  );
  await waitFor(() => expect(queryClient.getQueryCache().getAll().filter((q) => q.state.status === "success")).toHaveLength(templatesLoading ? 4 : 5));
  return { fake, invalidate };
}

/** Indata till `document.register`, i anropsordning. */
function registered(fake: FakeTrpcLink): unknown[] {
  return fake.calls.filter((c) => c.path === "document.register").map((c) => c.input);
}

beforeEach(() => {
  vi.clearAllMocks();
  templatesLoading = false;
  templatesData = [
    { id: "t1", name: "Fullmakt", category: "Avtal", content: "<body>{{matter.matterNumber}}</body>" },
    { id: "t-empty", name: "Tom mall", category: null, content: null },
  ];
  renderImpl = () => "<!doctype html><html><body>dokument</body></html>";
  matterData = {
    id: "m1", matterNumber: "2026-0001", title: "Tvist mot motpart", matterType: "Brottmål",
    status: "ACTIVE", createdAt: "2026-01-10T09:00:00Z",
    contacts: [
      { contactId: "c0", role: "KLIENT", notes: null, contact: { name: "Anna Klient", email: "anna@klient.se" } },
      { contactId: "c1", role: "MOTPART", notes: null, contact: { name: "Bob Motpart", email: "bob@x.se", address: "Motpartsvägen 9" } },
      { contactId: "c2", role: "VITTNE", notes: null, contact: { name: "Cilla Vittne" } },
    ],
  };
  orgData = { name: "Byrå AB", orgNumber: "556677-8899", address: "Storgatan 1", email: "info@byra.se", phone: "08-555 00" };
  officesData = [];
  userData = { name: "Karin Advokat", title: "Advokat" };

  globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
  globalThis.URL.revokeObjectURL = vi.fn();
  window.open = vi.fn();
});

describe("GenerateModal — vyer", () => {
  it("renderar rubrik + väljare", async () => {
    await renderModal();
    expect(screen.getByText("Generera dokument")).toBeInTheDocument();
    expect(screen.getByText("Mall")).toBeInTheDocument();
    expect(screen.getByText(/Mottagare \(0\)/)).toBeInTheDocument();
    expect(screen.getByText("Format")).toBeInTheDocument();
  });

  it("visar laddtext medan mallar hämtas", async () => {
    templatesLoading = true;
    await renderModal();
    expect(screen.getByText("Laddar mallar…")).toBeInTheDocument();
  });

  it("tom mall-lista → länk till att skapa mall", async () => {
    templatesData = [];
    await renderModal();
    expect(screen.getByText(/Inga mallar skapade/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skapa en mall" })).toBeInTheDocument();
  });

  it("inga kontakter → tomtext i mottagar-pickern", async () => {
    await renderModal({ contacts: [] });
    expect(screen.getByText("Inga parter kopplade till ärendet.")).toBeInTheDocument();
  });
});

describe("GenerateModal — generering", () => {
  it("utan vald mottagare → ETT generellt dokument registreras + stänger", async () => {
    const onClose = vi.fn();
    const { fake, invalidate } = await renderModal({ onClose });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: /Generera/ }));
    await waitFor(() => expect(registered(fake)).toHaveLength(1));
    expect(window.open).toHaveBeenCalled();
    expect(registered(fake)).toEqual([expect.objectContaining({ matterId: "m1", mimeType: "text/html; charset=utf-8" })]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invalidatedPaths(invalidate)).toEqual(["document.tree {\"matterId\":\"m1\"}"]);
  });

  it("två valda mottagare → ETT dokument per mottagare", async () => {
    const { fake } = await renderModal();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t1" } });
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect(screen.getByText(/Mottagare \(2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Generera/ }));
    await waitFor(() => expect(registered(fake)).toHaveLength(2));
  });

  it("av/på-toggle av mottagare uppdaterar antalet", async () => {
    await renderModal();
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    expect(screen.getByText(/Mottagare \(1\)/)).toBeInTheDocument();
    fireEvent.click(boxes[0]!);
    expect(screen.getByText(/Mottagare \(0\)/)).toBeInTheDocument();
  });

  it("mall utan innehåll → felmeddelande, stänger inte", async () => {
    const onClose = vi.fn();
    const { fake } = await renderModal({ onClose });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t-empty" } });
    fireEvent.click(screen.getByRole("button", { name: /Generera/ }));
    await waitFor(() => expect(screen.getByText("Mallen saknar innehåll.")).toBeInTheDocument());
    expect(registered(fake)).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("en vald mottagare: byråns telefon, klientens e-post och mottagarens adress finns i dokumentet (#2118)", async () => {
    const Handlebars = (await import("handlebars")).default;
    renderImpl = (tpl, ctx) => Handlebars.compile(tpl)(ctx);
    const blobs: Blob[] = [];
    globalThis.URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:fake"; });
    templatesData = [{ id: "t1", name: "Brev", category: null, content: "<body>{{organization.phone}}|{{klient.email}}|{{recipient.address}}</body>" }];
    const { fake } = await renderModal();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Bob Motpart/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generera/ }));
    await waitFor(() => expect(registered(fake)).toHaveLength(1));
    expect(await blobs[0]?.text()).toContain("08-555 00|anna@klient.se|Motpartsvägen 9");
    expect(registered(fake)).toEqual([expect.objectContaining({ fileName: expect.stringContaining("Brev Bob Motpart") })]);
  });

  it("format docx går att välja", async () => {
    await renderModal();
    const docx = screen.getByRole<HTMLInputElement>("radio", { name: /HTML-fil/ });
    fireEvent.click(docx);
    expect(docx.checked).toBe(true);
  });
});
