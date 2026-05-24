import { z } from "zod";
import { baseFields, dateLike, optionalDateLike } from "./common";

/**
 * `CalendarEvent` — användarens kalender (möten, förhandlingar, frister).
 *
 * Lagras flat under `calendar/<eventId>.json`. `userId` på raden anger
 * ägare; filtrering per användare sker i routern.
 *
 * Två "kinds" v1:
 *   - `appointment` — har start + end. Mätbar tidsperiod.
 *   - `deadline`    — punkt i tiden. allDay=true, endAt ignoreras.
 *
 * Outlook-spegling (Microsoft Graph /me/events):
 *   - `mirrorToOutlook=true` + användaren ansluten via O365-connectorn
 *     → `mirror-to-outlook`-jobbet skickar PUT/PATCH till Graph.
 *   - `outlookEventId` är ID:t som Graph returnerar; sätts efter första
 *     lyckad mirror, används för PATCH/DELETE.
 *   - Sync är ENVÄGS: AVA → Outlook. Outlook är skugga. Ändringar i Outlook
 *     skrivs INTE tillbaka (tvåvägs kräver konflikthantering — defer).
 *
 * `visibility` styr två saker:
 *   - I AVA: bara ägaren ser `private`-events.
 *   - I Outlook: `private` → `sensitivity: private` på Graph-eventet.
 */
export const calendarEventKindSchema = z.enum(["appointment", "deadline"]);
export type CalendarEventKind = z.infer<typeof calendarEventKindSchema>;

export const calendarEventVisibilitySchema = z.enum(["normal", "private"]);
export type CalendarEventVisibility = z.infer<typeof calendarEventVisibilitySchema>;

export const calendarEventSchema = z.object({
  ...baseFields,
  /** Ägare. Events skrivs under `calendar/<userId>/`. */
  userId: z.string(),
  organizationId: z.string(),
  kind: calendarEventKindSchema.default("appointment"),
  title: z.string().min(1),
  description: z.string().nullish(),
  location: z.string().nullish(),

  /** ISO-datum eller Date. Krävs för båda kinds. */
  startAt: dateLike,
  /** För deadlines: oanvänd (ignoreras av rendering). */
  endAt: optionalDateLike,
  allDay: z.boolean().default(false),

  /** Optional länk till matter; sätts t.ex. för förhandlingar. */
  matterId: z.string().nullish(),

  visibility: calendarEventVisibilitySchema.default("normal"),

  // ─── Outlook-spegling ──────────────────────────────────────────────
  /** Användaren har valt att spegla detta event till Outlook. */
  mirrorToOutlook: z.boolean().default(false),
  /** Set av mirror-jobbet efter första lyckad sync. Identifierar event i Graph. */
  outlookEventId: z.string().nullish(),
  /** Vilken Outlook-kalender (default = primär). */
  outlookCalendarId: z.string().nullish(),
  /** Senaste mirror-status (för UI-banner). */
  mirrorStatus: z.enum(["pending", "synced", "failed"]).nullish(),
  mirrorError: z.string().nullish(),
  mirrorLastSyncedAt: optionalDateLike,
}).passthrough();

export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/**
 * `Task` — ToDo med valfri due-date. Användarens egen task-lista. Separat
 * entitet eftersom semantiken är annorlunda (completion state, no time-range,
 * priority).
 *
 * Microsoft To Do är en separat Graph-API från Calendar — task-spegling
 * deferas tills v2. Lagras flat under `tasks/<id>.json`.
 */
export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskSchema = z.object({
  ...baseFields,
  /** Ägare/assignee. Tasks skrivs under `tasks/<userId>/`. */
  userId: z.string(),
  organizationId: z.string(),
  title: z.string().min(1),
  description: z.string().nullish(),
  status: taskStatusSchema.default("TODO"),
  priority: taskPrioritySchema.default("MEDIUM"),
  dueAt: optionalDateLike,
  completedAt: optionalDateLike,
  /** Optional matter-koppling. */
  matterId: z.string().nullish(),
}).passthrough();

export type Task = z.infer<typeof taskSchema>;
