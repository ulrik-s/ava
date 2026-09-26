/**
 * Á-priset en tidspost får när den registreras eller byter kategori (#1195,
 * #1199, #1206). Delas av `timeEntry`- och `mail`-routern så att alla vägar som
 * skapar tid prissätter på samma sätt.
 */
import { advokatberedskapFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { isHourlyKind, resolveHourlyRate, type LevelRates } from "@/lib/shared/hourly-rate";
import type { TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";

/** Vad á-priset beror på: kategori, datum (beredskapens årsbelopp), ärende och jurist. */
export interface RateSubject {
  /** Kategorin; utelämnad = timarvode. */
  kind?: TimeEntryKind | null | undefined;
  date?: Date | string | undefined;
  matterId: MatterId;
  /** Den registrerande juristens priser (postens `userId`, inte ärendets ansvarige). */
  userRates: LevelRates;
}

/**
 * Postens á-pris (öre). Beredskap bär DAGBELOPPET (per dygn, ingen timtaxa) så
 * den råa raden är läsbar — värderingen läser ändå alltid årstabellen (#950).
 * Timbaserade kategorier får kategorins pris genom ärende → jurist → byrå,
 * annars timarvodet, annars 0 (`resolveHourlyRate`). Priset sparas på posten,
 * så en senare prisändring rör inte redan registrerad tid.
 */
export async function entryRateOre(
  repos: Pick<Repositories, "matters" | "organizations">, orgId: OrganizationId, entry: RateSubject,
): Promise<number> {
  const kind = entry.kind ?? "ARBETE";
  if (!isHourlyKind(kind)) return advokatberedskapFtaxForDate(entry.date ?? new Date());
  const [matter, org] = await Promise.all([
    repos.matters.getByIdInOrg(entry.matterId, orgId),
    repos.organizations.getById(orgId),
  ]);
  return resolveHourlyRate(kind, { matter: matter?.hourlyRates, user: entry.userRates, org: org?.hourlyRates });
}
