"use client";

/**
 * Buggar och förslag till intag-repot. Körs PÅ SERVERN — det är där
 * GitHub-token finns — så anropen går direkt till serverns tRPC, inte till
 * routrarna i webbläsaren. Bara när servern annonserar `feedback`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { trpc } from "@/lib/client/trpc";
import { anyClaudeWorking, type FeedbackInput, type FeedbackItem, type FeedbackReply } from "@/lib/shared/feedback";
import { serverTrpcClient as server } from "./server-trpc-client";

const MINE_KEY = ["server", "feedback.mine"] as const;

/** Hur ofta knappen frågar efter nya meddelanden (den röda pricken). */
export const FEEDBACK_POLL_MS = 5 * 60_000;

/** …och medan Claude arbetar med en förfrågan: svaret ska synas så fort det finns. */
export const FEEDBACK_WORKING_POLL_MS = 30_000;

/** Intervallet för omhämtning: tätare medan Claude arbetar. */
export function feedbackPollInterval(items: readonly FeedbackItem[] | undefined): number {
  return anyClaudeWorking(items ?? []) ? FEEDBACK_WORKING_POLL_MS : FEEDBACK_POLL_MS;
}

/** Kan servern ta emot förfrågningar? */
export function useFeedbackEnabled(): boolean {
  return useCapabilities().feedback;
}

/** Mina förfrågningar, deras status och dialog — hämtas om var 5:e minut (var 30:e s medan Claude arbetar) och vid fokus. */
export function useMyFeedback() {
  return useQuery({
    queryKey: MINE_KEY,
    queryFn: (): Promise<FeedbackItem[]> => server().feedback.mine.query(),
    refetchInterval: (query) => feedbackPollInterval(query.state.data),
    refetchOnWindowFocus: true,
  });
}

/** Skicka en förfrågan; listan hämtas om efteråt. */
export function useSubmitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackInput): Promise<{ number: number }> => server().feedback.submit.mutate(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: MINE_KEY }); },
  });
}

/** Svara i dialogen; listan hämtas om efteråt så svaret syns. */
export function useReplyFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackReply): Promise<{ ok: true }> => server().feedback.reply.mutate(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: MINE_KEY }); },
  });
}

/** Användarinställningen som håller "senast läst" per förfrågan (synkas mellan enheter). */
export const SEEN_PREF_KEY = "feedback.seen";

/** Bara strängvärden (förfrågans nummer → ISO-tid) — allt annat ignoreras. */
function seenFrom(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(raw ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/**
 * När användaren senast läste dialogen om varje förfrågan. Lagras i
 * användarens prefs, så pricken försvinner på alla enheter; uppdateras lokalt
 * direkt så den inte blinkar medan sparandet går.
 */
export function useFeedbackSeen(): { seen: Record<string, string>; markSeen: (number: number, at: string) => void } {
  const stored = trpc.prefs.get.useQuery({ key: SEEN_PREF_KEY });
  const save = trpc.prefs.save.useMutation();
  const [local, setLocal] = useState<Record<string, string>>({});
  const seen = { ...seenFrom(stored.data?.user), ...local };
  const markSeen = (number: number, at: string): void => {
    if ((seen[String(number)] ?? "") >= at) return;
    const next = { ...seen, [String(number)]: at };
    setLocal(next);
    save.mutate({ key: SEEN_PREF_KEY, prefs: next });
  };
  return { seen, markSeen };
}
