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

import type { MatterRole } from "@/lib/shared/schemas/enums";
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
  role: MatterRole;
  roleLabel: string;
  notes: string | null;
}

export interface ResolvedRecipient {
  contactId: ContactId;
  data: RecipientContactData;
}

/**
 * En koppling mellan ärendet och en kontakt, som `matter.getById` ger den
 * (kontaktens fält kan saknas).
 */
export interface MatterContactLink {
  contactId: ContactId;
  role: MatterRole;
  notes?: string | null | undefined;
  contact: {
    name: string;
    email?: string | null | undefined;
    phone?: string | null | undefined;
    address?: string | null | undefined;
    personalNumber?: string | null | undefined;
    orgNumber?: string | null | undefined;
  };
}

export class RecipientNotLinkedError extends Error {
  constructor(public readonly recipientId: ContactId, public readonly matterId: MatterId) {
    super(`Recipient ${recipientId} is not linked to matter ${matterId}`);
    this.name = "RecipientNotLinkedError";
  }
}

const orNull = (v: string | null | undefined): string | null => v ?? null;

/**
 * En kopplings kontaktdata med kopplingens roll (#2118): varje koppling ger sin
 * egen roll, så en kontakt med två roller blir två rader i mallens parter.
 */
export function linkToRecipientData(link: MatterContactLink): RecipientContactData {
  const c = link.contact;
  return {
    name: c.name,
    role: link.role,
    roleLabel: labelForMatterRole(link.role),
    email: orNull(c.email),
    phone: orNull(c.phone),
    address: orNull(c.address),
    personalNumber: orNull(c.personalNumber),
    orgNumber: orNull(c.orgNumber),
    notes: orNull(link.notes),
  };
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
  recipientIds: readonly ContactId[],
  links: readonly MatterContactLink[],
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
    result.push({ contactId: cid, data: linkToRecipientData(link) });
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
