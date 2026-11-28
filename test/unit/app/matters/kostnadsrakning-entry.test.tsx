/**
 * Rättshjälpens kostnadsräkning på ett urval av poster (#1889).
 *
 * `RattshjalpKrDialog` (via `KostnadsrakningEntry` med betalningssättet
 * RATTSHJALP) visar postlistan före summan; summan följer urvalet, de valda
 * id:na skickas till servern, och dokumentet får exakt samma poster.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { KostnadsrakningEntry, type MatterContext } from "@/app/matters/[id]/_kostnadsrakning-entry";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, TrpcTestProvider, type FakeTrpcLink, type TrpcHandlers } from "../../../helpers/trpc-fake";

const T1 = { id: "t1", date: "2026-09-01", description: "Inläsning", minutes: 60, billable: true, valueOre: 150_000 };
const T2 = { id: "t2", date: "2026-10-01", description: "Möte", minutes: 30, billable: true, valueOre: 75_000 };
const E1 = { id: "e1", date: "2026-09-02", description: "Resa", amount: 40_000, billable: true };
const FROZEN = { id: "e-old", date: "2026-08-02", description: "Fryst", amount: 9_900, billable: true };

const generateKrDoc = vi.fn((): Promise<void> => Promise.resolve());
let createKr: (input: unknown) => unknown = () => ({ run: { id: "run-1" } });

const handlers: TrpcHandlers = {
  "billingRun.proposal": () => ({ timeEntries: [T1, T2], expenses: [E1] }),
  "billingRun.createKostnadsrakning": (input) => createKr(input),
  "timeEntry.list": () => ({ entries: [T1, T2] }),
  "expense.list": () => ({ expenses: [E1, FROZEN] }),
  "user.current": () => ({ name: "Adv. Anna", email: "anna@byra.se" }),
  "organization.getSettings": () => ({ name: "Byrå AB" }),
};
vi.mock("@/lib/client/kostnadsrakning/generate-kr-doc", () => ({ generateKrDoc }));

const MATTER: MatterContext = { matterNumber: "2026-0001", title: "Tvist", paymentMethod: "RATTSHJALP" };
const onClose = vi.fn();
const onRecorded = vi.fn();

let fake: FakeTrpcLink = fakeTrpcLink(handlers);

/** Renderar dialogen och väntar tills postlistan har lästs in. */
async function renderDialog() {
  fake = fakeTrpcLink(handlers);
  const view = render(
    <TrpcTestProvider link={fake.link}>
      <KostnadsrakningEntry matterId={asId<"MatterId">("m1")} matter={MATTER} open onClose={onClose} onRecorded={onRecorded} />
    </TrpcTestProvider>,
  );
  await screen.findByText("Poster att fakturera (3/3 valda)");
  await waitFor(() => expect(screen.getByRole("button", { name: "Skapa kostnadsräkning" })).toBeEnabled());
  return view;
}

/** Indata till `billingRun.createKostnadsrakning`. */
const createCalls = (): unknown[] => fake.calls.filter((c) => c.path === "billingRun.createKostnadsrakning").map((c) => c.input);

/** Kryssrutan för en post i listan, ur dess beskrivning. */
function box(label: string): HTMLElement {
  const row = screen.getByText(label).closest("label");
  if (!row) throw new Error(`raden ${label} saknas`);
  return within(row).getByRole("checkbox");
}

/** Beloppet på summaraden `label` (Arvode eller Utlägg). */
function amountOf(label: RegExp): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  createKr = () => ({ run: { id: "run-1" } });
});

describe("RattshjalpKrDialog — postlistan (#1889)", () => {
  it("listan står före summan, med alla ofrysta poster förvalda", async () => {
    await renderDialog();
    const list = screen.getByText("Poster att fakturera (3/3 valda)");
    expect(list.compareDocumentPosition(screen.getByText(/Arvode/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("summan följer urvalet", async () => {
    await renderDialog();
    const arvode = amountOf(/Arvode/);
    const utlagg = amountOf(/^Utlägg$/);
    fireEvent.click(box("Möte"));
    fireEvent.click(box("Resa"));
    expect(amountOf(/Arvode/)).not.toBe(arvode);
    expect(amountOf(/^Utlägg$/)).not.toBe(utlagg);
    expect(amountOf(/^Utlägg$/)).toMatch(/^0/);
  });

  it("orörd lista: inga id:n, och dokumentet får de ofrysta posterna — inte det frysta utlägget", async () => {
    await renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(generateKrDoc).toHaveBeenCalled());
    expect(createCalls()).toEqual([{ matterId: "m1" }]);
    expect(generateKrDoc).toHaveBeenCalledWith(expect.objectContaining({ timeEntries: [T1, T2], expenses: [E1], ownBillingRunId: "run-1" }));
    expect(onRecorded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("valda poster: id:na skickas, och dokumentet byggs på exakt dem", async () => {
    await renderDialog();
    fireEvent.click(box("Möte"));
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(generateKrDoc).toHaveBeenCalled());
    expect(createCalls()).toEqual([{ matterId: "m1", timeEntryIds: ["t1"], expenseIds: ["e1"] }]);
    expect(generateKrDoc).toHaveBeenCalledWith(expect.objectContaining({ timeEntries: [T1], expenses: [E1] }));
  });

  it("servern vägrar: inget dokument, dialogen står kvar med felet", async () => {
    createKr = () => { throw new Error("Någon vald post är redan fakturerad eller tillhör annat ärende."); };
    await renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    expect(await screen.findByText(/redan fakturerad/)).toBeInTheDocument();
    expect(createCalls()).toHaveLength(1);
    expect(generateKrDoc).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ett dokument som misslyckas stoppar inte inskicket", async () => {
    generateKrDoc.mockRejectedValueOnce(new Error("pdf"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
