/**
 * Test för ContactsSection (#27/#1136) — kontakt-panelen i ärendet: lista
 * (namn/roll/nummer), lägg till via sökdialog (befintlig eller ny kontakt,
 * med roll), ta bort.
 */

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ContactsSection } from "@/app/matters/[id]/_contacts-section";
import { asId } from "@/lib/shared/schemas/ids";
import { callsTo, DATA_TABLE_HANDLERS, renderWithFakeTrpc } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths, type FakeTrpcLink, type InvalidateSpy, type TrpcHandlers } from "../../../helpers/trpc-fake";

vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

let searchHits: Array<{ id: string; name: string; contactType: string; personalNumber?: string | null }> = [];
/** Ärendet (`matter.getById`): jävskontrollens fält styr posten under Parter (#1733). */
let matterData: Record<string, unknown> | null = null;

const HANDLERS: TrpcHandlers = {
  ...DATA_TABLE_HANDLERS,
  "user.list": () => ({ users: [{ id: "u1", name: "Anna Advokat" }] }),
  "contacts.search": (input) => ({ contacts: hasTerm(input) ? searchHits : [] }),
  "contacts.create": () => ({ id: "c-new", name: "Motpart AB" }),
  "matter.getById": () => matterData,
  "matter.addContact": () => ({ id: "mc-ny" }),
  "matter.removeContact": () => ({ id: "mc1" }),
  "matter.checkConflicts": () => ({ id: "m1" }),
};

/** Har sökningen en sökterm? */
function hasTerm(input: unknown): boolean {
  return typeof input === "object" && input !== null && "term" in input && Boolean(input.term);
}

const contacts: ComponentProps<typeof ContactsSection>["contacts"] = [
  { id: "mc1", role: "KLIENT", contact: { id: "c1", name: "Klient Karlsson", personalNumber: "19800101-1234" } },
];

/** Ärendets titel — med blanksteg runt, som trimmas innan den hamnar i sökrutan. */
const TITLE = "  Skattetvist Exempel AB ";

beforeEach(() => { searchHits = []; matterData = null; });

const renderContacts = (list: typeof contacts = contacts) =>
  renderWithFakeTrpc(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={list} matterTitle={TITLE} />, HANDLERS);

/** Fake-länken för den senaste renderingen. */
let fake: FakeTrpcLink;
let invalidate: InvalidateSpy;
const openPicker = () => {
  ({ fake, invalidate } = renderContacts([]));
  fireEvent.click(screen.getByText("+ Lägg till"));
  return screen.getByRole("dialog", { name: "Välj part" });
};

describe("ContactsSection", () => {
  it("visar rubrik med antal + kontaktraderna (namn, roll, nummer)", () => {
    renderContacts();
    expect(screen.getByText("Parter (1)")).toBeInTheDocument();
    expect(screen.getByText("Klient Karlsson")).toBeInTheDocument();
    expect(screen.getByText("19800101-1234")).toBeInTheDocument();
  });

  it("tomt → tomtillstånd", async () => {
    renderContacts([]);
    expect(screen.getByText("Parter (0)")).toBeInTheDocument();
    expect(await screen.findByText("Inga parter kopplade")).toBeInTheDocument();
  });

  it("'+ Lägg till' öppnar sökdialogen — ingen dropdown med kontakter (#1136)", () => {
    const dialog = openPicker();
    expect(within(dialog).getByRole("searchbox")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Roll i ärendet")).toHaveValue("MOTPART");
    expect(within(dialog).getAllByRole("combobox")).toHaveLength(1); // bara rollen
  });

  it("dialogen säger \"part\": sökrutan och knappen för en ny (#1647)", () => {
    const dialog = openPicker();
    expect(within(dialog).getByLabelText("Sök part")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "+ Ny part…" })).toBeInTheDocument();
  });

  it("rollväljaren listar Medtilltalad (#1637)", () => {
    const dialog = openPicker();
    expect(within(within(dialog).getByLabelText("Roll i ärendet")).getByRole("option", { name: "Medtilltalad" }))
      .toHaveValue("MEDTILLTALAD");
  });

  it("sök + välj befintlig kontakt med vald roll → addContact, dialogen stängs", async () => {
    searchHits = [{ id: "c2", name: "Berit Befintlig", contactType: "PERSON" }];
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByLabelText("Roll i ärendet"), { target: { value: "MOTPARTSOMBUD" } });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "berit" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Berit Befintlig/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(callsTo(fake, "matter.addContact")).toEqual([{ matterId: "m1", contactId: "c2", role: "MOTPARTSOMBUD" }]);
  });

  it("en ny part hämtar om ärendet och watchlist.list (#1354)", async () => {
    searchHits = [{ id: "c2", name: "Berit Befintlig", contactType: "PERSON" }];
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "berit" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Berit Befintlig/ }));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(expect.arrayContaining([
      "matter.getById {\"id\":\"m1\"}", "watchlist.list",
    ])));
  });

  it("ingen träff → 'Ny part…' förifylld; OK skapar och kopplar den till ärendet", async () => {
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "Motpart AB" } });
    expect(await screen.findByText(/Ingen träff — skapa parten med "Ny part…"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ny part/ }));
    const create = screen.getByRole("dialog", { name: "Ny part" });
    expect((within(create).getByLabelText<HTMLInputElement>(/Namn/)).value).toBe("Motpart AB");
    fireEvent.click(within(create).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(callsTo(fake, "matter.addContact")).toEqual([{ matterId: "m1", contactId: "c-new", role: "MOTPART" }]));
    expect(callsTo(fake, "contacts.create")).toEqual([expect.objectContaining({ name: "Motpart AB" })]);
  });

  it("Avbryt stänger dialogen utan att koppla något", () => {
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(callsTo(fake, "matter.addContact")).toEqual([]);
  });

  describe("ärendets titel i sökrutan vid rollen Klient (#1645)", () => {
    const searchbox = (dialog: HTMLElement) => within(dialog).getByRole<HTMLInputElement>("searchbox");
    const chooseRole = (dialog: HTMLElement, role: string) =>
      fireEvent.change(within(dialog).getByLabelText("Roll i ärendet"), { target: { value: role } });

    it("standardrollen Motpart → tom sökruta", () => {
      expect(searchbox(openPicker()).value).toBe("");
    });

    it("byte till Klient med tom sökruta → den trimmade titeln fylls i", () => {
      const dialog = openPicker();
      chooseRole(dialog, "KLIENT");
      expect(searchbox(dialog).value).toBe("Skattetvist Exempel AB");
    });

    it("byte till Klient efter egen text → texten står kvar", () => {
      const dialog = openPicker();
      fireEvent.change(searchbox(dialog), { target: { value: "berit" } });
      chooseRole(dialog, "KLIENT");
      expect(searchbox(dialog).value).toBe("berit");
    });

    it("byte bort från Klient → titeln står kvar, inget rensas", () => {
      const dialog = openPicker();
      chooseRole(dialog, "KLIENT");
      chooseRole(dialog, "MOTPART");
      expect(searchbox(dialog).value).toBe("Skattetvist Exempel AB");
    });

    it("dialogen öppnas med rollen Klient → sökrutan har titeln", () => {
      const first = openPicker();
      chooseRole(first, "KLIENT");
      fireEvent.click(within(first).getByRole("button", { name: "Avbryt" }));
      fireEvent.click(screen.getByText("+ Lägg till"));
      const dialog = screen.getByRole("dialog", { name: "Välj part" });
      expect(within(dialog).getByLabelText("Roll i ärendet")).toHaveValue("KLIENT");
      expect(searchbox(dialog).value).toBe("Skattetvist Exempel AB");
    });

    it("tömd sökruta och byte till Klient igen → titeln fylls i på nytt", () => {
      const dialog = openPicker();
      chooseRole(dialog, "KLIENT");
      fireEvent.change(searchbox(dialog), { target: { value: "" } });
      chooseRole(dialog, "MOTPART");
      chooseRole(dialog, "KLIENT");
      expect(searchbox(dialog).value).toBe("Skattetvist Exempel AB");
    });
  });

  it("Ta bort → removeContact med matterContactId, och ärendet läses om", async () => {
    const view = renderContacts();
    fireEvent.click(screen.getByText("Ta bort"));
    await waitFor(() => expect(invalidatedPaths(view.invalidate)).toEqual(["matter.getById {\"id\":\"m1\"}"]));
    expect(callsTo(view.fake, "matter.removeContact")).toEqual([{ matterContactId: "mc1" }]);
  });

describe("jävskontrollen under Parter (#1733)", () => {
  const MATTER = { id: "m1", matterNumber: "2026-0001", status: "ACTIVE" };
  const renderSection = () => renderContacts();

  it("träffar: visar 'N träffar att bedöma', Bedöm träffarna och Kör jävskontrollen igen", async () => {
    matterData = { ...MATTER, conflictCheckStatus: "HITS", conflictCheckHits: 2 };
    const view = renderSection();
    const group = await screen.findByRole("group", { name: "Jävskontroll" });
    expect(within(group).getByText("Jävskontroll: 2 träffar att bedöma")).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Bedöm träffarna" })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Kör jävskontrollen igen" }));
    await waitFor(() => expect(callsTo(view.fake, "matter.checkConflicts")).toEqual([{ id: "m1" }]));
  });

  it("kontrollen väntar: visar att den väntar, utan Bedöm träffarna", async () => {
    matterData = { ...MATTER, conflictCheckStatus: "PENDING" };
    renderSection();
    const group = await screen.findByRole("group", { name: "Jävskontroll" });
    expect(within(group).getByText("Jävskontroll väntar")).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "Bedöm träffarna" })).not.toBeInTheDocument();
  });

  it("klar utan träffar: ingen status", async () => {
    matterData = { ...MATTER, conflictCheckStatus: "CLEAR", conflictCheckHits: 0 };
    const view = renderSection();
    await waitFor(() => expect(callsTo(view.fake, "matter.getById").length).toBeGreaterThan(0));
    await screen.findByText("Klient Karlsson");
    expect(screen.queryByRole("group", { name: "Jävskontroll" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Jävskontroll/)).not.toBeInTheDocument();
  });

  it("ärendet inte laddat: ingen status", () => {
    renderSection();
    expect(screen.queryByRole("group", { name: "Jävskontroll" })).not.toBeInTheDocument();
  });

  it("senaste bedömningen visas när den finns", async () => {
    matterData = {
      ...MATTER, conflictCheckStatus: "REVIEWED", conflictReviewedById: "u1",
      conflictReviewedAt: "2026-10-01T12:05:00Z", conflictReviewNote: "Annan person, ingen konflikt.",
    };
    renderSection();
    const note = await screen.findByRole("note", { name: "Jävskontrollens bedömning" });
    expect(within(note).getByText(/Jävskontrollen bedömd/)).toBeInTheDocument();
    expect(within(note).getByText("Annan person, ingen konflikt.")).toBeInTheDocument();
  });

  const HIT = { contactId: "c9", contactName: "Bertil Exempel", role: "MOTPART", matterId: "m-other", matterNumber: "2026-0042", matterTitle: "Tvist om staket" };
  /** Följer `b` efter `a` i dokumentet? */
  const follows = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("träffar att bedöma: listan står i gruppen, under statusen och ovanför åtgärderna (#1821)", async () => {
    matterData = { ...MATTER, conflictCheckStatus: "HITS", conflictCheckHits: 2, conflictCheckResults: [HIT, { ...HIT, contactId: "c8" }] };
    renderSection();
    const group = await screen.findByRole("group", { name: "Jävskontroll" });
    const heading = await within(group).findByText("Träffar i senaste kontrollen");
    expect(follows(within(group).getByText("Jävskontroll: 2 träffar att bedöma"), heading)).toBe(true);
    expect(follows(heading, within(group).getByRole("button", { name: "Kör jävskontrollen igen" }))).toBe(true);
    expect(follows(heading, within(group).getByRole("button", { name: "Bedöm träffarna" }))).toBe(true);
    expect(screen.getAllByText("Träffar i senaste kontrollen")).toHaveLength(1);
  });

  it("bedömd: listan står direkt ovanför den senaste bedömningen (#1821)", async () => {
    matterData = {
      ...MATTER, conflictCheckStatus: "REVIEWED", conflictCheckResults: [HIT], conflictReviewedById: "u1",
      conflictReviewedAt: "2026-10-01T12:05:00Z", conflictReviewNote: "Annan person.",
    };
    renderSection();
    const heading = await screen.findByText("Träffar i senaste kontrollen");
    expect(screen.queryByRole("group", { name: "Jävskontroll" })).not.toBeInTheDocument();
    expect(follows(heading, screen.getByRole("note", { name: "Jävskontrollens bedömning" }))).toBe(true);
    expect(screen.getByText(/Bertil Exempel/)).toBeInTheDocument();
  });

  it("stängt ärende med träffar: listan står ovanför den senaste bedömningen (#1821)", async () => {
    matterData = {
      ...MATTER, status: "CLOSED", conflictCheckStatus: "HITS", conflictCheckResults: [HIT], conflictReviewedById: "u1",
      conflictReviewedAt: "2026-10-01T12:05:00Z", conflictReviewNote: "Annan person.",
    };
    renderSection();
    const heading = await screen.findByText("Träffar i senaste kontrollen");
    expect(screen.queryByRole("group", { name: "Jävskontroll" })).not.toBeInTheDocument();
    expect(follows(heading, await screen.findByRole("note"))).toBe(true);
  });
});
});
