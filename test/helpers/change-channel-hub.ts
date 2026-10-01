/**
 * Flikar i tester (#1346): en hubb som delar ut `ChangeChannel`s. Ett
 * meddelande från en kanal når de ANDRA kanalernas lyssnare direkt (synkront),
 * precis som `BroadcastChannel` men utan väntan.
 */
import type { ChangeChannel } from "@/lib/server/data-store/in-memory/change-channel";

export function changeChannelHub(): () => ChangeChannel {
  const channels: Set<() => void>[] = [];
  return () => {
    const mine = new Set<() => void>();
    channels.push(mine);
    return {
      post: () => {
        for (const other of channels) if (other !== mine) for (const listener of other) listener();
      },
      subscribe: (listener) => {
        mine.add(listener);
        return () => { mine.delete(listener); };
      },
    };
  };
}

/** Vänta tills väntande löften (omläsningar efter ett meddelande) körts klart. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
