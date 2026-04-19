import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";

/**
 * Returns an .ics calendar file for a single MatterEventSuggestion.
 * Opening this file adds the event to the user's default calendar app
 * (Kalender on macOS, Outlook, Google Calendar import, etc.).
 *
 * Also marks the event as ACCEPTED so the UI can show a "added" indicator.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ev = await prisma.matterEventSuggestion.findUnique({
    where: { id },
    include: {
      document: {
        select: {
          fileName: true,
          matter: { select: { matterNumber: true, title: true, organizationId: true } },
        },
      },
    },
  });
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ics = buildIcs(ev);

  // Mark as accepted (best-effort)
  prisma.matterEventSuggestion
    .update({ where: { id }, data: { status: "ACCEPTED" } })
    .catch(() => {});

  const fileName = safeFilename(`${ev.document.matter.matterNumber} - ${ev.title}.ics`);
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

// ─── ICS builder ─────────────────────────────────────────────────

interface IcsEvent {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  location: string | null;
  document: {
    fileName: string;
    matter: { matterNumber: string; title: string };
  };
  eventType: string | null;
}

export function buildIcs(ev: IcsEvent): string {
  const uid = `${ev.id}@ava.local`;
  const now = fmtUtc(new Date());

  const summary = ev.eventType
    ? `${ev.eventType}: ${ev.title}`
    : ev.title;

  const descriptionParts = [
    ev.description,
    `Ärende: ${ev.document.matter.matterNumber} — ${ev.document.matter.title}`,
    `Från dokument: ${ev.document.fileName}`,
  ].filter(Boolean) as string[];

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AVA//Document Analysis//SV",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(descriptionParts.join("\\n"))}`,
  ];

  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);

  if (ev.allDay) {
    // All-day: DATE value type (no time). End = start+1 day (exclusive).
    const start = fmtDate(ev.startAt);
    const end = fmtDate(ev.endAt ?? addDays(ev.startAt, 1));
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
  } else {
    lines.push(`DTSTART:${fmtUtc(ev.startAt)}`);
    const end = ev.endAt ?? new Date(ev.startAt.getTime() + 60 * 60 * 1000); // default 1h
    lines.push(`DTEND:${fmtUtc(end)}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function fmtUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
export function fmtDate(d: Date): string {
  // YYYYMMDD in UTC
  const iso = d.toISOString().slice(0, 10);
  return iso.replace(/-/g, "");
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
export function safeFilename(s: string): string {
  return s.replace(/[\/\\:*?"<>|]/g, "-").slice(0, 120);
}
