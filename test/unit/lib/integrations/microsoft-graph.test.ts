/**
 * Tester för `microsoft-graph.ts` — tunna wrappers runt Graph `/me/events`.
 *
 * Vi injicerar `fetchFn` per anrop så att vi kan asserta requesten utan att
 * trigga nätverk.
 */

import { describe, it, expect, vi } from "vitest-compat";
import {
  createGraphEvent,
  updateGraphEvent,
  deleteGraphEvent,
  findGraphEventByProperty,
  toGraphEvent,
} from "@/lib/client/integrations/microsoft-graph";
import type { GraphEventBody, GraphEventResponse } from "@/lib/client/integrations/microsoft-graph";

function mockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("toGraphEvent", () => {
  it("appointment → har separat end och isAllDay=false", () => {
    const body = toGraphEvent({
      title: "Möte",
      startAt: "2026-01-15T09:00:00.000Z",
      endAt: "2026-01-15T10:00:00.000Z",
      allDay: false,
      visibility: "normal",
      kind: "appointment",
    });
    expect(body.subject).toBe("Möte");
    expect(body.start.dateTime).toBe("2026-01-15T09:00:00");
    expect(body.end.dateTime).toBe("2026-01-15T10:00:00");
    expect(body.isAllDay).toBe(false);
    expect(body.sensitivity).toBe("normal");
  });

  it("deadline → end = start, isAllDay=true", () => {
    const body = toGraphEvent({
      title: "Inlaga",
      startAt: "2026-02-01T00:00:00.000Z",
      endAt: null,
      allDay: false,
      visibility: "normal",
      kind: "deadline",
    });
    expect(body.start.dateTime).toBe(body.end.dateTime);
    expect(body.isAllDay).toBe(true);
  });

  it("private visibility → sensitivity:private", () => {
    const body = toGraphEvent({
      title: "Hemligt",
      startAt: new Date("2026-03-01T12:00:00Z"),
      allDay: false,
      visibility: "private",
      kind: "appointment",
    });
    expect(body.sensitivity).toBe("private");
  });

  it("inkluderar location + description när angivna", () => {
    const body = toGraphEvent({
      title: "Förhandling",
      description: "Mål T 123-24",
      location: "Stockholms tingsrätt",
      startAt: "2026-04-10T08:30:00.000Z",
      endAt: "2026-04-10T12:00:00.000Z",
      allDay: false,
      visibility: "normal",
      kind: "appointment",
    });
    expect(body.location).toEqual({ displayName: "Stockholms tingsrätt" });
    expect(body.body).toEqual({ contentType: "text", content: "Mål T 123-24" });
  });
});

describe("createGraphEvent", () => {
  it("POST:ar mot /me/events med Bearer-token", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://graph.microsoft.com/v1.0/me/events");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok");
      return mockResponse(201, { id: "g-1", subject: "x", start: { dateTime: "x", timeZone: "UTC" }, end: { dateTime: "x", timeZone: "UTC" } });
    }) as unknown as typeof fetch;

    const res = await createGraphEvent(
      { subject: "x", start: { dateTime: "x", timeZone: "UTC" }, end: { dateTime: "x", timeZone: "UTC" } } as GraphEventBody,
      { token: "tok", fetchFn },
    );
    expect(res.id).toBe("g-1");
  });

  it("kastar med Graph-felmeddelandet om non-ok", async () => {
    const fetchFn = vi.fn(async () =>
      mockResponse(401, { error: { message: "Token expired" } }),
    ) as unknown as typeof fetch;

    await expect(
      createGraphEvent(
        { subject: "x", start: { dateTime: "x", timeZone: "UTC" }, end: { dateTime: "x", timeZone: "UTC" } } as GraphEventBody,
        { token: "bad", fetchFn },
      ),
    ).rejects.toThrow(/Token expired/);
  });
});

describe("updateGraphEvent", () => {
  it("PATCH:ar event-id-pathen och returnerar nya raden", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://graph.microsoft.com/v1.0/me/events/g-1");
      expect(init.method).toBe("PATCH");
      return mockResponse(200, { id: "g-1", subject: "Uppdaterad", start: { dateTime: "x", timeZone: "UTC" }, end: { dateTime: "x", timeZone: "UTC" } });
    }) as unknown as typeof fetch;

    const res: GraphEventResponse = await updateGraphEvent("g-1", { subject: "Uppdaterad" }, { token: "tok", fetchFn });
    expect(res.subject).toBe("Uppdaterad");
  });

  it("respekterar calendarId i pathen", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("https://graph.microsoft.com/v1.0/me/calendars/cal-1/events/g-1");
      return mockResponse(200, { id: "g-1", subject: "x", start: { dateTime: "x", timeZone: "UTC" }, end: { dateTime: "x", timeZone: "UTC" } });
    }) as unknown as typeof fetch;

    await updateGraphEvent("g-1", {}, { token: "tok", calendarId: "cal-1", fetchFn });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

describe("deleteGraphEvent", () => {
  it("DELETE → 204 ok", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe("DELETE");
      expect(url).toBe("https://graph.microsoft.com/v1.0/me/events/g-1");
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await expect(deleteGraphEvent("g-1", { token: "tok", fetchFn })).resolves.toBeUndefined();
  });

  it("404 räknas som ok (redan borta)", async () => {
    const fetchFn = vi.fn(async () => mockResponse(404, "")) as unknown as typeof fetch;
    await expect(deleteGraphEvent("missing", { token: "tok", fetchFn })).resolves.toBeUndefined();
  });

  it("500 → kastar med statusen", async () => {
    const fetchFn = vi.fn(async () => new Response("boom", { status: 500, statusText: "Server Error" })) as unknown as typeof fetch;
    await expect(deleteGraphEvent("g-1", { token: "tok", fetchFn })).rejects.toThrow(/500/);
  });
});

// #1286: ett Graph-anrop som hänger ska gå att avbryta — annars blockerar det
// mirror-to-outlook-jobbet. Signalen skickas vidare till fetch.
describe("avbrottssignal till fetch (#1286)", () => {
  const ok = { id: "g-1", subject: "x", start: { dateTime: "x", timeZone: "UTC" }, end: { dateTime: "x", timeZone: "UTC" } };
  const body: GraphEventBody = { subject: "x", start: { dateTime: "x", timeZone: "UTC" }, end: { dateTime: "x", timeZone: "UTC" } };

  /** fetch som sparar init och svarar med `status`. */
  function recordingFetch(status: number): { fetchFn: (url: string, init: RequestInit) => Promise<Response>; inits: RequestInit[] } {
    const inits: RequestInit[] = [];
    return { inits, fetchFn: async (_url, init) => { inits.push(init); return mockResponse(status, status === 204 ? "" : ok); } };
  }

  it("create, update och delete skickar signalen vidare", async () => {
    const signal = new AbortController().signal;
    const r = recordingFetch(200);
    await createGraphEvent(body, { token: "tok", fetchFn: r.fetchFn, signal });
    await updateGraphEvent("g-1", {}, { token: "tok", fetchFn: r.fetchFn, signal });
    await deleteGraphEvent("g-1", { token: "tok", fetchFn: r.fetchFn, signal });
    expect(r.inits.map((i) => i.signal)).toEqual([signal, signal, signal]);
  });

  it("utan signal → ingen signal i anropet", async () => {
    const r = recordingFetch(200);
    await createGraphEvent(body, { token: "tok", fetchFn: r.fetchFn });
    expect(r.inits[0]?.signal).toBeUndefined();
  });

  it("ett avbrutet anrop avvisas, i stället för att hänga", async () => {
    const ac = new AbortController();
    const fetchFn = (_url: string, init: RequestInit): Promise<Response> => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => { reject(new DOMException("Avbrutet", "AbortError")); });
    });
    const pending = createGraphEvent(body, { token: "tok", fetchFn, signal: ac.signal });
    ac.abort();
    await expect(pending).rejects.toThrow(/Avbrutet/);
  });
});

// #1361: speglingen söks fram på AVA-id:t (utökad egenskap) innan ett nytt event skapas.
describe("findGraphEventByProperty (#1361)", () => {
  const PROP = "String {c7314276-9bc2-40d6-9a33-d056ef4e7efe} Name AvaCalendarEventId";

  it("GET med $filter på egenskapen, bara id, högst ett — svarar med id:t", async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
      urls.push(url);
      expect(init.method).toBe("GET");
      return mockResponse(200, { value: [{ id: "g-7" }] });
    };
    expect(await findGraphEventByProperty(PROP, "ev-1", { token: "tok", fetchFn })).toBe("g-7");
    const [path, query] = (urls[0] ?? "").split("?");
    expect(path).toBe("https://graph.microsoft.com/v1.0/me/events");
    const params = new URLSearchParams(query);
    expect(params.get("$filter")).toBe(`singleValueExtendedProperties/Any(ep: ep/id eq '${PROP}' and ep/value eq 'ev-1')`);
    expect(params.get("$select")).toBe("id");
    expect(params.get("$top")).toBe("1");
  });

  it("inget träff → null; i en angiven kalender; apostrof escapas", async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string): Promise<Response> => { urls.push(url); return mockResponse(200, { value: [] }); };
    expect(await findGraphEventByProperty(PROP, "o'brien", { token: "tok", calendarId: "cal-1", fetchFn })).toBeNull();
    expect(urls[0]).toMatch(/^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/calendars\/cal-1\/events\?/);
    expect(new URLSearchParams(urls[0]?.split("?")[1]).get("$filter")).toContain("ep/value eq 'o''brien'");
  });

  it("Graph-fel → kastar, så att jobbet inte skapar ett event i blindo", async () => {
    const fetchFn = async (): Promise<Response> => mockResponse(403, { error: { message: "Access denied" } });
    await expect(findGraphEventByProperty(PROP, "ev-1", { token: "tok", fetchFn })).rejects.toThrow(/findGraphEventByProperty: 403.*Access denied/);
  });
});
