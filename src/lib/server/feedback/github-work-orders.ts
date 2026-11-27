/**
 * {@link IWorkOrderSource} mot GitHubs sök-API (#2216): arbetsordrarna i det
 * publika kodrepot (issues med raden `Intag: ava-feedback#N`) och takten
 * (mergade agent-PR:er de senaste 7 dygnen).
 *
 * Samma token som intag-repot — kodrepot är publikt, så läsningen kräver ingen
 * extra behörighet men får tokenens högre gräns för anrop. Svaret delas av
 * alla användare och hålls i minnet i 5 minuter; ett fel ger det senaste
 * svaret (eller null) och försöker igen efter samma tid.
 *
 * Ett anrop per 100 arbetsordrar (sök-API:t, inte issues-listan: den ger alla
 * issues och PR:er, ~12 sidor för 90 dygn, mot ~3 här) plus ett för takten.
 */

import { z } from "zod";
import type { FeedbackPartState } from "@/lib/shared/feedback";
import { log } from "@/lib/shared/observability/logger";
import { addDays, stockholmDay } from "@/lib/shared/stockholm-time";
import type { IWorkOrderSource, WorkOrder, WorkOrderSnapshot } from "../ports";
import type { FetchLike } from "./github-feedback-sink";

/** Kodrepot där arbetsordrarna ligger. */
export const CODE_REPO = "ulrik-s/ava";
/** Så länge ett svar återanvänds, för alla användare. */
export const WORK_ORDERS_TTL_MS = 5 * 60_000;
/** Takten när den inte går att läsa: delar per dygn. */
export const FALLBACK_PER_DAY = 10;
/** Så långt bakåt (senast ändrad) arbetsordrarna läses. */
const LOOKBACK_DAYS = 90;
/** Takten räknas över så många dygn. */
const PACE_DAYS = 7;
/** Sök-API:t ger högst 1000 träffar. */
const MAX_PAGES = 10;
const PER_PAGE = 100;

const INTAKE_LINE = /^Intag: ava-feedback#(\d+)\s*$/m;

const searchItemSchema = z.object({
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  state_reason: z.string().nullish(),
  created_at: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  pull_request: z.unknown().optional(),
});
type SearchItem = z.infer<typeof searchItemSchema>;
const searchPageSchema = z.object({ total_count: z.number(), items: z.array(searchItemSchema) });

/** Förfrågans nummer ur raden `Intag: ava-feedback#N`, eller null. */
export function intakeNumber(body: string): number | null {
  const m = INTAKE_LINE.exec(body);
  return m?.[1] ? Number(m[1]) : null;
}

/** Delens läge; null för en arbetsorder som stängts utan att göras (den är ingen del). */
export function partState(open: boolean, stateReason: string | null | undefined, labels: readonly string[]): FeedbackPartState | null {
  if (!open) return stateReason === "completed" ? "klar" : null;
  if (labels.includes("blockerad")) return "vantar_beslut";
  return labels.includes("pågår") ? "pagar" : "i_ko";
}

/** En sökträff → arbetsorder, eller null (PR, ingen Intag-rad, eller stängd utan att göras). */
export function workOrderFrom(item: SearchItem): WorkOrder | null {
  const intake = item.pull_request === undefined ? intakeNumber(item.body ?? "") : null;
  const state = partState(item.state === "open", item.state_reason, item.labels.map((l) => l.name));
  if (intake === null || state === null) return null;
  return { intake, title: item.title, state, createdAt: item.created_at };
}

export class GithubWorkOrders implements IWorkOrderSource {
  private cached: { at: number; snapshot: WorkOrderSnapshot | null } | null = null;
  private inflight: Promise<WorkOrderSnapshot | null> | null = null;

  constructor(private readonly token: string, private readonly fetchImpl: FetchLike = fetch, private readonly now: () => number = Date.now) {}

  snapshot(): Promise<WorkOrderSnapshot | null> {
    if (this.cached && this.now() - this.cached.at < WORK_ORDERS_TTL_MS) return Promise.resolve(this.cached.snapshot);
    // Samtidiga anrop väntar på samma hämtning.
    this.inflight ??= this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async refresh(): Promise<WorkOrderSnapshot | null> {
    let snapshot: WorkOrderSnapshot | null;
    try {
      const [orders, perDay] = await Promise.all([this.orders(), this.perDay()]);
      snapshot = { orders, perDay };
    } catch (e) {
      log.warn("feedback.work_orders_failed", { message: e instanceof Error ? e.message : String(e) });
      snapshot = this.cached?.snapshot ?? null;
    }
    this.cached = { at: this.now(), snapshot };
    return snapshot;
  }

  private daysAgo(days: number): string {
    return addDays(stockholmDay(new Date(this.now())), -days);
  }

  private async search(query: string, page: number, perPage: number): Promise<z.infer<typeof searchPageSchema>> {
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=created&order=asc&per_page=${perPage}&page=${page}`;
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ava-feedback",
      },
    });
    if (!res.ok) throw new Error(`GitHub svarade ${res.status} på sökningen`);
    return searchPageSchema.parse(await res.json());
  }

  /** Arbetsordrarna som ändrats de senaste 90 dygnen, sida för sida. */
  private async orders(): Promise<WorkOrder[]> {
    const query = `repo:${CODE_REPO} is:issue in:body "Intag: ava-feedback" updated:>=${this.daysAgo(LOOKBACK_DAYS)}`;
    const items: SearchItem[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.search(query, page, PER_PAGE);
      items.push(...res.items);
      if (res.items.length < PER_PAGE || items.length >= res.total_count) break;
    }
    return items.flatMap((i) => workOrderFrom(i) ?? []);
  }

  /** Mergade agent-PR:er per dygn de senaste 7 dygnen; reservvärdet om sökningen fallerar. */
  private async perDay(): Promise<number> {
    try {
      const res = await this.search(`repo:${CODE_REPO} is:pr is:merged label:agent-pr merged:>=${this.daysAgo(PACE_DAYS)}`, 1, 1);
      return res.total_count / PACE_DAYS;
    } catch {
      return FALLBACK_PER_DAY;
    }
  }
}
