/**
 * "Nytt i AVA" (#2010): rutan öppnas av sig själv efter en uppdatering och
 * markeras som sedd när den stängs; användarens egna levererade förfrågningar
 * visas under versionen; länken bredvid versionen öppnar nyheterna igen.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { FeedbackItem } from "@/lib/shared/feedback";
import type { ReleaseNote } from "@/lib/shared/release-notes";

let notes: ReleaseNote[] | undefined;
let seen: string | null = null;
let feedbackEnabled = true;
let items: FeedbackItem[] = [];
const writeSeen = vi.fn((v: string) => { seen = v; });

vi.mock("@/lib/client/backend/server-release-notes", () => ({
  useReleaseNotes: () => ({ data: notes }),
  readSeenRelease: () => seen,
  writeSeenRelease: (v: string) => writeSeen(v),
}));
vi.mock("@/lib/client/backend/server-feedback", () => ({
  useFeedbackEnabled: () => feedbackEnabled,
  useMyFeedback: () => ({ data: items }),
}));

process.env.NEXT_PUBLIC_AVA_VERSION = "v0.7.55";
const { ReleaseNotesLink, ReleaseNotesOnUpdate } = await import("@/components/shell/release-notes");

const NOTES: ReleaseNote[] = [
  { version: "v0.7.55", date: "2026-11-23T10:00:00Z", items: ["Ny knapp för att skicka fakturan."] },
  { version: "v0.7.54", date: "", items: ["Kolumnen Storlek är borta."] },
];
const item = (over: Partial<FeedbackItem>): FeedbackItem => ({
  number: 1, title: "Skicka faktura", kind: "feature", state: "levererad", createdAt: "2026-11-20T10:00:00Z",
  release: "v0.7.55", messages: [], canReply: false, attachments: [], ...over,
});

beforeEach(() => {
  notes = NOTES;
  seen = "v0.7.53";
  feedbackEnabled = true;
  items = [];
  writeSeen.mockClear();
});

describe("ReleaseNotesOnUpdate", () => {
  it("visar versionerna användaren inte sett, och egna levererade förfrågningar", () => {
    items = [item({}), item({ number: 2, title: "Annan", release: "v0.7.40" })];
    render(<ReleaseNotesOnUpdate />);
    expect(screen.getByRole("dialog", { name: "Nytt i AVA" })).toBeTruthy();
    expect(screen.getByText("Ny knapp för att skicka fakturan.")).toBeTruthy();
    expect(screen.getByText("Kolumnen Storlek är borta.")).toBeTruthy();
    expect(screen.getByText("2026-11-23")).toBeTruthy();
    expect(screen.getByText('Din förfrågan finns med: "Skicka faktura"')).toBeTruthy();
    expect(screen.queryByText(/Annan/)).toBeNull();
  });

  it("stängd = sedd fram till versionen som kör", () => {
    render(<ReleaseNotesOnUpdate />);
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    expect(writeSeen).toHaveBeenCalledWith("v0.7.55");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("inget att visa: redan sett, inga nyheter än, eller utan förfrågningar", () => {
    seen = "v0.7.55";
    const { unmount } = render(<ReleaseNotesOnUpdate />);
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    notes = undefined;
    render(<ReleaseNotesOnUpdate />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("utan förfrågningsknappen visas inga egna förfrågningar", () => {
    feedbackEnabled = false;
    items = [item({})];
    render(<ReleaseNotesOnUpdate />);
    expect(screen.queryByText(/Din förfrågan/)).toBeNull();
  });
});

describe("ReleaseNotesLink", () => {
  it("öppnar de senaste nyheterna och stängs igen", () => {
    seen = "v0.7.55";
    render(<ReleaseNotesLink />);
    fireEvent.click(screen.getByRole("button", { name: "Nytt i AVA" }));
    expect(screen.getByText("Kolumnen Storlek är borta.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("syns inte utan nyheter", () => {
    notes = [];
    const { container } = render(<ReleaseNotesLink />);
    expect(container.innerHTML).toBe("");
  });
});
