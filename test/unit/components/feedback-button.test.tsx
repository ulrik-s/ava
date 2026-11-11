/**
 * "Bugg eller förslag" i sidofältet: syns bara när servern kan ta emot
 * förfrågningar; skickar typ/rubrik/text + sidan och webbläsaren; visar
 * användarens förfrågningar i en tabell med röd prick för nya meddelanden;
 * öppnar dialogen, markerar den som läst och låter användaren svara.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { FeedbackItem } from "@/lib/shared/feedback";

let enabled = true;
let items: FeedbackItem[] = [];
let seen: Record<string, string> = {};
let submitError: { message: string } | null = null;
const submitMutate = vi.fn();
const replyMutate = vi.fn();
const markSeen = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/matters/7" }));
vi.mock("@/lib/client/backend/server-feedback", () => ({
  useFeedbackEnabled: () => enabled,
  useMyFeedback: () => ({ data: items }),
  useSubmitFeedback: () => ({ mutate: submitMutate, isPending: false, error: submitError }),
  useReplyFeedback: () => ({ mutate: replyMutate, isPending: false, error: null }),
  useFeedbackSeen: () => ({ seen, markSeen }),
}));

const { FeedbackButton } = await import("@/components/shell/feedback-button");

const QUESTION = { id: 11, from: "claude" as const, body: "Vilken faktura gäller det?", createdAt: "2026-11-10T08:00:00Z" };
const item = (over: Partial<FeedbackItem>): FeedbackItem => ({
  number: 1, title: "Fel summa", kind: "bug", state: "mottagen", createdAt: "2026-11-09T10:00:00Z",
  release: null, messages: [], canReply: true, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  enabled = true;
  items = [];
  seen = {};
  submitError = null;
});

function openDialog(): void {
  render(<FeedbackButton />);
  fireEvent.click(screen.getByRole("button", { name: /Bugg eller förslag/ }));
}

describe("FeedbackButton — knappen", () => {
  it("syns inte när servern inte kan ta emot förfrågningar", () => {
    enabled = false;
    const { container } = render(<FeedbackButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("visar antalet förfrågningar med olästa meddelanden", () => {
    items = [item({ number: 1, messages: [QUESTION] }), item({ number: 2, messages: [QUESTION] }), item({ number: 3 })];
    seen = { "2": "2026-11-10T09:00:00Z" };
    render(<FeedbackButton />);
    expect(screen.getByRole("button", { name: "Bugg eller förslag — 1 med nytt meddelande" })).toHaveTextContent("1");
  });

  it("ikonläge visar bara ikonen", () => {
    render(<FeedbackButton iconOnly />);
    expect(screen.getByRole("button", { name: "Bugg eller förslag" })).not.toHaveTextContent("Bugg");
  });
});

describe("FeedbackButton — ny förfrågan", () => {
  it("skickar typ, rubrik, text, sida och webbläsare", () => {
    openDialog();
    fireEvent.click(screen.getByLabelText("Förslag"));
    fireEvent.change(screen.getByLabelText("Rubrik"), { target: { value: "Exportera till Excel" } });
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Jag vill kunna exportera listan." } });
    fireEvent.click(screen.getByRole("button", { name: "Skicka" }));
    expect(submitMutate).toHaveBeenCalledWith(
      { kind: "feature", title: "Exportera till Excel", body: "Jag vill kunna exportera listan.", page: "/matters/7", userAgent: navigator.userAgent },
      expect.anything(),
    );
  });

  it("tackar med numret när förfrågan är mottagen", () => {
    submitMutate.mockImplementation((_input: unknown, opts: { onSuccess: (r: { number: number }) => void }) => { opts.onSuccess({ number: 12 }); });
    openDialog();
    fireEvent.change(screen.getByLabelText("Rubrik"), { target: { value: "Fel summa" } });
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Summan blir fel på fakturan." } });
    fireEvent.click(screen.getByRole("button", { name: "Skicka" }));
    expect(screen.getByRole("status")).toHaveTextContent("nr 12");
  });

  it("visar serverns fel", () => {
    submitError = { message: "Högst 5 förfrågningar i timmen" };
    openDialog();
    expect(screen.getByRole("alert")).toHaveTextContent("Högst 5");
  });
});

describe("FeedbackButton — tabellen", () => {
  it("tom lista", () => {
    openDialog();
    expect(screen.getByText("Inga förfrågningar ännu.")).toBeInTheDocument();
  });

  it("en rad per pågående förfrågan, oläst först, med röd prick; avslutade bakom en knapp", () => {
    items = [
      item({ number: 2, title: "Excel-export", kind: "feature", state: "levererad", release: "v0.5.0", canReply: false }),
      item({ number: 3, title: "Pågår", state: "pagar", createdAt: "2026-11-10T11:00:00Z" }),
      item({ number: 1, state: "vantar_pa_dig", messages: [QUESTION] }),
    ];
    openDialog();
    const [, first, second, ...rest] = screen.getAllByRole("row");
    if (!first || !second) throw new Error("två rader väntades");
    expect(rest).toHaveLength(0);
    expect(within(first).getByText("Väntar på ditt svar")).toBeInTheDocument();
    expect(within(first).getByRole("img", { name: "Nytt meddelande" })).toBeInTheDocument();
    expect(within(second).getByText("Under arbete")).toBeInTheDocument();
    expect(screen.queryByText("Levererad i v0.5.0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Visa avslutade (1)" }));
    expect(screen.getByText("Levererad i v0.5.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dölj avslutade" }));
    expect(screen.queryByText("Levererad i v0.5.0")).not.toBeInTheDocument();
  });

  it("med förfrågningar ligger formuläret bakom + Ny förfrågan", () => {
    items = [item({})];
    openDialog();
    expect(screen.queryByLabelText("Rubrik")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Ny förfrågan" }));
    expect(screen.getByLabelText("Rubrik")).toBeInTheDocument();
  });
});

describe("FeedbackButton — dialogen", () => {
  it("öppnar tråden, visar meddelandena och markerar den som läst", () => {
    items = [item({ state: "vantar_pa_dig", messages: [QUESTION, { id: 12, from: "du", body: "Faktura 17", createdAt: "2026-11-10T09:00:00Z" }] })];
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /Fel summa/ }));
    expect(screen.getByText("Vilken faktura gäller det?")).toBeInTheDocument();
    expect(screen.getByText("Faktura 17")).toBeInTheDocument();
    expect(screen.getByText(/^Claude ·/)).toBeInTheDocument();
    expect(markSeen).toHaveBeenCalledWith(1, "2026-11-10T09:00:00Z");
  });

  it("svaret skickas med förfrågans nummer", () => {
    items = [item({ state: "vantar_pa_dig", messages: [QUESTION] })];
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /Fel summa/ }));
    fireEvent.change(screen.getByLabelText("Ditt svar"), { target: { value: "Faktura 2026-17" } });
    fireEvent.click(screen.getByRole("button", { name: "Skicka svar" }));
    expect(replyMutate).toHaveBeenCalledWith({ number: 1, body: "Faktura 2026-17" }, expect.anything());
  });

  it("en avslutad förfrågan går inte att svara på; tillbaka till listan", () => {
    items = [item({ state: "avslutad", canReply: false })];
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Visa avslutade (1)" }));
    fireEvent.click(screen.getByRole("button", { name: /Fel summa/ }));
    expect(screen.getByText(/Inga meddelanden ännu/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Ditt svar")).not.toBeInTheDocument();
    expect(markSeen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Alla förfrågningar/ }));
    expect(screen.getByText("Dina förfrågningar")).toBeInTheDocument();
  });
});
