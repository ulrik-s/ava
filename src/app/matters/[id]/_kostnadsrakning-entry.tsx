"use client";

/**
 * Kostnadsräkningens dataflöde i ärendets faktureringspanel: dialogvalet
 * (`KostnadsrakningEntry`), datan till brottmålsmodalen och rättshjälpens
 * inskicksdialog. Utbrutet ur `_billing-panel.tsx` (#1601), som importerar
 * härifrån tillsammans med `MatterContext` och `clientOf`.
 */
import { Modal } from "@/components/ui/modal";
import { generateKrDoc } from "@/lib/client/kostnadsrakning/generate-kr-doc";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import type { KrDocumentFields } from "@/lib/shared/kostnadsrakning";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { OrgImage } from "@/lib/shared/org-image";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { BillingRunId, MatterId } from "@/lib/shared/schemas/ids";
import type { KrRunClaim } from "./_ersattning-section";
import { KostnadsrakningModal } from "./_kostnadsrakning-modal";

export interface MatterContext {
  matterNumber: string;
  title: string;
  taxaLevel?: number | null | undefined;
  taxaHasFTax?: boolean | null | undefined;
  taxaHufStart?: string | Date | null | undefined;
  isTaxeArende?: boolean | null | undefined;
  paymentMethod?: PaymentMethod | null | undefined;
  clientShareBips?: number | null | undefined;
  radgivningBetaldAt?: string | Date | null | undefined;
  /** Domstolens målnummer — kostnadsräkningens rubrik (#1218). */
  courtCaseNumber?: string | null | undefined;
  rattsskyddNekadAt?: string | Date | null | undefined;
  contacts?: ReadonlyArray<{ role: string; contact?: { name?: string | null | undefined; email?: string | null | undefined } | null | undefined }> | undefined;
}

export function clientOf(matter: MatterContext): string {
  return matter.contacts?.find((c) => c.role === "KLIENT")?.contact?.name ?? "";
}

function courtOf(matter: MatterContext): string | undefined {
  return matter.contacts?.find((c) => c.role === "DOMSTOL")?.contact?.name ?? undefined;
}

interface KrTriggerProps {
  matterId: MatterId;
  matter: MatterContext;
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
}

interface KrModalData extends Omit<KrDocumentFields, "courtCaseNumber"> {
  defenderName: string;
  defenderEmail?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  organizationAddress?: string;
  expenses: Array<{ id: string; date: string | Date; description: string; amount: number; vatRate?: number; vatIncluded?: boolean; billable?: boolean }>;
}

function strOrUndef(v: string | null | undefined): string | undefined {
  return v ?? undefined;
}

type OrgField = "name" | "orgNumber" | "address" | "phone" | "email" | "bankgiro" | "website";
type OrgData = Partial<Record<OrgField, string>> & { logo?: OrgImage; footerSeal?: OrgImage };
type OrgSettingsLike = Partial<Record<OrgField, string | null | undefined>> & { logo?: OrgImage | null | undefined; footerSeal?: OrgImage | null | undefined };
function orgProps(settings: OrgSettingsLike | undefined): OrgData {
  const org = settings ?? {};
  return omitUndefined({
    name: strOrUndef(org.name), orgNumber: strOrUndef(org.orgNumber), address: strOrUndef(org.address),
    // Sidfotens kontaktuppgifter, bankgiro, webbplats och bilder på kostnadsräkningen (#1218).
    phone: strOrUndef(org.phone), email: strOrUndef(org.email), bankgiro: strOrUndef(org.bankgiro),
    website: strOrUndef(org.website), logo: org.logo ?? undefined, footerSeal: org.footerSeal ?? undefined,
  });
}

/** Dokumentfälten (#1218) till rättshjälps-KR:ns dokument. */
function krDocumentFieldsOf(d: KrModalData, matter: MatterContext): KrDocumentFields {
  return omitUndefined({
    courtCaseNumber: strOrUndef(matter.courtCaseNumber), defenderTitle: d.defenderTitle,
    organizationPhone: d.organizationPhone, organizationEmail: d.organizationEmail, organizationBankgiro: d.organizationBankgiro,
    organizationWebsite: d.organizationWebsite, organizationLogo: d.organizationLogo, organizationFooterSeal: d.organizationFooterSeal,
  });
}

function useKrModalData(matterId: MatterId): KrModalData {
  const me = trpc.user.current.useQuery().data;
  const org = orgProps(trpc.organization.getSettings.useQuery().data ?? undefined);
  const expenses = trpc.expense.list.useQuery({ matterId }).data?.expenses ?? [];
  // omitUndefined samlar exactOptional-strippningen (#32) på ett ställe så
  // funktionen inte spräcker complexity-gränsen.
  return omitUndefined({
    defenderName: me?.name ?? "",
    defenderEmail: strOrUndef(me?.email),
    organizationName: org.name,
    organizationOrgNumber: org.orgNumber,
    organizationAddress: org.address,
    organizationPhone: org.phone,
    organizationEmail: org.email,
    organizationBankgiro: org.bankgiro,
    organizationWebsite: org.website,
    organizationLogo: org.logo,
    organizationFooterSeal: org.footerSeal,
    defenderTitle: strOrUndef(me?.title),
    expenses: expenses,
  }) as KrModalData;
}

/** Väljer rätt kostnadsräknings-dialog: rättshjälp får en enkel inskicks-
 *  bekräftelse (timkostnadsnorm), övriga (offentligt uppdrag) brottmåls-modalen. */
export function KostnadsrakningEntry({ matterId, matter, open, onClose, onRecorded }: KrTriggerProps) {
  if (matter.paymentMethod === "RATTSHJALP") {
    return open ? <RattshjalpKrDialog matterId={matterId} matter={matter} onClose={onClose} onRecorded={onRecorded} /> : null;
  }
  return <KostnadsrakningTrigger matterId={matterId} matter={matter} open={open} onClose={onClose} onRecorded={onRecorded} />;
}

function KostnadsrakningTrigger({ matterId, matter, open, onClose, onRecorded }: KrTriggerProps) {
  const data = useKrModalData(matterId);
  const createKr = trpc.billingRun.createKostnadsrakning.useMutation();
  if (!open) return null;
  // Skapa (och frys) först när PDF:en faktiskt genererats — att stänga modalen
  // (Avbryt/Escape/X) skapade förut en inskickad KR av misstag (#1121). Körningens
  // id länkar sedan dokumentet (#1230).
  const createRun = async (claim: KrRunClaim): Promise<BillingRunId> => {
    const { run } = await createKr.mutateAsync({ matterId, ...claim });
    onRecorded();
    return run.id;
  };
  return (
    <KostnadsrakningModal
      matterId={matterId}
      matterNumber={matter.matterNumber}
      matterTitle={matter.title}
      clientName={clientOf(matter)}
      courtName={courtOf(matter)}
      courtCaseNumber={strOrUndef(matter.courtCaseNumber)}
      {...data}
      initialLevel={(matter.taxaLevel ?? undefined) as 1 | 2 | 3 | 4 | undefined}
      initialHufStart={matter.taxaHufStart ?? undefined}
      initialIsTaxe={matter.isTaxeArende ?? undefined}
      radgivningPaid={!!matter.radgivningBetaldAt}
      isOffentligtUppdrag={matter.paymentMethod === "OFFENTLIGT_UPPDRAG"}
      onClose={onClose}
      createRun={createRun}
    />
  );
}

/**
 * Rättshjälpens kostnadsräkning till domstol (#806) — enkel bekräftelse (arbetet
 * värderas på timkostnadsnormen vid domen, inte brottmålstaxan). Skickar in
 * kostnadsräkningen, vilket fryser det upparbetade direkt; domen slutregleras
 * separat (klientens självrisk, statens del, ev. byrå-förlust).
 */
/** Samlar rättshjälps-KR:ns data + skapar billing-run:en OCH ett KR-dokument
 *  (#828 steg 4). Utbrutet ur dialogen så den håller sig under complexity 8. */
function useRattshjalpKr(matterId: MatterId, matter: MatterContext, onClose: () => void, onRecorded: () => void) {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const krData = useKrModalData(matterId);
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId, pageSize: 100 });
  const register = trpc.document.register.useMutation();
  const utils = trpc.useUtils();
  const create = trpc.billingRun.createKostnadsrakning.useMutation({
    onSuccess: async ({ run }) => {
      // KR-dokumentet är en presentation av det inskickade — misslyckas det
      // ska billing-run:en ändå stå kvar (best-effort), så fånga felet.
      try {
        await generateKrDoc({
          matterId, register, utils,
          meta: {
            matterNumber: matter.matterNumber, matterTitle: matter.title, defenderName: krData.defenderName,
            ...krDocumentFieldsOf(krData, matter),
            ...omitUndefined({
              clientName: clientOf(matter) || undefined, courtName: courtOf(matter),
              defenderEmail: krData.defenderEmail, organizationName: krData.organizationName,
              organizationOrgNumber: krData.organizationOrgNumber, organizationAddress: krData.organizationAddress,
              radgivningPaid: matter.radgivningBetaldAt ? true : undefined,
            }),
          },
          expenses: krData.expenses,
          // Låsta poster (redan fakturerade, t.ex. rådgivningstimmen) utelämnas av
          // byggaren; de som just DENNA kostnadsräkning frös är dess underlag (#1205).
          timeEntries: timeEntries.data?.entries ?? [],
          ownBillingRunId: run.id,
        });
      } catch (e) { console.warn("[rättshjälp-kr] dokument misslyckades:", e); }
      onRecorded(); onClose();
    },
  });
  return { proposal, create };
}

function RattshjalpKrDialog({ matterId, matter, onClose, onRecorded }: { matterId: MatterId; matter: MatterContext; onClose: () => void; onRecorded: () => void }) {
  const { proposal, create } = useRattshjalpKr(matterId, matter, onClose, onRecorded);
  const d = proposal.data;
  const arvodeOre = d ? d.timeEntries.filter((t) => t.billable).reduce((s, t) => s + t.valueOre, 0) : 0;
  const utlaggOre = d ? d.expenses.filter((e) => e.billable).reduce((s, e) => s + e.amount, 0) : 0;
  return (
    <Modal open title="Kostnadsräkning till domstol" onClose={onClose} widthClass="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Kostnadsräkningen skapas och sparas i ärendet — du skickar den till domstolen
          i nästa steg. Den är ingen faktura och kan prutas. Det upparbetade fryses nu;
          vid domen slutreglerar du (klientens självrisk, statens del och ev. byrå-förlust).
        </p>
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-1 text-sm">
          <div className="flex justify-between text-gray-700"><span>Arvode (exkl moms)</span><span className="font-mono">{formatCurrency(arvodeOre)}</span></div>
          <div className="flex justify-between text-gray-700"><span>Utlägg</span><span className="font-mono">{formatCurrency(utlaggOre)}</span></div>
        </div>
        {create.error && <p className="text-sm text-red-700">{create.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="button" disabled={create.isPending} onClick={() => create.mutate({ matterId })}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {create.isPending ? "Skapar…" : "Skapa kostnadsräkning"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
