/**
 * Uppstartsfyllningen som ger frister i kalendern var sin uppgift (#2121),
 * mot minnesrepona och Drizzle-repona (pglite lokalt, riktig Postgres i CI).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { backfillDeadlineTasks } from "@/lib/server/jobs/deadline-task-backfill";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { CalendarEvent, Task } from "@/lib/shared/schemas/calendar";
import { asId, type CalendarEventId, type OrganizationId, type TaskId, type UserId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { uuidv7 } from "@/lib/shared/uuid";
import { deadlineItems } from "@/lib/shared/watchlist";
import { DRIZZLE_NAME, type OpenRepos, openDrizzleRepos, openInMemoryRepos } from "../repositories/contract-backends";

const taskIdOf = (eventId: CalendarEventId): TaskId => asId<"TaskId">(derivedId(eventId, "deadline-task"));

describe.each([
  ["in-memory", () => Promise.resolve(openInMemoryRepos())],
  [DRIZZLE_NAME, () => openDrizzleRepos()],
] as const)("backfillDeadlineTasks — %s", (_name, open) => {
  let opened: OpenRepos;
  let repos: Repositories;
  let org: OrganizationId;
  let owner: UserId;
  const onError = vi.fn();

  const event = async (o: Partial<CalendarEvent> = {}): Promise<CalendarEventId> => {
    const id = asId<"CalendarEventId">(uuidv7());
    await repos.calendarEvents.create({
      id, organizationId: org, userId: owner, kind: "deadline", title: "Överklagande",
      startAt: new Date("2026-11-20T09:30:00Z"), allDay: false, ...o,
    });
    return id;
  };

  const taskOf = async (eventId: CalendarEventId): Promise<Task | null> => repos.tasks.getById(taskIdOf(eventId));
  const dueOf = async (eventId: CalendarEventId): Promise<string> => new Date(String((await taskOf(eventId))?.dueAt)).toISOString();

  beforeEach(async () => {
    opened = await open();
    repos = opened.repos;
    org = asId<"OrganizationId">(uuidv7());
    owner = asId<"UserId">(uuidv7());
    onError.mockClear();
  });
  afterEach(async () => { await opened.close(); });

  it("en frist ger en uppgift med händelsens fält och ett härlett id", async () => {
    const matterId = asId<"MatterId">(uuidv7());
    const id = await event({ description: "Lämna in", matterId });
    expect(await backfillDeadlineTasks(repos, [org], onError)).toEqual({ tasks: 1, failed: 0 });
    expect(await taskOf(id)).toMatchObject({
      id: taskIdOf(id), organizationId: org, userId: owner, title: "Överklagande", description: "Lämna in",
      matterId, status: "TODO", priority: "MEDIUM",
    });
    const task = await taskOf(id);
    expect(task?.completedAt ?? null).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("utan beskrivning och ärende får uppgiften null", async () => {
    const id = await event();
    await backfillDeadlineTasks(repos, [org], onError);
    const task = await taskOf(id);
    expect(task?.description ?? null).toBeNull();
    expect(task?.matterId ?? null).toBeNull();
  });

  it("en omkörning skapar inget nytt", async () => {
    await event();
    await backfillDeadlineTasks(repos, [org], onError);
    expect(await backfillDeadlineTasks(repos, [org], onError)).toEqual({ tasks: 0, failed: 0 });
    expect(await repos.tasks.listForUser(owner, org, {})).toHaveLength(1);
  });

  it("en flyttad frist som mjukraderats skapas inte igen och ger inget fel", async () => {
    const id = await event();
    await backfillDeadlineTasks(repos, [org], onError);
    await repos.tasks.softDelete(taskIdOf(id));
    expect(await backfillDeadlineTasks(repos, [org], onError)).toEqual({ tasks: 0, failed: 0 });
    expect(await repos.tasks.listForUser(owner, org, {})).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("ett fel på en händelse loggas med dess id och resten flyttas", async () => {
    const broken = await event({ title: "Trasig" });
    const ok = await event({ title: "Hel" });
    const original = repos.tasks.create.bind(repos.tasks);
    vi.spyOn(repos.tasks, "create").mockImplementation((data: Partial<Task>) =>
      data.id === taskIdOf(broken) ? Promise.reject(new Error("skrivfel")) : original(data));
    expect(await backfillDeadlineTasks(repos, [org], onError)).toEqual({ tasks: 1, failed: 1 });
    expect(onError).toHaveBeenCalledWith(`händelse ${broken}: Error: skrivfel`);
    expect(await taskOf(ok)).not.toBeNull();
  });

  it("en byrå som inte går att läsa räknas som ett fel och stoppar inte nästa", async () => {
    const trasig = asId<"OrganizationId">(uuidv7());
    const original = repos.calendarEvents.listDeadlinesForOrg.bind(repos.calendarEvents);
    vi.spyOn(repos.calendarEvents, "listDeadlinesForOrg").mockImplementation((o: OrganizationId) =>
      o === trasig ? Promise.reject(new Error("databasen svarar inte")) : original(o));
    const id = await event();
    expect(await backfillDeadlineTasks(repos, [trasig, org], onError)).toEqual({ tasks: 1, failed: 1 });
    expect(onError).toHaveBeenCalledWith(`byrå ${trasig}: Error: databasen svarar inte`);
    expect(await taskOf(id)).not.toBeNull();
  });

  it("en heldagsfrist får den svenska dagens början, och står på dagen i Frister", async () => {
    const lateUtc = await event({ allDay: true, startAt: new Date("2026-11-19T23:00:00Z") });
    const midnightUtc = await event({ allDay: true, startAt: new Date("2026-11-20T00:00:00Z") });
    await backfillDeadlineTasks(repos, [org], onError);
    expect(await dueOf(lateUtc)).toBe("2026-11-19T23:00:00.000Z");
    expect(await dueOf(midnightUtc)).toBe("2026-11-19T23:00:00.000Z");
    const task = await taskOf(midnightUtc);
    const [item] = deadlineItems(
      [{ id: String(task?.id), title: String(task?.title), dueAt: await dueOf(midnightUtc), matterId: null, matterNumber: null }],
      new Date("2026-11-18T12:00:00Z"),
    );
    expect(item?.at).toBe("2026-11-20");
  });

  it("en frist med tid får startAt som den är", async () => {
    const id = await event({ startAt: new Date("2026-11-20T09:30:00Z") });
    await backfillDeadlineTasks(repos, [org], onError);
    expect(await dueOf(id)).toBe("2026-11-20T09:30:00.000Z");
  });

  it("möten och en byrå utan frister gör ingenting", async () => {
    await event({ kind: "appointment" });
    expect(await backfillDeadlineTasks(repos, [org], onError)).toEqual({ tasks: 0, failed: 0 });
    expect(await repos.tasks.listForUser(owner, org, {})).toEqual([]);
  });
});
