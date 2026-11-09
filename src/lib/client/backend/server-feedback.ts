"use client";

/**
 * Buggar och förslag till intag-repot. Körs PÅ SERVERN — det är där
 * GitHub-token finns — så anropen går direkt till serverns tRPC, inte till
 * routrarna i webbläsaren. Bara när servern annonserar `feedback`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import type { FeedbackInput, FeedbackItem } from "@/lib/shared/feedback";
import { serverTrpcClient as server } from "./server-trpc-client";

const MINE_KEY = ["server", "feedback.mine"] as const;

/** Kan servern ta emot förfrågningar? */
export function useFeedbackEnabled(): boolean {
  return useCapabilities().feedback;
}

/** Mina förfrågningar och var de är — hämtas när dialogen är öppen. */
export function useMyFeedback(enabled: boolean) {
  return useQuery({
    queryKey: MINE_KEY,
    queryFn: (): Promise<FeedbackItem[]> => server().feedback.mine.query(),
    enabled,
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
