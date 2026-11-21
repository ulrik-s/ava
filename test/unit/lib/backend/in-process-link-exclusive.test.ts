/**
 * `inProcessLink` kör ALLA mutationer exklusivt (#1794), i demo och self-hosted.
 *
 * Två samtidiga mutationer delar `LocalStore`:s transaktionsbuffert. Utan
 * låset tar den andra den reentranta grenen medan den första pågår, och när
 * den första kastar rullas den andras skrivningar tillbaka med den.
 */
import { describe, expect, it } from "vitest-compat";
import { inProcessLink, type ProcedureRecorder } from "@/lib/client/demo/in-process-link";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = "demo-firma-ab";
const MATTER = "0190a1b2-0000-7000-8000-00000000000a";
const DOC = "0190a1b2-0000-7000-8000-00000000000d";
const Q = { mutationId: "01928f3a-1b2c-7d4e-8f00-112233445566", at: Date.UTC(2026, 0, 2) };
const recorder: ProcedureRecorder = async (_call, exec) => exec(Q);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

type Op = { type: "query" | "mutation"; path: string; input: unknown };
type Creatable = { create: (a: unknown) => Promise<unknown> };

/** Kör en operation direkt genom länken och vänta in svaret. */
function invoke(link: ReturnType<typeof inProcessLink>, op: Op): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obs = (link as any)({})({ op: { ...op, id: 0, context: {} }, next: () => {} });
  return new Promise((resolve, reject) => obs.subscribe({ next: (v: { result: { data: unknown } }) => resolve(v.result.data), error: reject }));
}

const contact = (name: string): Op => ({ type: "mutation", path: "contacts.create", input: { name, contactType: "PERSON" } });

/** En skrivbar store med en jurist, ett ärende och ett dokument, och en grind testet släpper. */
function setup() {
  const events: MutationEvent<Record<string, unknown>>[] = [];
  const ds = new DemoDataStore({
    users: [{ id: "u1", organizationId: ORG, name: "Jurist", email: "j@x.se", role: "ADMIN" }],
    matters: [{ id: MATTER, organizationId: ORG, title: "Ärende", status: "ACTIVE", matterNumber: "2026-1" }],
    documents: [{ id: DOC, organizationId: ORG, matterId: MATTER, fileName: "a.pdf", storagePath: "a.pdf" }],
  }, (e) => { events.push(e); });
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const principal = new GitAuthProvider({ organizationId: asId<"OrganizationId">(ORG), id: asId<"UserId">("u1") }).getPrincipal();
  const ctx: Context = buildContext({ dataStore: ds, ports: buildGitPorts(ds), principal });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (name: string): Creatable => (ds as any)[name] as Creatable;
  return { ds, events, gate, release, ctx, delegate };
}

describe.each([
  ["demo (utan recordProcedure)", {}],
  ["self-hosted (med recordProcedure)", { recordProcedure: recorder }],
])("inProcessLink — samtidiga mutationer, %s", (_name, opts) => {
  it("den första kastar: den andras skrivningar står kvar och skickas till write-back exakt en gång", async () => {
    const { ds, events, gate, release, ctx, delegate } = setup();
    // Ärendets första mapp väntar på grinden och kastar: `matter.create` har
    // då skrivit ärendet i sin transaktion när den fallerar.
    const state = { entered: false };
    delegate("documentFolders").create = async () => { state.entered = true; await gate; throw new Error("mappen fallerar"); };
    const link = inProcessLink(ctx, opts);
    const first = invoke(link, { type: "mutation", path: "matter.create", input: { title: "Nytt", clientName: "K" } });
    while (!state.entered) await tick(); // den första står mitt i sin transaktion
    const second = invoke(link, contact("Kontakt"));
    await tick();
    release();
    await expect(first).rejects.toThrow("mappen fallerar");
    const created = (await second) as { id: string };
    expect(await ds.contacts.findFirst({ where: { id: created.id } })).toMatchObject({ name: "Kontakt" });
    expect(await ds.matters.findMany({})).toHaveLength(1);
    expect(events.filter((e) => JSON.stringify(e).includes(created.id))).toHaveLength(1);
  });

  it("en mutation väntar tills den pågående är klar, även när ingen av dem är köbar", async () => {
    const { gate, release, ctx, delegate } = setup();
    const contacts = delegate("contacts");
    const original = contacts.create.bind(contacts);
    let first = true;
    contacts.create = async (a) => { if (first) { first = false; await gate; } return original(a); };
    const link = inProcessLink(ctx, opts);
    const done: string[] = [];
    const a = invoke(link, contact("A")).then(() => done.push("första"));
    const b = invoke(link, contact("B")).then(() => done.push("andra"));
    await tick();
    expect(done).toEqual([]);
    release();
    await Promise.all([a, b]);
    expect(done).toEqual(["första", "andra"]);
  });

  it("en mutation som köar ett klientjobb blir klar under låset (inget dödläge)", async () => {
    const { ds, ctx } = setup();
    let job: Promise<unknown> = Promise.resolve();
    // Som demoanalysatorn: köar ett jobb som självt anropar länken, och väntar inte på det.
    const documentAnalyzer = { analyze: (): Promise<void> => { job = invoke(link, contact("Jobb")); return Promise.resolve(); } };
    const link = inProcessLink({ ...ctx, ports: { ...ctx.ports, documentAnalyzer } }, opts);
    await expect(invoke(link, { type: "mutation", path: "document.analyze", input: { documentId: DOC } })).resolves.toEqual({ ok: true });
    const created = (await job) as { id: string };
    expect(await ds.contacts.findFirst({ where: { id: created.id } })).toMatchObject({ name: "Jobb" });
  });
});
