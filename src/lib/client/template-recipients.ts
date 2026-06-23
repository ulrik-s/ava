/**
 * Recipient-resolvering för mallgenerering.
 *
 * När ett dokument genereras kan användaren välja en eller flera mottagare
 * (MatterContact-länkar till kontakter i ärendet). För varje mottagare
 * produceras ett eget dokument med `{{recipient}}` i template-kontexten
 * satt till den kontaktens data.
 *
 * Denna modul innehåller den *rena* logiken för att plocka ut och validera
 * mottagarlistan — API-routen sköter endast IO (Prisma-hämtning, rendrering,
 * filskrivning).
 */

import type { ContactId, MatterId } from "@/lib/shared/schemas/ids";
import { labelForMatterRole } from "./labels";

// template-context modulen är borttagen (Prisma-dependent). En kontakts
// data i template-rendering är en sub-set av Contact-schemat.
export interface RecipientContactData {
  id?: ContactId;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  personalNumber: string | null;
  orgNumber: string | null;
  role: string;
  roleLabel: string;
  notes: string | null;
}

export interface ResolvedRecipient {
  contactId: ContactId;
  data: RecipientContactData;
}

export interface MatterContactLink {
  contactId: ContactId;
  role: string;
  notes: string | null;
  contact: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    personalNumber: string | null;
    orgNumber: string | null;
  };
}

export class RecipientNotLinkedError extends Error {
  constructor(public readonly recipientId: ContactId, public readonly matterId: MatterId) {
    super(`Recipient ${recipientId} is not linked to matter ${matterId}`);
    this.name = "RecipientNotLinkedError";
  }
}

/**
 * Omvandlar en lista av contact-ID:n + ärendets MatterContact-länkar till
 * en ordnad mottagarlista med fullt ifyllda template-kontaktfält.
 *
 * - Ordningen från `recipientIds` bevaras (UI:t bestämmer).
 * - Om något ID inte finns som länk i ärendet kastas RecipientNotLinkedError.
 * - Dubbletter i `recipientIds` bevaras som separata poster (kallaren väljer).
 */
export function resolveRecipients(
  recipientIds: ContactId[],
  links: MatterContactLink[],
  matterId: MatterId,
): ResolvedRecipient[] {
  // Om samma kontakt råkar ha flera MatterContact-länkar (t.ex. två roller)
  // tar vi första träffen — template-context har bara ett recipient-fält per
  // dokument, och första länken är typiskt den primära rollen.
  const byId = new Map<ContactId, MatterContactLink>();
  for (const l of links) {
    if (!byId.has(l.contactId)) byId.set(l.contactId, l);
  }

  const result: ResolvedRecipient[] = [];
  for (const cid of recipientIds) {
    const link = byId.get(cid);
    if (!link) throw new RecipientNotLinkedError(cid, matterId);
    result.push({
      contactId: cid,
      data: {
        name: link.contact.name,
        role: link.role,
        roleLabel: labelForMatterRole(link.role),
        email: link.contact.email,
        phone: link.contact.phone,
        address: link.contact.address,
        personalNumber: link.contact.personalNumber,
        orgNumber: link.contact.orgNumber,
        notes: link.notes,
      },
    });
  }
  return result;
}

/**
 * Bygger filnamn för ett genererat dokument. Om en mottagare angetts
 * inkluderas mottagarens namn i filnamnet.
 */
export function buildGeneratedFileName(
  matterNumber: string,
  templateName: string,
  extension: "pdf" | "docx",
  recipient: RecipientContactData | null,
): string {
  const recipientSuffix = recipient ? ` - ${recipient.name}` : "";
  const safeName = `${matterNumber} ${templateName}${recipientSuffix}`
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();
  return `${safeName}.${extension}`;
}
