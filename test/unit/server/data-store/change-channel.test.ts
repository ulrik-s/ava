/**
 * Signal mellan flikar (#1346) — `BroadcastChannel` när den finns, annars ingenting.
 */
import { afterEach, describe, expect, it } from "vitest-compat";
import { broadcastChangeChannel, NO_CHANGE_CHANNEL } from "@/lib/server/data-store/in-memory/change-channel";
import { settle } from "../../../helpers/change-channel-hub";

const original = globalThis.BroadcastChannel;
afterEach(() => { globalThis.BroadcastChannel = original; });

describe("broadcastChangeChannel", () => {
  it("en flik hör en annan fliks meddelande, men inte sitt eget", async () => {
    const a = broadcastChangeChannel("ava-test-channel");
    const b = broadcastChangeChannel("ava-test-channel");
    const heard: string[] = [];
    a.subscribe(() => heard.push("a"));
    b.subscribe(() => heard.push("b"));
    a.post();
    await settle();
    expect(heard).toEqual(["b"]);
  });

  it("avregistrerad lyssnare hör inget mer", async () => {
    const a = broadcastChangeChannel("ava-test-off");
    const b = broadcastChangeChannel("ava-test-off");
    const heard: string[] = [];
    const off = b.subscribe(() => heard.push("b"));
    off();
    a.post();
    await settle();
    expect(heard).toEqual([]);
  });

  it("utan BroadcastChannel → en kanal som inte gör något", () => {
    // @ts-expect-error -- simulerar en miljö utan BroadcastChannel
    globalThis.BroadcastChannel = undefined;
    const channel = broadcastChangeChannel("ava-none");
    expect(channel).toBe(NO_CHANGE_CHANNEL);
    channel.post();
    expect(() => channel.subscribe(() => undefined)()).not.toThrow();
  });
});
