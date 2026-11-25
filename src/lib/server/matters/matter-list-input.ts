/**
 * Indata till `matter.list` (#1967), utbruten ur routern så att `matter.ts`
 * håller sin filstorlek. `mine` och `orderBy` blir filter i `MatterListFilter`.
 */

import { z } from "zod";
import { matterStatusSchema } from "@/lib/shared/schemas/enums";
import { matterIdSchema, userIdSchema, type UserId } from "@/lib/shared/schemas/ids";
import { MATTER_LIST_ORDERS, type MatterListFilter } from "../repositories/matter-repository";

/** Indataschemat för `matter.list`. */
export const matterListInput = z.object({
  search: z.string().optional(),
  status: matterStatusSchema.optional(),
  /** Filtrera till ärenden som medarbetaren har arbetat på (har tidsposter på). */
  employeeId: userIdSchema.optional(),
  /** Bara dessa ärenden (#1642): jävsträffarnas rader i den sammanslagna sökningen. */
  ids: z.array(matterIdSchema).max(500).optional(),
  /** Bara ärenden där den inloggade är ansvarig (#1967). Servern väljer personen. */
  mine: z.boolean().optional(),
  /** Ordningen (#1967): skapad (standard) eller senast hänt i ärendet. */
  orderBy: z.enum(MATTER_LIST_ORDERS).default("createdAt"),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(500).default(20),
});

/** `matter.list`-indata efter validering. */
export type MatterListInput = z.output<typeof matterListInput>;

/** Repots filter: `mine` blir den inloggades id som ansvarig, aldrig någon annans. */
export function toMatterListFilter(input: MatterListInput, userId: UserId): MatterListFilter {
  const { mine, ...rest } = input;
  return { ...rest, responsibleLawyerId: mine === true ? userId : undefined };
}
