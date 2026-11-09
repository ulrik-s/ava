/**
 * "Bugg eller förslag" i sidofältet: syns bara när servern kan ta emot
 * förfrågningar, skickar typ/rubrik/text + sidan och webbläsaren, och visar
 * användarens tidigare förfrågningar med status.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { FeedbackItem } from "@/lib/shared/feedback";

let enabled = true;
let items: FeedbackItem[] = [];
let error: { message: string } | null = null;
const mutate = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/matters/7" }));
vi.mock("@/lib/client/backend/server-feedback", () => ({
  useFeedbackEnabled: () => enabled,
  useMyFeedback: () => ({ data: items }),
  useSubmitFeedback: () => ({ mutate, isPending: false, error }),
}));

const { FeedbackButton } = await import("@/components/shell/feedback-button");

beforeEach(() => {
  vi.clearAllMocks();
  enabled = true;
  items = [];
  error = null;
});

function openDialog(): void {
  render(<FeedbackButton />);
  fireEvent.click(screen.getByRole("button", { name: "Bugg eller förslag" }));
}

describe("FeedbackButton", () => {
  it("syns inte när servern inte kan ta emot förfrågningar", () => {
    enabled = false;
    const { container } = render(<FeedbackButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("skickar typ, rubrik, text, sida och webbläsare", () => {
    openDialog();
    fireEvent.click(screen.getByLabelText("Förslag"));
    fireEvent.change(screen.getByLabelText("Rubrik"), { target: { value: "Exportera till Excel" } });
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Jag vill kunna exportera listan." } });
    fireEvent.click(screen.getByRole("button", { name: "Skicka" }));
    expect(mutate).toHaveBeenCalledWith(
      { kind: "feature", title: "Exportera till Excel", body: "Jag vill kunna exportera listan.", page: "/matters/7", userAgent: navigator.userAgent },
      expect.anything(),
    );
  });

  it("tackar med numret när förfrågan är mottagen", () => {
    mutate.mockImplementation((_input: unknown, opts: { onSuccess: (r: { number: number }) => void }) => { opts.onSuccess({ number: 12 }); });
    openDialog();
    fireEvent.change(screen.getByLabelText("Rubrik"), { target: { value: "Fel summa" } });
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Summan blir fel på fakturan." } });
    fireEvent.click(screen.getByRole("button", { name: "Skicka" }));
    expect(screen.getByRole("status")).toHaveTextContent("nr 12");
  });

  it("visar serverns fel", () => {
    error = { message: "Högst 5 förfrågningar i timmen" };
    openDialog();
    expect(screen.getByRole("alert")).toHaveTextContent("Högst 5");
  });

  it("listar mina förfrågningar med status och release", () => {
    items = [
      { number: 2, title: "Excel-export", kind: "feature", state: "levererad", createdAt: "2026-11-09", release: "v0.5.0" },
      { number: 1, title: "Fel summa", kind: "bug", state: "mottagen", createdAt: "2026-11-08", release: null },
    ];
    openDialog();
    expect(screen.getByText("Levererad i v0.5.0")).toBeInTheDocument();
    expect(screen.getByText("Mottagen")).toBeInTheDocument();
  });

  it("tom lista", () => {
    openDialog();
    expect(screen.getByText("Inga förfrågningar ännu.")).toBeInTheDocument();
  });

  it("ikonläge visar bara ikonen", () => {
    render(<FeedbackButton iconOnly />);
    expect(screen.getByRole("button", { name: "Bugg eller förslag" })).not.toHaveTextContent("Bugg");
  });
});
