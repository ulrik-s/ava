/**
 * Ett fullt ifyllt ärende för mallkontexten (#2118, #2119): klient, motpart
 * (också som vittne), byrån med två kontor, den inloggade och en vald
 * mottagare. Delas av testerna för kontexten och för redigerarens lista.
 */

import type { MatterContactLink } from "@/lib/client/template-recipients";
import type { TemplateMatterData } from "@/lib/client/templates/build-template-context";
import { asId } from "@/lib/shared/schemas/ids";

export const NOW = new Date("2026-05-26T10:00:00Z");

const KLIENT: MatterContactLink = {
  contactId: asId<"ContactId">("c-klient"), role: "KLIENT", notes: "kopplingens anteckning",
  contact: { name: "Anna Andersson", personalNumber: "19800101-1234", address: "Storgatan 1", phone: "070-1", email: "anna@x.se" },
};
const MOTPART: MatterContactLink = {
  contactId: asId<"ContactId">("c-motpart"), role: "MOTPART", notes: null,
  contact: { name: "Bo Berg", address: "Lillgatan 2", email: "bo@x.se" },
};
/** Samma kontakt som motparten, i en andra roll. */
const MOTPART_VITTNE: MatterContactLink = { ...MOTPART, role: "VITTNE" };

export function matter(over: Partial<TemplateMatterData> = {}): TemplateMatterData {
  return {
    id: asId<"MatterId">("m1"), matterNumber: "2026-0001", title: "Vårdnadstvist", matterType: "Familjerätt",
    description: "Tvist om vårdnad", status: "ACTIVE",
    // 23:30 UTC den 14 mars = 00:30 svensk tid den 15 mars.
    createdAt: "2026-03-14T23:30:00Z",
    contacts: [KLIENT, MOTPART, MOTPART_VITTNE],
    ...over,
  };
}

export const FULL = {
  matter: matter(),
  organization: { name: "Demo Advokatbyrå", orgNumber: "556-1", address: "Byråvägen 3", email: "info@byra.se", phone: "08-123", bankgiro: "123-4567" },
  offices: [
    { name: "Malmö", address: "Malmövägen 1", phone: "040-1", isMain: false },
    { name: "Lund", address: "Lundavägen 2", phone: "046-2", isMain: true },
  ],
  user: { name: "Karin Advokat", title: "Advokat" },
  recipientId: asId<"ContactId">("c-motpart"),
  now: new Date("2025-12-31T23:30:00Z"),
};
