/**
 * Kontraktet mellan Outlook-tillägget och AVA-servern (lager 4), headless:
 * tilläggets RIKTIGA klient (`createAddinClient` + `saveIncomingMail`) mot
 * den RIKTIGA tRPC-handlern med seedad backend, via E2E-serverns handler.
 * Samma server driver Playwright-E2E:n (test/e2e/addin/).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest-compat";
import { createAddinClient, type AddinFetch } from "@/lib/client/addin/addin-client";
import { saveIncomingMail } from "@/lib/client/addin/save-incoming-mail";
import { friendlyError } from "@/lib/client/addin/taskpane-controller";
import type { MatterId } from "@/lib/shared/schemas/ids";
import {
  ADDIN_E2E_EML, ADDIN_E2E_MAIL_TOKEN, createAddinE2eHandler,
} from "../../../tooling/scripts/addin-e2e-server";

const ORIGIN = "http://addin.test";
const dist = mkdtempSync(join(tmpdir(), "ava-addin-dist-"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "taskpane.html"), "<!doctype html><title>pane</title>");
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const handler = createAddinE2eHandler(dist);
const fetchVia: AddinFetch = (input, init) => handler(new Request(input, init));
const client = (token: string) => createAddinClient({ baseUrl: ORIGIN, token, fetch: fetchVia });

async function firstMatter(): Promise<{ id: MatterId; matterNumber: string }> {
  const { matters } = await client("e2e-admin").matter.list.query({ pageSize: 1 });
  const m = matters[0];
  if (!m) throw new Error("seeden saknar ärenden");
  return { id: m.id, matterNumber: m.matterNumber };
}

describe("tillägget mot AVA-servern", () => {
  it("söker ärenden som den inloggade användaren", async () => {
    const m = await firstMatter();
    const { matters } = await client("e2e-admin").matter.list.query({ search: m.matterNumber, pageSize: 8 });
    expect(matters.map((x) => x.matterNumber)).toContain(m.matterNumber);
  });

  it("okänd token ger ingen identitet; skälet når klienten så att panelen kan förklara", async () => {
    const err: unknown = await client("fel-token").matter.list.query({ pageSize: 1 }).then(() => null, (e: unknown) => e);
    expect(friendlyError(err)).toContain("kände inte igen inloggningen");
  });

  it("en förfalskad x-auth-request-email ignoreras (proxyn skriver över den)", async () => {
    const forged: AddinFetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-auth-request-email", "user@firma.local");
      return handler(new Request(input, { ...init, headers }));
    };
    const c = createAddinClient({ baseUrl: ORIGIN, token: "fel-token", fetch: forged });
    await expect(c.matter.list.query({ pageSize: 1 })).rejects.toThrow();
  });

  it("Graph-fejken kräver Mail.Read-token:en", async () => {
    const url = `${ORIGIN}/graph/v1.0/me/messages/x/$value`;
    expect((await handler(new Request(url))).status).toBe(401);
    const ok = await handler(new Request(url, { headers: { authorization: `Bearer ${ADDIN_E2E_MAIL_TOKEN}` } }));
    expect(await ok.text()).toBe(ADDIN_E2E_EML);
  });

  it("sparar mejlet (exakta bytes) och tidsposten på ärendet", async () => {
    const m = await firstMatter();
    await saveIncomingMail({
      client: client("e2e-lawyer"),
      graphToken: ADDIN_E2E_MAIL_TOKEN,
      mimeBaseUrl: `${ORIGIN}/graph/v1.0`,
      restId: "rest-1",
      matterId: m.id,
      subject: "Ang. bouppteckning",
      receivedAt: "2026-11-10T09:30:00.000Z",
      time: { minutes: 15 },
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const res = await handler(new Request(`${ORIGIN}/__e2e/matter/${encodeURIComponent(m.id)}`));
    const saved = (await res.json()) as { mails: { title: string; content: string | null }[]; time: { minutes: number }[] };
    const mail = saved.mails.find((x) => x.title === "Ang. bouppteckning");
    expect(mail?.content).toBe(ADDIN_E2E_EML);
    expect(saved.time.some((t) => t.minutes === 15)).toBe(true);
  });

  it("serverar tilläggets filer under /addin/ och vägrar sökvägar utanför dist", async () => {
    expect((await handler(new Request(`${ORIGIN}/addin/taskpane.html`))).status).toBe(200);
    expect((await handler(new Request(`${ORIGIN}/taskpane.html`))).status).toBe(404);
    expect((await handler(new Request(`${ORIGIN}/addin/../package.json`))).status).toBe(404);
  });

  it("config.js ger fasta token och Graph-fejken på samma origin", async () => {
    const js = await (await handler(new Request(`${ORIGIN}/addin/config.js`))).text();
    expect(js).toContain(`"graphBaseUrl":"${ORIGIN}/graph/v1.0"`);
    expect(js).toContain(`"ava":"e2e-lawyer"`);
  });
});
