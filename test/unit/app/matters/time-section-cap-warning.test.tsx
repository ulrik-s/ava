/**
 * `TimeSection` — rättshjälpens takvarning där tid registreras (#1520). Bara
 * rättshjälp: rättsskyddets varning hör till panelen Betalningssätt. En ny,
 * ändrad eller borttagen post hämtar om upparbetat så varningen följer med.
 */

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest-compat";
import { invalidatedPaths } from "../../../helpers/trpc-fake";
import { forMatter, renderTimeSection, TIME_MATTER_ID as matterId } from "./time-section-fixture";

let usage = { billableMinutes: 0, billableValueOre: 0 };
const entries: Array<Record<string, unknown>> = [];
const HANDLERS = {
  "matter.coverageUsage": () => usage,
  "timeEntry.list": () => ({ entries, totalMinutes: 0 }),
};
const WARNING = /Närmar sig taket|Taket passerat/;
/** Tidslistan och upparbetat mot taket läses om för ärendet. */
const REFRESHED = [forMatter("timeEntry.list", matterId), forMatter("matter.coverageUsage", matterId)];

beforeEach(() => {
  usage = { billableMinutes: 0, billableValueOre: 0 };
  entries.length = 0;
});
afterEach(() => { vi.restoreAllMocks(); });

describe("TimeSection — takvarning (#1520)", () => {
  it("rättshjälp över tröskeln: varningen visas i tidssektionen", async () => {
    usage = { billableMinutes: 85 * 60, billableValueOre: 0 };
    await renderTimeSection(HANDLERS, { paymentMethod: "RATTSHJALP", rattshjalpMaxTimmar: 100 });
    expect(screen.getByText("⚠ Närmar sig taket (85 %)")).toBeInTheDocument();
    expect(screen.getByText(/85 tim av 100 tim upparbetat — be om utökad rättshjälp/)).toBeInTheDocument();
  });

  it("rättshjälp med passerat tak: Taket passerat", async () => {
    usage = { billableMinutes: 110 * 60, billableValueOre: 0 };
    await renderTimeSection(HANDLERS, { paymentMethod: "RATTSHJALP", rattshjalpMaxTimmar: null });
    expect(screen.getByText("⚠ Taket passerat (110 %)")).toBeInTheDocument();
  });

  it("rättshjälp under tröskeln: ingen varning", async () => {
    usage = { billableMinutes: 79 * 60, billableValueOre: 0 };
    await renderTimeSection(HANDLERS, { paymentMethod: "RATTSHJALP", rattshjalpMaxTimmar: 100 });
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("rättsskydd över taket: ingen varning i tidssektionen", async () => {
    usage = { billableMinutes: 200 * 60, billableValueOre: 10_000_000 };
    await renderTimeSection(HANDLERS, { paymentMethod: "RATTSSKYDD" });
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("registreringen fungerar som förut och blockeras inte av varningen", async () => {
    usage = { billableMinutes: 110 * 60, billableValueOre: 0 };
    await renderTimeSection(HANDLERS, { paymentMethod: "RATTSHJALP", rattshjalpMaxTimmar: 100 });
    fireEvent.click(screen.getByRole("button", { name: /Registrera tid/ }));
    expect(screen.getByRole("dialog", { name: "Registrera tid" })).toBeInTheDocument();
  });

  it("update hämtar om tidslistan och upparbetat mot taket", async () => {
    entries.push({ id: "t1", matterId, date: "2026-03-01", minutes: 60, description: "Samtal", billable: true });
    const { invalidate } = await renderTimeSection(HANDLERS, { paymentMethod: "RATTSHJALP" });
    fireEvent.click(screen.getByText("Ändra"));
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(expect.arrayContaining(REFRESHED)));
  });

  it("create hämtar om tidslistan och upparbetat mot taket", async () => {
    const { invalidate } = await renderTimeSection(HANDLERS, { paymentMethod: "RATTSHJALP" });
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Samtal" } });
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(expect.arrayContaining(REFRESHED)));
  });

  it("delete hämtar om tidslistan och upparbetat mot taket", async () => {
    entries.push({ id: "t1", matterId, date: "2026-03-01", minutes: 60, description: "Samtal", billable: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { invalidate } = await renderTimeSection(HANDLERS, { paymentMethod: "RATTSHJALP" });
    fireEvent.click(screen.getByText("Ta bort"));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(expect.arrayContaining(REFRESHED)));
  });
});
