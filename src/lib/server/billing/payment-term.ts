/**
 * Förfallodagen för en ny faktura (#2265): den angivna, annars fakturadagen
 * plus byråns betalningsvillkor (standard tio dagar). Läser byrån en gång.
 */

import { dueDateOr, paymentTermDaysOf } from "@/lib/shared/billing/payment-terms";
import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";

/** Förfallodagen för en faktura i byrån `orgId` daterad `invoiceDate`. */
export async function invoiceDueDate(
  repos: Pick<Repositories, "organizations">, orgId: OrganizationId,
  given: string | undefined | null, invoiceDate: Date,
): Promise<Date> {
  const org = await repos.organizations.getById(orgId);
  return dueDateOr(given, invoiceDate, paymentTermDaysOf(org));
}
