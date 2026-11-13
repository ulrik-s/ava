/**
 * "Claude arbetar" i förfrågningarna: en ny förfrågan undersöks, och när
 * användaren svarat läses svaret — då visas en pulserande prick och listan
 * hämtas om tätare. En användare som redan svarat väntar inte längre själv.
 */
import { describe, expect, it } from "vitest-compat";
import { anyClaudeWorking, claudeWorkingText, type FeedbackItem, sortForList } from "@/lib/shared/feedback";

const msg = (id: number, from: "claude" | "ulrik" | "du", at: string) => ({ id, from, body: "…", createdAt: at });
const item = (over: Partial<FeedbackItem>): FeedbackItem => ({
  number: 1, title: "Fel summa", kind: "bug", state: "mottagen", createdAt: "2026-11-09T10:00:00Z",
  release: null, messages: [], canReply: true, ...over,
});

describe("claudeWorkingText", () => {
  it("ny förfrågan: Claude undersöker", () => {
    expect(claudeWorkingText(item({}))).toBe("Claude undersöker din förfrågan…");
  });

  it("användaren svarade sist: Claude tittar på svaret, oavsett status", () => {
    const replied = item({ state: "vantar_pa_dig", messages: [msg(1, "claude", "2026-11-10T08:00:00Z"), msg(2, "du", "2026-11-10T09:00:00Z")] });
    expect(claudeWorkingText(replied)).toBe("Claude tittar på ditt svar…");
  });

  it("väntar på användaren, undersökt eller avslutad: arbetar inte", () => {
    expect(claudeWorkingText(item({ state: "vantar_pa_dig", messages: [msg(1, "claude", "2026-11-10T08:00:00Z")] }))).toBeNull();
    expect(claudeWorkingText(item({ state: "undersokt" }))).toBeNull();
    expect(claudeWorkingText(item({ state: "levererad", messages: [msg(1, "du", "2026-11-10T08:00:00Z")] }))).toBeNull();
  });

  it("anyClaudeWorking: någon av dem", () => {
    expect(anyClaudeWorking([item({ state: "undersokt" }), item({})])).toBe(true);
    expect(anyClaudeWorking([item({ state: "undersokt" })])).toBe(false);
    expect(anyClaudeWorking([])).toBe(false);
  });
});

describe("sortForList", () => {
  it("en användare som redan svarat hamnar inte bland det som väntar på hen", () => {
    const waiting = item({ number: 1, state: "vantar_pa_dig", messages: [msg(1, "claude", "2026-11-10T08:00:00Z")] });
    const replied = item({ number: 2, state: "vantar_pa_dig", messages: [msg(2, "claude", "2026-11-10T08:00:00Z"), msg(3, "du", "2026-11-10T09:00:00Z")] });
    const seen = { "1": "2026-11-10T08:00:00Z", "2": "2026-11-10T08:00:00Z" };
    expect(sortForList([replied, waiting], seen).map((i) => i.number)).toEqual([1, 2]);
  });
});
