/**
 * Signal mellan flikar (#1346): "lagringen ändrades — läs om".
 *
 * Flera flikar delar samma IndexedDB. När en flik skriver i kön eller i
 * listan över avvisade ändringar får de andra veta det och läser om, så att
 * deras räknare stämmer. Meddelandet bär inga data — lagringen är sanningen.
 */

/** En kanal mellan flikarna i samma webbläsare. */
export interface ChangeChannel {
  /** Berätta för de andra flikarna att lagringen ändrats. */
  post(): void;
  /** Lyssna på de andra flikarnas ändringar. Returnerar avregistreringen. */
  subscribe(listener: () => void): () => void;
}

/** Kanalen där `BroadcastChannel` saknas: ingen annan flik att berätta för. */
export const NO_CHANGE_CHANNEL: ChangeChannel = {
  post: () => undefined,
  subscribe: () => () => undefined,
};

/**
 * `BroadcastChannel` med namnet `name`. Samma objekt skickar och tar emot, så
 * fliken hör inte sina egna meddelanden. Kanalen öppnas först när den används.
 */
export function broadcastChangeChannel(name: string): ChangeChannel {
  if (typeof BroadcastChannel === "undefined") return NO_CHANGE_CHANNEL;
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | null = null;
  const open = (): BroadcastChannel => {
    if (channel) return channel;
    channel = new BroadcastChannel(name);
    channel.onmessage = () => { for (const listener of listeners) listener(); };
    return channel;
  };
  return {
    post: () => { open().postMessage("changed"); },
    subscribe: (listener) => {
      open();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
