import { z } from "zod";
import { JsonProjection } from "./base";

export const timeEntrySchema = z.object({
  id: z.string().min(1),
  matterId: z.string(),
  userId: z.string(),
  date: z.coerce.date(),
  minutes: z.number(),
  description: z.string(),
  billable: z.boolean().default(true),
  hourlyRate: z.number().optional(),
  organizationId: z.string(),
});

export type TimeEntryProjectionData = z.infer<typeof timeEntrySchema>;

export class TimeEntryProjection extends JsonProjection<TimeEntryProjectionData> {
  constructor() { super(timeEntrySchema); }
  pathFor(t: TimeEntryProjectionData): string {
    return `time-entries/${t.id}.json`;
  }
}
