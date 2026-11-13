/**
 * `useFeedbackSeen`: "senast läst" per förfrågan i användarens prefs, så den
 * röda pricken försvinner på alla enheter — och lokalt direkt.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

let stored: Record<string, unknown> | null = null;
const saveMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    prefs: {
      get: { useQuery: () => ({ data: { user: stored, org: null } }) },
      save: { useMutation: () => ({ mutate: saveMutate }) },
    },
  },
}));
vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => ({ feedback: true }) }));
vi.mock("@/lib/client/backend/server-trpc-client", () => ({ serverTrpcClient: () => ({}) }));

const { FEEDBACK_POLL_MS, FEEDBACK_WORKING_POLL_MS, feedbackPollInterval, useFeedbackSeen, SEEN_PREF_KEY } = await import("@/lib/client/backend/server-feedback");

beforeEach(() => {
  vi.clearAllMocks();
  stored = { "1": "2026-11-10T08:00:00Z", junk: 42 };
});

describe("useFeedbackSeen", () => {
  it("läser sparade tider och ignorerar annat än strängar", () => {
    const { result } = renderHook(() => useFeedbackSeen());
    expect(result.current.seen).toEqual({ "1": "2026-11-10T08:00:00Z" });
  });

  it("utan sparade prefs: tomt", () => {
    stored = null;
    const { result } = renderHook(() => useFeedbackSeen());
    expect(result.current.seen).toEqual({});
  });

  it("markSeen sparar en nyare tid och uppdaterar direkt", () => {
    const { result } = renderHook(() => useFeedbackSeen());
    act(() => { result.current.markSeen(2, "2026-11-10T09:00:00Z"); });
    expect(saveMutate).toHaveBeenCalledWith({ key: SEEN_PREF_KEY, prefs: { "1": "2026-11-10T08:00:00Z", "2": "2026-11-10T09:00:00Z" } });
    expect(result.current.seen["2"]).toBe("2026-11-10T09:00:00Z");
  });

  it("markSeen med samma eller äldre tid sparar inget", () => {
    const { result } = renderHook(() => useFeedbackSeen());
    act(() => { result.current.markSeen(1, "2026-11-10T08:00:00Z"); });
    act(() => { result.current.markSeen(1, "2026-11-10T07:00:00Z"); });
    expect(saveMutate).not.toHaveBeenCalled();
  });
});

describe("feedbackPollInterval", () => {
  const base = { number: 1, title: "x", kind: "bug" as const, createdAt: "2026-11-09T10:00:00Z", release: null, messages: [], canReply: true };

  it("var 30:e sekund medan Claude arbetar, annars var 5:e minut", () => {
    expect(feedbackPollInterval([{ ...base, state: "mottagen" }])).toBe(FEEDBACK_WORKING_POLL_MS);
    expect(feedbackPollInterval([{ ...base, state: "undersokt" }])).toBe(FEEDBACK_POLL_MS);
    expect(feedbackPollInterval(undefined)).toBe(FEEDBACK_POLL_MS);
  });
});
