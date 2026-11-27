/**
 * Hur långt en förfrågan kommit (#2216): tidslinjen med klara, pågående och
 * kommande steg, uppskattningen (eller vad den väntar på), delarna med mätare
 * — och ingenting alls när förfrågan saknar `progress`.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import { FeedbackProgress } from "@/components/shell/feedback-progress";
import type { FeedbackItem, FeedbackProgress as Progress } from "@/lib/shared/feedback";

const PARTS: Progress["parts"] = [
  { title: "Flytta en tidspost", state: "klar" },
  { title: "Flytta ett dokument", state: "pagar" },
  { title: "Flytta ett mejl", state: "i_ko" },
];

const progress = (over: Partial<Progress> = {}): Progress => ({
  parts: PARTS, done: 1, total: 3, approvedAt: "2026-11-23T10:00:00Z",
  eta: { kind: "range", label: "inom 1–2 dagar", reason: "Två delar återstår. AVA bygger ungefär 20 delar per dygn just nu." },
  ...over,
});

const item = (over: Partial<FeedbackItem> = {}): FeedbackItem => ({
  number: 7, title: "Flytta", kind: "feature", state: "pagar", createdAt: "2026-11-22T10:00:00Z",
  release: null, messages: [], canReply: true, attachments: [], progress: progress(), ...over,
});

function steps(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Tidslinje" })).getAllByRole("listitem");
}

describe("FeedbackProgress", () => {
  it("byggs: tidslinjen, uppskattningen med skäl och delarna", () => {
    render(<FeedbackProgress item={item()} />);
    const [received, approved, building, delivery] = steps();
    expect(received).toHaveTextContent(/Mottaget.*\(klart\)/);
    expect(received).toHaveTextContent("22 nov");
    expect(approved).toHaveTextContent(/Godkänt.*\(klart\)/);
    expect(approved).toHaveTextContent("23 nov");
    expect(building).toHaveTextContent("Byggs: 1 av 3 delar klara (pågår nu)");
    expect(building).toHaveAttribute("aria-current", "step");
    expect(delivery).toHaveTextContent(/Levereras \(kommer\)/);
    expect(delivery).toHaveTextContent("Kommer med en uppdatering av AVA när sista delen är klar");

    expect(screen.getByRole("status")).toHaveTextContent("Uppskattning: inom 1–2 dagar");
    expect(screen.getByRole("status")).toHaveTextContent("Två delar återstår.");

    const bar = screen.getByRole("progressbar", { name: "1 av 3 delar klara" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    const parts = within(screen.getByRole("list", { name: "Delar" })).getAllByRole("listitem");
    expect(parts.map((p) => p.textContent)).toEqual([
      "✓Flytta en tidspost (klar)", "●Flytta ett dokument (pågår)", "○Flytta ett mejl (i kön)",
    ]);
  });

  it("väntar på beslut: ingen tidsuppskattning, delen markerad", () => {
    const parts: Progress["parts"] = [{ title: "Flytta ett dokument", state: "vantar_beslut" }];
    render(<FeedbackProgress item={item({ progress: progress({ parts, done: 0, total: 1, eta: { kind: "waiting", on: "beslut" } }) })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Väntar på beslut");
    expect(screen.queryByText(/Uppskattning:/)).not.toBeInTheDocument();
    expect(screen.getByText(/Flytta ett dokument/)).toHaveTextContent("(väntar på beslut)");
  });

  it("väntar på ditt svar", () => {
    render(<FeedbackProgress item={item({ state: "vantar_pa_dig", progress: progress({ eta: { kind: "waiting", on: "dig" } }) })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Väntar på ditt svar");
  });

  it("alla delar klara: levereras är steget som pågår, med nästa uppdatering", () => {
    const done = PARTS.map((p) => ({ ...p, state: "klar" as const }));
    render(<FeedbackProgress item={item({ progress: progress({ parts: done, done: 3, eta: { kind: "next_release" } }) })} />);
    const [, , building, delivery] = steps();
    expect(building).toHaveTextContent("(klart)");
    expect(delivery).toHaveTextContent("Levereras (pågår nu)");
    expect(screen.getByRole("status")).toHaveTextContent("Uppskattning: med nästa uppdatering");
  });

  it("levererad: sista steget visar versionen, ingen uppskattning", () => {
    const done = PARTS.map((p) => ({ ...p, state: "klar" as const }));
    render(<FeedbackProgress item={item({ state: "levererad", release: "v1.4.0", progress: progress({ parts: done, done: 3, eta: null }) })} />);
    const all = steps();
    expect(all.at(-1)).toHaveTextContent("Levererat i v1.4.0 (klart)");
    expect(all.every((s) => s.textContent.includes("(klart)"))).toBe(true);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("levererad utan version, och godkänt utan datum", () => {
    render(<FeedbackProgress item={item({ state: "levererad", progress: progress({ approvedAt: null, eta: null }) })} />);
    const [, approved, , delivery] = steps();
    expect(approved?.textContent).toBe("✓Godkänt (klart)");
    expect(delivery).toHaveTextContent("Levererat (klart)");
  });

  it("utan progress: inget alls", () => {
    const { container } = render(<FeedbackProgress item={item({ progress: undefined })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
