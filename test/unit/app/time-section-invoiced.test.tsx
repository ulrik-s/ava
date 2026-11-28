/**
 * TimeSection — utan Fakturerad/Faktura-kolumner: rättshjälp/rättsskydd-flödet
 * bryter 1:1-kopplingen mellan tidsrad och faktura, så kopplingen visas inte.
 * En post med faktura (`invoiceId`) är däremot låst, som en fryst (#1863):
 * samma regel (`isLockedEntry`) som servern.
 */
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { callsTo } from "../../helpers/trpc-both-fake";
import { invalidatedPaths, type TrpcHandlers } from "../../helpers/trpc-fake";
import { forMatter, renderTimeSection } from "./matters/time-section-fixture";

/** Extra rader per test (#1170: fryst post). */
const extraEntries: unknown[] = [];

/** Svaren: en öppen post och en fakturerad; `failing` gör de vägarna till fel. */
function handlers(failing: Readonly<Record<string, string>> = {}): TrpcHandlers {
  const fail = (path: string, ok: unknown) => () => {
    const message = failing[path];
    if (message) throw new Error(message);
    return ok;
  };
  return {
    "timeEntry.list": () => ({
      entries: [
        { id: "te-1", date: new Date("2026-05-01"), minutes: 60, description: "Möte", billable: true,
          user: { name: "Anna" }, invoiceId: null, invoice: null },
        { id: "te-2", date: new Date("2026-04-15"), minutes: 30, description: "Inlaga", billable: true,
          user: { name: "Björn" }, invoiceId: "inv-1", invoice: { id: "inv-1", invoiceNumber: "2026-0042" } },
        ...extraEntries,
      ],
      totalMinutes: 90,
    }),
    "timeEntry.update": fail("timeEntry.update", { id: "te-1" }),
    "timeEntry.delete": fail("timeEntry.delete", { id: "te-1" }),
  };
}

beforeEach(() => { extraEntries.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

const renderSection = (failing?: Readonly<Record<string, string>>) => renderTimeSection(handlers(failing));

/** Det första elementet med texten. */
function firstText(text: string): HTMLElement {
  const [el] = screen.getAllByText(text);
  if (!el) throw new Error(`saknar ${text}`);
  return el;
}

const LOCKED = "Tidposten ingår i en slutfaktura eller kostnadsräkning och kan inte ändras eller tas bort.";

describe("TimeSection — utan invoice-koppling i UI", () => {
  it("renderar INGEN 'Fakturerad'-kolumn", async () => {
    await renderSection();
    expect(screen.queryByText("Fakturerad")).not.toBeInTheDocument();
  });

  it("renderar INGEN 'Faktura'-kolumn (även för entries med invoiceId)", async () => {
    await renderSection();
    expect(screen.queryByText("Faktura")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-0042")).not.toBeInTheDocument();
  });

  it("en post med bara fakturakoppling (invoiceId) är låst — bara den öppna får Ändra + Ta bort (#1863)", async () => {
    await renderSection();
    expect(screen.getByText("🔒 Låst")).toHaveAttribute(
      "title", "Ingår i en faktura eller kostnadsräkning och kan inte ändras eller tas bort.",
    );
    expect(screen.getAllByText("Ändra")).toHaveLength(1);
    expect(screen.getAllByText("Ta bort")).toHaveLength(1);
  });
});

describe("TimeSection — frysta poster och sparfel (#1170)", () => {
  it("post som ingår i slutfaktura/kostnadsräkning (frozenAt) visar Låst, inte Ändra/Ta bort", async () => {
    extraEntries.push({ id: "te-3", date: new Date("2026-03-01"), minutes: 45, description: "Huvudförhandling", billable: true,
      user: { name: "Anna" }, frozenAt: new Date("2026-06-01") });
    await renderSection();
    expect(screen.getAllByText("🔒 Låst")).toHaveLength(2); // den frysta och den fakturerade
    expect(screen.getAllByText("Ändra")).toHaveLength(1); // bara den olåsta
  });

  it("misslyckad borttagning säger till (alert) — aldrig tyst", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderSection({ "timeEntry.delete": "Tidposten ingår i en slutfaktura" });
    fireEvent.click(firstText("Ta bort"));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Kunde inte ta bort: Tidposten ingår i en slutfaktura"));
  });

  it("misslyckat sparande visas i dialogen — aldrig tyst", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderSection({ "timeEntry.update": LOCKED });
    fireEvent.click(firstText("Ändra"));
    fireEvent.click(screen.getByText("Spara"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunde inte spara: Tidposten ingår i en slutfaktura");
  });
});

describe("TimeSection — registrera/ändra/ta-bort-flöden", () => {
  it("'+ Registrera tid' → fyll formulär → Spara → create med matterId", async () => {
    const { fake } = await renderSection();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.getByText("Registrera tid")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Datum *"), { target: { value: "2026-05-20" } });
    fireEvent.change(screen.getByLabelText("Tid (h) *"), { target: { value: "0,75" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Telefonsamtal" } });
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(callsTo(fake, "timeEntry.create")).toEqual([
      expect.objectContaining({ matterId: "m1", minutes: 45, description: "Telefonsamtal" }),
    ]));
  });

  it("'Ändra' öppnar förifyllt edit-formulär → Spara → update med id", async () => {
    const { fake } = await renderSection();
    fireEvent.click(firstText("Ändra"));
    expect(screen.getByText("Ändra tidregistrering")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Möte")).toBeInTheDocument(); // förifyllt ur te-1
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(callsTo(fake, "timeEntry.update")).toEqual([expect.objectContaining({ id: "te-1" })]));
  });

  it("'Ta bort' med confirm → delete med id, och listan läses om", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { fake, invalidate } = await renderSection();
    fireEvent.click(firstText("Ta bort"));
    await waitFor(() => expect(callsTo(fake, "timeEntry.delete")).toEqual([{ id: "te-1" }]));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toContain(forMatter("timeEntry.list", "m1")));
  });

  it("'Ta bort' med avbruten confirm → ingen delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { fake } = await renderSection();
    fireEvent.click(firstText("Ta bort"));
    expect(callsTo(fake, "timeEntry.delete")).toEqual([]);
  });

  it("toggla Debiterbar i skapa-formuläret + Avbryt stänger modalen", async () => {
    await renderSection();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Debiterbar" })); // Debiterbar
    fireEvent.click(screen.getByText("Avbryt"));
    expect(screen.queryByText("Registrera tid")).not.toBeInTheDocument();
  });
});
