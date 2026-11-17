import type { PickedClient } from "@/components/contacts/new-client-dialog";

/** Formulärets tillstånd i "Nytt ärende" (utbrutet ur `page.tsx`, filstorleksspärren). */
export interface MatterForm {
  title: string;
  description: string;
  matterType: string;
  klientId: string;
  responsibleLawyerId: string;
  /** Domstolens målnummer — frivilligt, trimmas vid submit (#1509). */
  courtCaseNumber: string;
}

/** `matter.create`-input som formuläret ger. */
export interface MatterCreateArgs {
  title: string;
  description?: string | undefined;
  matterType?: string | undefined;
  klientId?: string | undefined;
  responsibleLawyerId?: string | undefined;
  courtCaseNumber?: string | undefined;
}

/** Trimmat värde, eller undefined när det bara är blanksteg/tomt. */
function optionalTrimmed(v: string): string | undefined {
  return v.trim() || undefined;
}

/** Tomt formulär — startläget för "Nytt ärende". */
export const EMPTY_MATTER_FORM: MatterForm = {
  title: "",
  description: "",
  matterType: "",
  klientId: "",
  responsibleLawyerId: "",
  courtCaseNumber: "",
};

/** Formulär → `matter.create`-input: tomma fält utelämnas (utbrutet ur
 *  MattersContent, max-lines/complexity-ratchet). */
export function matterCreateArgs(form: MatterForm): MatterCreateArgs {
  return {
    title: form.title,
    description: form.description || undefined,
    matterType: form.matterType || undefined,
    klientId: form.klientId || undefined,
    responsibleLawyerId: form.responsibleLawyerId || undefined,
    courtCaseNumber: optionalTrimmed(form.courtCaseNumber),
  };
}

/**
 * Vald (eller nyskapad) klient → formuläret (#1644). Är titeln tom får den
 * klientens namn, eftersom titeln ofta är klientens namn; en ifylld titel
 * rörs inte.
 */
export function withPickedClient(form: MatterForm, client: PickedClient): MatterForm {
  const title = form.title.trim() ? form.title : client.name;
  return { ...form, klientId: client.id, title };
}
