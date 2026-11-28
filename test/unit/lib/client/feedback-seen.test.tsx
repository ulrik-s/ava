/**
 * `useFeedbackSeen`: "senast läst" per förfrågan i användarens prefs, så den
 * röda pricken försvinner på alla enheter — och lokalt direkt.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { callsTo } from "../../../helpers/trpc-both-fake";
import { fakeTrpcWrapper } from "../../../helpers/trpc-fake";

let stored: Record<string, unknown> | null = null;
vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => ({ feedback: true }) }));
vi.mock("@/lib/client/backend/server-trpc-client", () => ({ serverTrpcClient: () => ({}) }));

const { FEEDBACK_POLL_MS, FEEDBACK_WORKING_POLL_MS, feedbackPollInterval, useFeedbackSeen, SEEN_PREF_KEY } = await import("@/lib/client/backend/server-feedback");

/** Kör hooken under en fejkad länk och väntar tills prefs svarat. */
async function renderSeen() {
  const w = fakeTrpcWrapper({ "prefs.get": () => ({ user: stored, org: null }), "prefs.save": () => ({}) });
  const view = renderHook(() => useFeedbackSeen(), { wrapper: w.wrapper });
  await waitFor(() => expect(w.queryClient.isFetching()).toBe(0));
  return { ...w, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = { "1": "2026-11-10T08:00:00Z", junk: 42 };
});

describe("useFeedbackSeen", () => {
  it("läser sparade tider och ignorerar annat än strängar", async () => {
    const { result } = await renderSeen();
    await waitFor(() => expect(result.current.seen).toEqual({ "1": "2026-11-10T08:00:00Z" }));
  });

  it("utan sparade prefs: tomt", async () => {
    stored = null;
    const { result } = await renderSeen();
    expect(result.current.seen).toEqual({});
  });

  it("markSeen sparar en nyare tid och uppdaterar direkt", async () => {
    const { result, fake } = await renderSeen();
    await waitFor(() => expect(result.current.seen["1"]).toBe("2026-11-10T08:00:00Z"));
    act(() => { result.current.markSeen(2, "2026-11-10T09:00:00Z"); });
    expect(result.current.seen["2"]).toBe("2026-11-10T09:00:00Z");
    await waitFor(() => expect(callsTo(fake, "prefs.save")).toEqual([
      { key: SEEN_PREF_KEY, prefs: { "1": "2026-11-10T08:00:00Z", "2": "2026-11-10T09:00:00Z" } },
    ]));
  });

  it("markSeen med samma eller äldre tid sparar inget", async () => {
    const { result, fake, queryClient } = await renderSeen();
    await waitFor(() => expect(result.current.seen["1"]).toBe("2026-11-10T08:00:00Z"));
    act(() => { result.current.markSeen(1, "2026-11-10T08:00:00Z"); });
    act(() => { result.current.markSeen(1, "2026-11-10T07:00:00Z"); });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(callsTo(fake, "prefs.save")).toEqual([]);
  });
});

describe("feedbackPollInterval", () => {
  const base = { number: 1, title: "x", kind: "bug" as const, createdAt: "2026-11-09T10:00:00Z", release: null, messages: [], canReply: true, attachments: [] };

  it("var 30:e sekund medan Claude arbetar, annars var 5:e minut", () => {
    expect(feedbackPollInterval([{ ...base, state: "mottagen" }])).toBe(FEEDBACK_WORKING_POLL_MS);
    expect(feedbackPollInterval([{ ...base, state: "undersokt" }])).toBe(FEEDBACK_POLL_MS);
    expect(feedbackPollInterval(undefined)).toBe(FEEDBACK_POLL_MS);
  });
});
