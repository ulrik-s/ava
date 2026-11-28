/**
 * Test för ServiceNotesSection (#348) — tjänsteanteckningar-panelen:
 * tomtillstånd, lista (sorterad fallande på datum+tid med författare),
 * öppna/avbryt formulär och skapa-flödet.
 */

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ServiceNotesSection } from "@/app/matters/[id]/_service-notes-section";
import { asId } from "@/lib/shared/schemas/ids";
import { callsTo, DATA_TABLE_HANDLERS, renderWithFakeTrpc } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths } from "../../../helpers/trpc-fake";

let notes: unknown[] = [];
/** Svaret på `serviceNote.create`; ett löfte som aldrig löses håller sparandet pågående. */
let createResult: () => unknown = () => ({ id: "ny" });

const renderSection = () => renderWithFakeTrpc(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />, {
  ...DATA_TABLE_HANDLERS,
  "serviceNote.list": () => notes,
  "serviceNote.create": () => createResult(),
  "serviceNote.update": () => ({ id: "a" }),
  "serviceNote.delete": () => ({ id: "a" }),
});
const NOTES_REFRESHED = ["serviceNote.list {\"matterId\":\"m1\"}"];
const NOTE_A = { id: "a", date: "2026-06-10", time: "08:00", text: "Text", author: { name: "Anna" } };

beforeEach(() => {
  notes = [];
  createResult = () => ({ id: "ny" });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("ServiceNotesSection", () => {
  it("visar Laddar… tills listan har kommit, sedan tomtillstånd", async () => {
    renderSection();
    expect(screen.getByText("Tjänsteanteckningar")).toBeInTheDocument();
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
    expect(await screen.findByText(/Inga tjänsteanteckningar ännu/)).toBeInTheDocument();
  });

  it("renderar anteckningar med författare, sorterade senaste först", async () => {
    notes = [
      { id: "a", date: "2026-06-10", time: "08:00", text: "Äldre", author: { name: "Anna" } },
      { id: "b", date: "2026-06-15", time: "14:00", text: "Nyare", author: { name: "Björn" } },
    ];
    renderSection();
    expect(await screen.findByText(/Björn/)).toBeInTheDocument();
    const texts = screen.getAllByText(/Äldre|Nyare/).map((e) => e.textContent);
    expect(texts).toEqual(["Nyare", "Äldre"]); // fallande på datum+tid
  });

  it("en anteckning utan författare visar —", async () => {
    notes = [{ id: "a", date: "2026-06-10", time: "08:00", text: "Utan", author: null }];
    renderSection();
    expect(await screen.findByText("Utan")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("'+ Ny anteckning' öppnar formuläret, Avbryt stänger det", () => {
    renderSection();
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    expect(screen.getByPlaceholderText(/Vad hände/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByPlaceholderText(/Vad hände/)).not.toBeInTheDocument();
  });

  it("submit skickar create med matterId + text och invaliderar listan vid success", async () => {
    const { fake, invalidate } = renderSection();
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    fireEvent.change(screen.getByPlaceholderText(/Vad hände/), { target: { value: "  Ringde klienten " } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(NOTES_REFRESHED));
    expect(callsTo(fake, "serviceNote.create")).toEqual([expect.objectContaining({ matterId: "m1", text: "Ringde klienten" })]);
    expect(screen.queryByPlaceholderText(/Vad hände/)).not.toBeInTheDocument();
  });

  it("Spara visar Sparar… och är avstängd medan anropet pågår", async () => {
    createResult = () => new Promise(() => {});
    renderSection();
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    fireEvent.change(screen.getByPlaceholderText(/Vad hände/), { target: { value: "Ringde" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(await screen.findByRole("button", { name: "Sparar…" })).toBeDisabled();
  });

  it("en ny anteckning får svenskt datum + klockslag — nyårsnatten 00:30 (#1677)", async () => {
    vi.setSystemTime(new Date("2025-12-31T23:30:00Z"));
    let rendered: ReturnType<typeof renderSection>;
    try {
      rendered = renderSection();
      fireEvent.click(screen.getByText("+ Ny anteckning"));
    } finally {
      vi.setSystemTime();
    }
    fireEvent.change(screen.getByPlaceholderText(/Vad hände/), { target: { value: "Jour" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(rendered.fake, "serviceNote.create"))
      .toEqual([expect.objectContaining({ date: "2026-01-01", time: "00:30" })]));
  });

  it("submit utan text gör ingen mutation (required + trim-vakt)", () => {
    const { fake } = renderSection();
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    const form = screen.getByPlaceholderText(/Vad hände/).closest("form");
    if (!form) throw new Error("formuläret saknas");
    fireEvent.submit(form);
    expect(callsTo(fake, "serviceNote.create")).toEqual([]);
  });

  it("Redigera öppnar formuläret förifyllt och submit skickar update med id (#375)", async () => {
    notes = [{ ...NOTE_A, text: "Gammal text" }];
    const { fake, invalidate } = renderSection();
    fireEvent.click(await screen.findByTitle("Redigera"));
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(/Vad hände/);
    expect(textarea.value).toBe("Gammal text"); // förifyllt
    fireEvent.change(textarea, { target: { value: "Ny text" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(NOTES_REFRESHED));
    expect(callsTo(fake, "serviceNote.update")).toEqual([expect.objectContaining({ id: "a", text: "Ny text" })]);
    expect(callsTo(fake, "serviceNote.create")).toEqual([]);
  });

  it("Ta bort kallar delete med id efter confirm och läser om listan (#375)", async () => {
    notes = [NOTE_A];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { fake, invalidate } = renderSection();
    fireEvent.click(await screen.findByTitle("Ta bort"));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(NOTES_REFRESHED));
    expect(callsTo(fake, "serviceNote.delete")).toEqual([{ id: "a" }]);
  });

  it("Ta bort gör inget om confirm avbryts (#375)", async () => {
    notes = [NOTE_A];
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { fake } = renderSection();
    fireEvent.click(await screen.findByTitle("Ta bort"));
    expect(callsTo(fake, "serviceNote.delete")).toEqual([]);
  });
});
