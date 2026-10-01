/**
 * Den pushande principalen i synk-tester (#1344): server-verifierad byrå och
 * användare. Utan användare får testet ett eget, slumpat id.
 */
import type { RowPusher } from "@/lib/server/sync/row-push-policy";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";

export function pusher(organizationId: string, userId: string = uuidv7()): RowPusher {
  return { organizationId: asId<"OrganizationId">(organizationId), userId: asId<"UserId">(userId) };
}
