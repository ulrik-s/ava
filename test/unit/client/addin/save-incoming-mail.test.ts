/**
 * Test för `saveIncomingMail` (#72 slice 2) — orkestrering av add-in-funktion 1:
 * Graph $value → AVA tRPC `mail.saveIncoming`. Alla beroenden injicerade.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { saveIncomingMail, type MailSaverClient } from "@/lib/client/addin/save-incoming-mail";
import type { GraphFetch } from "@/lib/client/graph/graph-mail";
import { asId } from "@/lib/shared/schemas/ids";

const RAW = "Subject: Hej\r\n\r\nKropp";
const graphOk: GraphFetch = vi.fn(async () => new Response(new TextEncoder().encode(RAW), { status: 200 }));

function mockClient() {
  const mutate = vi.fn(async (input: unknown) => ({ document: { id: "doc-x" }, timeEntry: null, _echo: input }));
  const client: MailSaverClient = { mail: { saveIncoming: { mutate } } };
  return { client, mutate };
}

describe("saveIncomingMail", () => {
  it("hämtar .eml via Graph och POST:ar base64 + metadata till AVA", async () => {
    const { client, mutate } = mockClient();
    await saveIncomingMail({
      client, graphToken: "gtok", restId: "id1",
      matterId: asId<"MatterId">("m1"), subject: "Hej", receivedAt: "2026-06-14T08:00:00Z", fetch: graphOk,
    });
    expect(mutate).toHaveBeenCalledWith({
      matterId: "m1",
      emlBase64: Buffer.from(RAW, "utf8").toString("base64"),
      subject: "Hej",
      receivedAt: "2026-06-14T08:00:00Z",
    });
  });

  it("skickar med time + folderId när de anges", async () => {
    const { client, mutate } = mockClient();
    await saveIncomingMail({
      client, graphToken: "g", restId: "id1", matterId: asId<"MatterId">("m1"), subject: "S",
      receivedAt: "2026-06-14T08:00:00Z", time: { minutes: 15, description: "Läsning" },
      folderId: "f1", fetch: graphOk,
    });
    const arg = mutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.time).toEqual({ minutes: 15, description: "Läsning" });
    expect(arg.folderId).toBe("f1");
  });

  it("propagerar Graph-fel (POST:ar inte till AVA)", async () => {
    const { client, mutate } = mockClient();
    const fail: GraphFetch = vi.fn(async () => new Response("no", { status: 403 }));
    await expect(saveIncomingMail({
      client, graphToken: "g", restId: "id1", matterId: asId<"MatterId">("m1"), subject: "S",
      receivedAt: "2026-06-14T08:00:00Z", fetch: fail,
    })).rejects.toThrow(/\$value.*403/);
    expect(mutate).not.toHaveBeenCalled();
  });
});
