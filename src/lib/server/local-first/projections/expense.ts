import { z } from "zod";
import { JsonProjection } from "./base";

export const expenseSchema = z.object({
  id: z.string().min(1),
  matterId: z.string(),
  userId: z.string(),
  date: z.coerce.date(),
  amount: z.number(),
  description: z.string(),
  billable: z.boolean().default(true),
  organizationId: z.string(),
});

export type ExpenseProjectionData = z.infer<typeof expenseSchema>;

export class ExpenseProjection extends JsonProjection<ExpenseProjectionData> {
  constructor() { super(expenseSchema); }
  pathFor(e: ExpenseProjectionData): string {
    return `expenses/${e.id}.json`;
  }
}
