/**
 * Utkasten i förfrågningsknappen (#1786): sparas per förfrågan, tas bort när
 * de skickats, och räknas till sessionen — utloggningen tar bort dem.
 */
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { SESSION_LOCAL_STORAGE_KEYS } from "@/lib/client/backend/local-data/sign-out";
import {
  FEEDBACK_DRAFTS_KEY, loadNewDraft, loadReplyDraft, saveNewDraft, saveReplyDraft, usePersistedDraft,
} from "@/lib/client/feedback/feedback-drafts";

beforeEach(() => { localStorage.clear(); });

describe("utkasten", () => {
  it("en ny förfrågan sparas och tas bort", () => {
    expect(loadNewDraft()).toBeNull();
    saveNewDraft({ kind: "feature", title: "T", body: "B" });
    expect(loadNewDraft()).toEqual({ kind: "feature", title: "T", body: "B" });
    saveNewDraft(null);
    expect(loadNewDraft()).toBeNull();
  });

  it("svaren sparas per förfrågan; tom text tar bort just det", () => {
    saveReplyDraft(1, "ett");
    saveReplyDraft(2, "två");
    saveNewDraft({ kind: "bug", title: "x", body: "y" });
    expect([loadReplyDraft(1), loadReplyDraft(2), loadReplyDraft(3)]).toEqual(["ett", "två", ""]);
    saveReplyDraft(1, "");
    expect([loadReplyDraft(1), loadReplyDraft(2)]).toEqual(["", "två"]);
    expect(loadNewDraft()).not.toBeNull();
  });

  it("trasig lagring ger tomma utkast, och en lagring som vägrar skriva kraschar inget", () => {
    localStorage.setItem(FEEDBACK_DRAFTS_KEY, "{inte json");
    expect(loadNewDraft()).toBeNull();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(() => { saveReplyDraft(1, "x"); }).not.toThrow();
    spy.mockRestore();
  });

  it("räknas till sessionen: utloggningen tar bort dem", () => {
    expect(SESSION_LOCAL_STORAGE_KEYS).toContain(FEEDBACK_DRAFTS_KEY);
  });

  it("formulärets värde sparas vid varje ändring och töms med clear", () => {
    const saved: Array<string | null> = [];
    const { result } = renderHook(() => usePersistedDraft(() => "start", (v: string | null) => { saved.push(v); }, ""));
    expect(result.current[0]).toBe("start");
    act(() => { result.current[1]("ny"); });
    expect(result.current[0]).toBe("ny");
    act(() => { result.current[2](); });
    expect(result.current[0]).toBe("");
    expect(saved).toEqual(["ny", null]);
  });
});
