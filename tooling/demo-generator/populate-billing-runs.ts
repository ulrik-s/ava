/**
 * `populateBillingRuns` — demo-scenarier för nya BillingRun-modellen.
 * Körs EFTER `populateBilling` och kompletterar gamla legacy-flow:n med
 * realistiska aconto/slutfaktura/kostnadsräkning-scenarier mot ärenden
 * vars paymentMethod kräver nya modellen.
 *
 * Förenklad scenario-mappning per paymentMethod:
 *   RATTSSKYDD/RATTSHJALP → 1-2 ACCONTOs + ev. FINAL till försäkring/myndighet
 *   OFFENTLIG_FORSVARARE (icke-taxa) → KOSTNADSRAKNING, hälften PENDING_VERDICT,
 *                                       hälften SENT med liten prutning
 */
import type { SeedDataset } from "../scripts/seed-data";
import type { GeneratorCaller } from "./backend-target";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCaller = any;
type Row = Record<string, unknown>;

export interface BillingRunsResult {
  acconto: number;
  final: number;
  kostnadsrakningPending: number;
  kostnadsrakningSent: number;
}

function eligible(seed: SeedDataset, paymentMethods: string[]): Row[] {
  return ((seed.matters ?? []) as Row[]).filter((m) =>
    m.status === "ACTIVE" && typeof m.paymentMethod === "string" && paymentMethods.includes(m.paymentMethod),
  );
}

async function runRattsskyddFlow(c: AnyCaller, matter: Row): Promise<{ acconto: number; final: number }> {
  let acconto = 0, final = 0;
  // Aconto 1: 20% självrisk-procent, 2000 kr-runda
  const acc1 = await c.billingRun.createAcconto({
    matterId: matter.id, clientShareBips: 2000, amountOre: 200_000,
    notes: "Aconto 1 — självrisk-andel enligt rättsskyddsbesked",
  });
  acconto++;
  // Halva ärendena får en till aconto
  let acc2: { run: { id: string } } | null = null;
  if (String(matter.id).charCodeAt(0) % 2 === 0) {
    acc2 = await c.billingRun.createAcconto({
      matterId: matter.id, clientShareBips: 2000, amountOre: 200_000,
      notes: "Aconto 2 — fortsatt självrisk-andel",
    });
    acconto++;
  }
  // Var fjärde ärende slutfaktureras till försäkring
  if (String(matter.id).charCodeAt(1) % 4 === 0) {
    const deductedIds = [acc1.run.id, ...(acc2 ? [acc2.run.id] : [])];
    await c.billingRun.createFinal({
      matterId: matter.id, recipient: "FORSAKRING",
      deductedBillingRunIds: deductedIds,
      notes: "Slutfaktura till försäkringsbolaget — avdrag för klient-aconton",
    });
    final++;
  }
  return { acconto, final };
}

async function runRattshjalpFlow(c: AnyCaller, matter: Row): Promise<{ acconto: number; final: number }> {
  let final = 0;
  // Rättshjälpsavgift t.ex. 30%
  await c.billingRun.createAcconto({
    matterId: matter.id, clientShareBips: 3000, amountOre: 150_000,
    notes: "Aconto — klientens rättshjälpsavgift",
  });
  if (String(matter.id).charCodeAt(1) % 3 === 0) {
    await c.billingRun.createFinal({
      matterId: matter.id, recipient: "RATTSHJALPSMYNDIGHET",
      notes: "Slutfaktura till rättshjälpsmyndigheten",
    });
    final++;
  }
  return { acconto: 1, final };
}

async function runKostnadsrakningFlow(c: AnyCaller, matter: Row, idx: number): Promise<{ pending: number; sent: number }> {
  const kr = await c.billingRun.createKostnadsrakning({
    matterId: matter.id, notes: "Kostnadsräkning för offentligt försvarsuppdrag",
  });
  // Varannan får dom direkt (med liten prutning), resten ligger PENDING
  if (idx % 2 === 0) {
    await c.billingRun.setVerdict({
      billingRunId: kr.run.id,
      prutningOre: -50_000, // 500 kr prutning
    });
    return { pending: 0, sent: 1 };
  }
  return { pending: 1, sent: 0 };
}

export async function populateBillingRuns(caller: GeneratorCaller, seed: SeedDataset): Promise<BillingRunsResult> {
  const c = caller as AnyCaller;
  const res: BillingRunsResult = { acconto: 0, final: 0, kostnadsrakningPending: 0, kostnadsrakningSent: 0 };

  for (const m of eligible(seed, ["RATTSSKYDD"])) {
    const r = await runRattsskyddFlow(c, m);
    res.acconto += r.acconto; res.final += r.final;
  }
  for (const m of eligible(seed, ["RATTSHJALP"])) {
    const r = await runRattshjalpFlow(c, m);
    res.acconto += r.acconto; res.final += r.final;
  }
  // Bara icke-taxa-OFFENTLIG_FORSVARARE — taxa-ärenden hanteras via existerande
  // brottmålstaxan-flöde (eget kostnadsräkning-router som vi behåller intakt).
  const offForsv = eligible(seed, ["OFFENTLIG_FORSVARARE"])
    .filter((m) => m.isTaxeArende !== true);
  let idx = 0;
  for (const m of offForsv) {
    const r = await runKostnadsrakningFlow(c, m, idx++);
    res.kostnadsrakningPending += r.pending;
    res.kostnadsrakningSent += r.sent;
  }
  return res;
}
