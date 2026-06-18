/**
 * Tester för `ExternalEditIndicator` (#27 coverage) — shell-bannern som visar
 * väntande externa edit-sessions och låter användaren trigga commit ("Spara
 * nu"). `ExternalEditTracker` mockas; komponenten pollar var 1000 ms via
 * setInterval → vi använder fake timers + `act` för att flusha poll-ticken.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { ExternalEditIndicator } from "@/components/documents/external-edit-indicator";
import type { EditSession } from "@/lib/client/fsa/external-edit-tracker";

const flushNowMock = vi.fn(async () => {});
let tracker: { listSessions: () => EditSession[]; flushNow: (id: string) => Promise<void> } | null;

vi.mock("@/lib/client/fsa/external-edit-tracker", () => ({
  getExternalEditTracker: () => tracker,
}));

/** Rendera + flusha en poll-tick (intervallet läser trackern var 1000 ms). */
async function renderAndPoll(): Promise<void> {
  render(<ExternalEditIndicator />);
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  flushNowMock.mockClear();
  tracker = { listSessions: () => [], flushNow: flushNowMock };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExternalEditIndicator", () => {
  it("inga väntande sessions → renderar inget", async () => {
    await renderAndPoll();
    expect(screen.queryByText(/Externa ändringar väntar/)).not.toBeInTheDocument();
  });

  it("trackern saknas (null) → tål det och renderar inget", async () => {
    tracker = null;
    await renderAndPoll();
    expect(screen.queryByText(/Externa ändringar väntar/)).not.toBeInTheDocument();
  });

  it("visar filnamn (sista path-segmentet) + sparningar i plural", async () => {
    tracker = {
      listSessions: () => [{ docId: "d1", path: "matters/abc/avtal.docx", saves: 3, startedAt: 1000 }],
      flushNow: flushNowMock,
    };
    await renderAndPoll();
    expect(screen.getByText(/Externa ändringar väntar/)).toBeInTheDocument();
    expect(screen.getByText("avtal.docx")).toBeInTheDocument();
    expect(screen.getByText(/\(3 sparningar\)/)).toBeInTheDocument();
  });

  it("en sparning → singularformen 'sparning'", async () => {
    tracker = {
      listSessions: () => [{ docId: "d1", path: "x/y/fil.txt", saves: 1, startedAt: 1000 }],
      flushNow: flushNowMock,
    };
    await renderAndPoll();
    expect(screen.getByText(/\(1 sparning\)/)).toBeInTheDocument();
    expect(screen.queryByText(/\(1 sparningar\)/)).not.toBeInTheDocument();
  });

  it("flera sessions → en rad per dokument", async () => {
    tracker = {
      listSessions: () => [
        { docId: "d1", path: "a/one.docx", saves: 2, startedAt: 1000 },
        { docId: "d2", path: "b/two.pdf", saves: 5, startedAt: 2000 },
      ],
      flushNow: flushNowMock,
    };
    await renderAndPoll();
    expect(screen.getByText("one.docx")).toBeInTheDocument();
    expect(screen.getByText("two.pdf")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Spara nu/ })).toHaveLength(2);
  });

  it("'Spara nu' kallar tracker.flushNow med rätt docId", async () => {
    tracker = {
      listSessions: () => [{ docId: "doc-42", path: "p/akt.docx", saves: 1, startedAt: 1000 }],
      flushNow: flushNowMock,
    };
    await renderAndPoll();
    fireEvent.click(screen.getByRole("button", { name: /Spara nu/ }));
    expect(flushNowMock).toHaveBeenCalledWith("doc-42");
  });
});
