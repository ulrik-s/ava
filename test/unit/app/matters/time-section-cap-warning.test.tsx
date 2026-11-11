/**
 * `TimeSection` — rättshjälpens takvarning där tid registreras (#1520). Bara
 * rättshjälp: rättsskyddets varning hör till panelen Betalningssätt. En ny,
 * ändrad eller borttagen post hämtar om upparbetat så varningen följer med.
 */

import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { TimeSection } from "@/app/matters/[id]/_time-section";
import { asId } from "@/lib/shared/schemas/ids";

const usage = { data: { billableMinutes: 0, billableValueOre: 0 } };
const listInvalidate = vi.fn();
const usageInvalidate = vi.fn();
type Opts = { onSuccess?: () => void };
const opts: { create: Opts; update: Opts; delete: Opts } = { create: {}, update: {}, delete: {} };
const mutation = (key: keyof typeof opts) => (o: Opts) => {
  opts[key] = o;
  return { mutate: vi.fn(), isPending: false, error: null };
};
const noopMut = () => ({ mutate: vi.fn(), isPending: false });

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      timeEntry: { list: { invalidate: listInvalidate } },
      matter: { coverageUsage: { invalidate: usageInvalidate } },
    }),
    matter: { coverageUsage: { useQuery: () => usage } },
    timeEntry: {
      list: { useQuery: () => ({ data: { entries: [], totalMinutes: 0 }, isLoading: false }) },
      create: { useMutation: mutation("create") },
      update: { useMutation: mutation("update") },
      delete: { useMutation: mutation("delete") },
      radgivningStatus: { useQuery: () => ({ data: undefined }) },
      markAsRadgivning: { useMutation: noopMut },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: noopMut },
      clear: { useMutation: noopMut },
      setOrgDefault: { useMutation: noopMut },
      clearOrgDefault: { useMutation: noopMut },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
    organization: { getSettings: { useQuery: () => ({ data: undefined }) } },
    billingRun: { list: { useQuery: () => ({ data: { runs: [] } }) } },
  },
}));

const matterId = asId<"MatterId">("m1");
const WARNING = /Närmar sig taket|Taket passerat/;

beforeEach(() => {
  vi.clearAllMocks();
  usage.data = { billableMinutes: 0, billableValueOre: 0 };
});

describe("TimeSection — takvarning (#1520)", () => {
  it("rättshjälp över tröskeln: varningen visas i tidssektionen", () => {
    usage.data = { billableMinutes: 85 * 60, billableValueOre: 0 };
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" rattshjalpMaxTimmar={100} />);
    expect(screen.getByText("⚠ Närmar sig taket (85 %)")).toBeInTheDocument();
    expect(screen.getByText(/85 tim av 100 tim upparbetat — be om utökad rättshjälp/)).toBeInTheDocument();
  });

  it("rättshjälp med passerat tak: Taket passerat", () => {
    usage.data = { billableMinutes: 110 * 60, billableValueOre: 0 };
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" rattshjalpMaxTimmar={null} />);
    expect(screen.getByText("⚠ Taket passerat (110 %)")).toBeInTheDocument();
  });

  it("rättshjälp under tröskeln: ingen varning", () => {
    usage.data = { billableMinutes: 79 * 60, billableValueOre: 0 };
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" rattshjalpMaxTimmar={100} />);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("rättsskydd över taket: ingen varning i tidssektionen", () => {
    usage.data = { billableMinutes: 200 * 60, billableValueOre: 10_000_000 };
    render(<TimeSection matterId={matterId} paymentMethod="RATTSSKYDD" />);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("registreringen fungerar som förut och blockeras inte av varningen", () => {
    usage.data = { billableMinutes: 110 * 60, billableValueOre: 0 };
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" rattshjalpMaxTimmar={100} />);
    fireEvent.click(screen.getByRole("button", { name: /Registrera tid/ }));
    expect(screen.getByRole("dialog", { name: "Registrera tid" })).toBeInTheDocument();
  });

  it.each(["create", "update", "delete"] as const)("%s hämtar om tidslistan och upparbetat mot taket", (key) => {
    render(<TimeSection matterId={matterId} paymentMethod="RATTSHJALP" />);
    act(() => { opts[key].onSuccess?.(); });
    expect(listInvalidate).toHaveBeenCalledWith({ matterId });
    expect(usageInvalidate).toHaveBeenCalledWith({ matterId });
  });
});
