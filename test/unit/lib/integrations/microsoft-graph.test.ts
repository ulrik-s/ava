/**
 * Tester för `microsoft-graph.ts` — tunna wrappers runt Graph `/me/events`.
 *
 * Vi injicerar `fetchFn` per anrop så att vi kan asserta requesten utan att
 * trigga nätverk.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createGraphEvent,
  updateGraphEvent,
  deleteGraphEvent,
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
