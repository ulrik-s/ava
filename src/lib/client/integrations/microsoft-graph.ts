"use client";

/**
 * Tunna wrappers runt Microsoft Graph `/me/events` (Outlook Calendar).
 *
 * Token hämtas separat (via O365-connectorn eller en testtoken i settings).
 * Vi använder fetch direkt eftersom `@microsoft/microsoft-graph-client` är
 * en stor dependency vi inte behöver för fyra endpoints.
 *
 * Designval — `fetchFn` injicerbar för tester. Pure-ish: nätverk är den
 * enda sideeffekten; status/headers parse:as deterministiskt.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface GraphEventBody {
  subject: string;
  body?: { contentType: "HTML" | "text"; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  location?: { displayName: string };
  sensitivity?: "normal" | "personal" | "private" | "confidential";
}

export interface GraphEventResponse {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export interface GraphOpts {
  token: string;
  /** Outlook-kalender (default = primär). */
  calendarId?: string;
  /** Injicerbar för tester. */
  fetchFn?: typeof fetch;
}

async function graphFetch(
  path: string,
  init: RequestInit,
  opts: GraphOpts,
): Promise<Response> {
  const fn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  return fn(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

async function expectOk<T>(res: Response, label: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  const body = await res.text().catch(() => "");
  let msg = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    msg = j.error?.message ?? body;
  } catch { /* använd rå body */ }
  throw new Error(`${label}: ${res.status} ${res.statusText}${msg ? ` — ${msg}` : ""}`);
}

function eventsEndpoint(calendarId?: string): string {
  return calendarId ? `/me/calendars/${calendarId}/events` : "/me/events";
}

/** POST → skapa ett event. Returnerar Graph:s id (lagras som `outlookEventId`). */
export async function createGraphEvent(body: GraphEventBody, opts: GraphOpts): Promise<GraphEventResponse> {
  const res = await graphFetch(eventsEndpoint(opts.calendarId), {
    method: "POST",
    body: JSON.stringify(body),
  }, opts);
  return expectOk<GraphEventResponse>(res, "createGraphEvent");
}

/** PATCH → uppdatera ett befintligt event. */
export async function updateGraphEvent(
  eventId: string,
  body: Partial<GraphEventBody>,
  opts: GraphOpts,
): Promise<GraphEventResponse> {
  const path = opts.calendarId
    ? `/me/calendars/${opts.calendarId}/events/${eventId}`
    : `/me/events/${eventId}`;
  const res = await graphFetch(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  }, opts);
  return expectOk<GraphEventResponse>(res, "updateGraphEvent");
}

/** DELETE → ta bort ett event. 404 räknas som ok (redan borta). */
export async function deleteGraphEvent(eventId: string, opts: GraphOpts): Promise<void> {
  const path = opts.calendarId
    ? `/me/calendars/${opts.calendarId}/events/${eventId}`
    : `/me/events/${eventId}`;
  const res = await graphFetch(path, { method: "DELETE" }, opts);
  if (res.ok || res.status === 404) return;
  const body = await res.text().catch(() => "");
  throw new Error(`deleteGraphEvent: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
}

/**
 * Konvertera en AVA CalendarEvent till Graph event-payload.
 * Tidzon — vi använder ISO-strängar + "UTC" eftersom dateLike-Z:n redan
 * är UTC. Outlook visar i användarens lokal tid via dess egna inställningar.
 */
export interface CalendarEventForMirror {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  allDay: boolean;
  visibility: "normal" | "private";
  kind: "appointment" | "deadline";
}

export function toGraphEvent(ev: CalendarEventForMirror): GraphEventBody {
  const start = new Date(ev.startAt).toISOString();
  // Deadlines: ingen end-tid; Graph kräver end, så sätt = start.
  const end = ev.kind === "deadline" || !ev.endAt
    ? start
    : new Date(ev.endAt).toISOString();
  return {
    subject: ev.title,
    ...(ev.description ? { body: { contentType: "text", content: ev.description } } : {}),
    start: { dateTime: start.replace(/\.\d{3}Z$/, ""), timeZone: "UTC" },
    end: { dateTime: end.replace(/\.\d{3}Z$/, ""), timeZone: "UTC" },
    isAllDay: ev.allDay || ev.kind === "deadline",
    ...(ev.location ? { location: { displayName: ev.location } } : {}),
    sensitivity: ev.visibility === "private" ? "private" : "normal",
  };
}
