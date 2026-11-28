"use client";

/**
 * Kostnadsräkningens dataflöde i ärendets faktureringspanel: dialogvalet
 * (`KostnadsrakningEntry`), datan till brottmålsmodalen och rättshjälpens
 * inskicksdialog. Utbrutet ur `_billing-panel.tsx` (#1601), som importerar
 * härifrån tillsammans med `MatterContext` och `clientOf`.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/modal";
import { useBillingQueryUtils } from "@/lib/client/billing/use-billing-query-utils";
import { generateKrDoc } from "@/lib/client/kostnadsrakning/generate-kr-doc";
import { useTRPC } from "@/lib/client/trpc";
import type { KrDocumentFields } from "@/lib/shared/billing/kostnadsrakning";
import { formatKr } from "@/lib/shared/kr-format";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { OrgImage } from "@/lib/shared/org-image";
import type { MatterRole, PaymentMethod } from "@/lib/shared/schemas/enums";
import type { BillingRunId, MatterId } from "@/lib/shared/schemas/ids";
import type { KrRunClaim } from "./_ersattning-section";
import { KostnadsrakningModal } from "./_kostnadsrakning-modal";
import { KrRecipientFields, useKrRecipient, type KrCourtChoice } from "./_kr-recipient-fields";
import { selectedTotals, UnbilledPosts, type SelectedPostIds } from "./_post-selection";
import { useMatterKrPosts } from "./_use-kr-posts";

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
  contacts?: ReadonlyArray<{
    role: MatterRole;
    contact?: { name?: string | null | undefined; email?: string | null | undefined; address?: string | null | undefined } | null | undefined;
  }> | undefined;
}

export function clientOf(matter: MatterContext): string {
  return matter.contacts?.find((c) => c.role === "KLIENT")?.contact?.name ?? "";
}

/** Klientens postadress (kontaktens adressfält) — fakturans fönsteradress (#2255). */
export function clientAddressOf(matter: MatterContext): string {
  return matter.contacts?.find((c) => c.role === "KLIENT")?.contact?.address ?? "";
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

/** Dokumentfälten (#1218) till rättshjälps-KR:ns dokument, med målnumret ur dialogen (#1891). */
function krDocumentFieldsOf(d: KrModalData, courtCaseNumber: string | undefined): KrDocumentFields {
  return omitUndefined({
    courtCaseNumber, defenderTitle: d.defenderTitle,
    organizationPhone: d.organizationPhone, organizationEmail: d.organizationEmail, organizationBankgiro: d.organizationBankgiro,
    organizationWebsite: d.organizationWebsite, organizationLogo: d.organizationLogo, organizationFooterSeal: d.organizationFooterSeal,
  });
}

function useKrModalData(matterId: MatterId): KrModalData {
  const trpc = useTRPC();
  const me = useQuery(trpc.user.current.queryOptions()).data;
  const org = orgProps(useQuery(trpc.organization.getSettings.queryOptions()).data ?? undefined);
  const expenses = useQuery(trpc.expense.list.queryOptions({ matterId })).data?.expenses ?? [];
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
  const createKr = useMutation(useTRPC().billingRun.createKostnadsrakning.mutationOptions());
  if (!open) return null;
  // Skapa (och frys) först när PDF:en faktiskt genererats — att stänga modalen
  // (Avbryt/Escape/X) skapade förut en inskickad KR av misstag (#1121). Körningens
  // id länkar sedan dokumentet (#1230).
  const createRun = async (claim: KrRunClaim, posts: SelectedPostIds, court: KrCourtChoice): Promise<BillingRunId> => {
    const { run } = await createKr.mutateAsync({ matterId, ...claim, ...posts, ...court });
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
 * kostnadsräkningen, vilket fryser de valda posterna direkt (#1889); domen
 * slutregleras separat (klientens självrisk, statens del, ev. byrå-förlust).
 */
/** Samlar rättshjälps-KR:ns data + skapar billing-run:en OCH ett KR-dokument
 *  (#828 steg 4). Utbrutet ur dialogen så den håller sig under complexity 8. */
function useRattshjalpKr(matterId: MatterId, matter: MatterContext, onClose: () => void, onRecorded: () => void) {
  const krData = useKrModalData(matterId);
  const trpc = useTRPC();
  const posts = useMatterKrPosts(matterId, krData.expenses);
  const recipient = useKrRecipient(courtOf(matter), strOrUndef(matter.courtCaseNumber));
  const register = useMutation(trpc.document.register.mutationOptions());
  const utils = useBillingQueryUtils();
  const create = useMutation(trpc.billingRun.createKostnadsrakning.mutationOptions());
  const submit = async (): Promise<void> => {
    // Dokumentet byggs på exakt de poster som skickas (#1255, #1889) — fångade
    // före anropet, så att ett förslag som läses om efter frysningen inte ändrar dem.
    const { entries, expenses } = posts;
    const { run } = await create.mutateAsync({ matterId, ...posts.selection.ids, ...recipient.court });
    // KR-dokumentet är en presentation av det inskickade — misslyckas det
    // ska billing-run:en ändå stå kvar (best-effort), så fånga felet.
    try {
      await generateKrDoc({
        matterId, register, utils,
        meta: {
          matterNumber: matter.matterNumber, matterTitle: matter.title, defenderName: krData.defenderName,
          ...krDocumentFieldsOf(krData, recipient.courtCaseNumber),
          ...omitUndefined({
            clientName: clientOf(matter) || undefined, courtName: recipient.courtName,
            defenderEmail: krData.defenderEmail, organizationName: krData.organizationName,
            organizationOrgNumber: krData.organizationOrgNumber, organizationAddress: krData.organizationAddress,
            radgivningPaid: matter.radgivningBetaldAt ? true : undefined,
          }),
        },
        expenses,
        // Låsta poster (redan fakturerade, t.ex. rådgivningstimmen) utelämnas av
        // byggaren; de som just DENNA kostnadsräkning frös är dess underlag (#1205).
        timeEntries: entries,
        ownBillingRunId: run.id,
      });
    } catch (e) { console.warn("[rättshjälp-kr] dokument misslyckades:", e); }
    onRecorded(); onClose();
  };
  return { posts, create, submit, recipient };
}

function RattshjalpKrDialog({ matterId, matter, onClose, onRecorded }: { matterId: MatterId; matter: MatterContext; onClose: () => void; onRecorded: () => void }) {
  const { posts, create, submit, recipient } = useRattshjalpKr(matterId, matter, onClose, onRecorded);
  const { timeOre, expenseOre } = selectedTotals(posts.selection);
  return (
    <Modal open title="Kostnadsräkning till domstol" onClose={onClose} widthClass="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Kostnadsräkningen skapas och sparas i ärendet — du skickar den till domstolen
          i nästa steg. Den är ingen faktura och kan prutas. De valda posterna fryses nu;
          vid domen slutreglerar du (klientens självrisk, statens del och ev. byrå-förlust).
        </p>
        <KrRecipientFields recipient={recipient} />
        <UnbilledPosts selection={posts.selection} loading={posts.loading} />
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-1 text-sm">
          <div className="flex justify-between text-gray-700"><span>Arvode (exkl moms)</span><span className="font-mono">{formatKr(timeOre)}</span></div>
          <div className="flex justify-between text-gray-700"><span>Utlägg</span><span className="font-mono">{formatKr(expenseOre)}</span></div>
        </div>
        {create.error && <p className="text-sm text-red-700">{create.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="button" disabled={create.isPending || posts.loading} onClick={() => void submit().catch(() => { /* felet visas via create.error */ })}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {create.isPending ? "Skapar…" : "Skapa kostnadsräkning"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
