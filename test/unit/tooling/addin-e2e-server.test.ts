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
import { friendlyError, searchMatters } from "@/lib/client/addin/taskpane-controller";
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
      time: { minutes: 15, description: "Genomgång av underlag" },
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const res = await handler(new Request(`${ORIGIN}/__e2e/matter/${encodeURIComponent(m.id)}`));
    const saved = (await res.json()) as { mails: { title: string; content: string | null }[]; time: { minutes: number; description: string }[] };
    const mail = saved.mails.find((x) => x.title === "Ang. bouppteckning");
    expect(mail?.content).toBe(ADDIN_E2E_EML);
    expect(saved.time).toContainEqual({ minutes: 15, description: "Genomgång av underlag" });
  });

  it("sök på klientens namn hittar ärendet, och klienten följer med i träffen", async () => {
    const { matters } = await client("e2e-admin").matter.list.query({ pageSize: 50 });
    const withClient = matters.find((m) => m.contacts[0]?.contact.name);
    const name = withClient?.contacts[0]?.contact.name ?? "";
    expect(name).not.toBe("");
    const hits = await searchMatters(client("e2e-admin"), name.split(" ").at(-1) ?? name);
    expect(hits.find((h) => h.id === withClient?.id)?.client).toBe(name);
  });

  it("dubblettskydd: samma mejl i samma ärende sparas och tidsbokförs bara en gång", async () => {
    const { matters } = await client("e2e-admin").matter.list.query({ pageSize: 2 });
    const [m1, m2] = matters;
    if (!m1 || !m2) throw new Error("seeden har för få ärenden");
    const messageId = "<dubblett-test@mail.example.se>";
    const save = (matterId: typeof m1.id) => saveIncomingMail({
      client: client("e2e-lawyer"), graphToken: ADDIN_E2E_MAIL_TOKEN, mimeBaseUrl: `${ORIGIN}/graph/v1.0`,
      restId: "rest-dup", matterId, subject: "Dubblett-test", receivedAt: "2026-11-11T08:00:00.000Z",
      internetMessageId: messageId, time: { minutes: 30, description: "Läst mejlet" },
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const findSaved = (matterId: typeof m1.id) =>
      client("e2e-lawyer").mail.findSaved.query({ matterId, internetMessageId: messageId });

    expect((await findSaved(m1.id)).saved).toBe(false);
    const first = await save(m1.id);
    const second = await save(m1.id);
    expect(Reflect.get(first as object, "duplicateOf")).toBeNull();
    expect(Reflect.get(second as object, "duplicateOf")).toBeTruthy();
    expect((await findSaved(m1.id)).saved).toBe(true);
    // Samma mejl i ett annat ärende är ingen dubblett.
    expect((await findSaved(m2.id)).saved).toBe(false);

    const saved = (await (await handler(new Request(`${ORIGIN}/__e2e/matter/${encodeURIComponent(m1.id)}`))).json()) as {
      mails: { title: string }[]; time: { minutes: number; description: string }[];
    };
    expect(saved.mails.filter((x) => x.title === "Dubblett-test")).toHaveLength(1);
    expect(saved.time.filter((t) => t.description === "Läst mejlet")).toHaveLength(1);
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
