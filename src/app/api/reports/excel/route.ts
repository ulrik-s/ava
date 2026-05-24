import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import ExcelJS from "exceljs";

/**
 * Advokat-rapport till Excel — speglar innehållet på /reports:
 *   Blad 1: Ärenden under perioden
 *   Blad 2: Timdebitering per vecka
 *   Blad 3: Upparbetat, icke fakturerat
 *
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&userIds=<id>
 * (userIds stöder kommaseparerad lista men rapporten är per-advokat, så
 *  bara första id:t används — motsvarar UI:ts dropdown.)
 */

// ─── ISO-vecka ───────────────────────────────────────────────────────

function isoWeek(d: Date): { year: number; week: number } {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((dt.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return { year: dt.getUTCFullYear(), week };
}

function mondayOfIsoWeek(d: Date): Date {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr);
  return dt;
}

function weeksInRange(from: Date, to: Date) {
  const weeks: { isoYear: number; week: number; start: Date; end: Date }[] = [];
  let cursor = mondayOfIsoWeek(from);
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor.getTime() <= end.getTime()) {
    const weekEnd = new Date(cursor);
    weekEnd.setUTCDate(cursor.getUTCDate() + 6);
    const { year, week } = isoWeek(cursor);
    weeks.push({ isoYear: year, week, start: new Date(cursor), end: weekEnd });
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

const weekKey = (y: number, w: number) => `${y}-W${String(w).padStart(2, "0")}`;

// ─── Format-helpers ──────────────────────────────────────────────────

/** öre → "1 234,56" (svensk kr, utan suffix — kolumn har redan "kr" i header). */
function ore(v: number): string {
  return (v / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hours(minutes: number): string {
  return (minutes / 60).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Route ───────────────────────────────────────────────────────────

const headerStyle: Partial<ExcelJS.Style> = {
  font: { bold: true, size: 11 },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "F3F4F6" } },
  border: { bottom: { style: "thin", color: { argb: "D1D5DB" } } },
};

const totalStyle: Partial<ExcelJS.Style> = {
  font: { bold: true },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "F9FAFB" } },
  border: { top: { style: "thin", color: { argb: "9CA3AF" } } },
};

type ReportInputs = { from: string; to: string; userId: string };

function parseInputs(req: NextRequest): ReportInputs | NextResponse {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const userId = searchParams.get("userIds")?.split(",").filter(Boolean)[0];
  if (!from || !to) return NextResponse.json({ error: "from and to required" }, { status: 400 });
  if (!userId) return NextResponse.json({ error: "userIds required" }, { status: 400 });
  return { from, to, userId };
}

type MatterRef = {
  id: string; matterNumber: string; title: string;
  contacts: Array<{ contact: { name: string } }>;
};
type TimeEntryRow = {
  id: string; date: Date; minutes: number; billable: boolean; hourlyRate: number;
  description: string; invoiceId: string | null; matter: MatterRef;
};
type ExpenseRow = {
  id: string; date: Date; amount: number; billable: boolean; invoiceId: string | null;
  matter: MatterRef;
};

async function loadReportData(orgId: string, userId: string, from: Date, to: Date) {
  const orgScope = { matter: { organizationId: orgId } } as const;
  return Promise.all([
    prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: { id: true, name: true, hourlyRate: true },
    }),
    prisma.timeEntry.findMany({
      where: { ...orgScope, userId, date: { gte: from, lte: to } },
      select: {
        id: true, date: true, minutes: true, billable: true, hourlyRate: true,
        description: true, invoiceId: true,
        matter: {
          select: {
            id: true, matterNumber: true, title: true,
            contacts: { where: { role: "KLIENT" }, select: { contact: { select: { name: true } } }, take: 1 },
          },
        },
      },
      orderBy: { date: "asc" },
    }) as Promise<TimeEntryRow[]>,
    prisma.expense.findMany({
      where: { ...orgScope, userId, date: { gte: from, lte: to } },
      select: {
        id: true, date: true, amount: true, billable: true, invoiceId: true,
        matter: {
          select: {
            id: true, matterNumber: true, title: true,
            contacts: { where: { role: "KLIENT" }, select: { contact: { select: { name: true } } }, take: 1 },
          },
        },
      },
      orderBy: { date: "asc" },
    }) as Promise<ExpenseRow[]>,
  ]);
}

type MatterAgg = {
  matterNumber: string; title: string; client: string | null;
  totalMinutes: number; billableMinutes: number; workValueOre: number; expenseOre: number;
};

function aggregateMatters(timeEntries: TimeEntryRow[], expenses: ExpenseRow[]) {
  const matters = new Map<string, MatterAgg>();
  const ensure = (m: MatterRef) => {
    const cached = matters.get(m.id);
    if (cached) return cached;
    const created: MatterAgg = {
      matterNumber: m.matterNumber, title: m.title,
      client: m.contacts[0]?.contact.name ?? null,
      totalMinutes: 0, billableMinutes: 0, workValueOre: 0, expenseOre: 0,
    };
    matters.set(m.id, created);
    return created;
  };
  for (const te of timeEntries) {
    const a = ensure(te.matter);
    a.totalMinutes += te.minutes;
    if (te.billable) {
      a.billableMinutes += te.minutes;
      a.workValueOre += Math.round((te.minutes / 60) * te.hourlyRate * 100);
    }
  }
  for (const ex of expenses) {
    if (ex.billable) ensure(ex.matter).expenseOre += ex.amount;
  }
  return Array.from(matters.entries())
    .map(([id, a]) => ({ id, ...a }))
    .sort((a, b) => a.matterNumber.localeCompare(b.matterNumber, "sv"));
}

type WeekCell = { totalMinutes: number; billableMinutes: number; workValueOre: number };

function aggregateWeeks(timeEntries: TimeEntryRow[], from: Date, to: Date) {
  const weeks = weeksInRange(from, to);
  const grid = new Map<string, WeekCell>();
  for (const w of weeks) grid.set(weekKey(w.isoYear, w.week), { totalMinutes: 0, billableMinutes: 0, workValueOre: 0 });
  for (const te of timeEntries) {
    const { year, week } = isoWeek(te.date);
    const cell = grid.get(weekKey(year, week));
    if (!cell) continue;
    cell.totalMinutes += te.minutes;
    if (te.billable) {
      cell.billableMinutes += te.minutes;
      cell.workValueOre += Math.round((te.minutes / 60) * te.hourlyRate * 100);
    }
  }
  return { weeks, grid };
}

type Unbilled = {
  matterNumber: string; title: string; client: string | null;
  timeOre: number; expenseOre: number; total: number;
};

function aggregateUnbilled(timeEntries: TimeEntryRow[], expenses: ExpenseRow[]) {
  const unbilled = new Map<string, Unbilled>();
  const ensure = (m: MatterRef) => {
    const cached = unbilled.get(m.id);
    if (cached) return cached;
    const created: Unbilled = {
      matterNumber: m.matterNumber, title: m.title,
      client: m.contacts[0]?.contact.name ?? null,
      timeOre: 0, expenseOre: 0, total: 0,
    };
    unbilled.set(m.id, created);
    return created;
  };
  for (const te of timeEntries) {
    if (!te.billable || te.invoiceId) continue;
    const o = Math.round((te.minutes / 60) * te.hourlyRate * 100);
    const r = ensure(te.matter);
    r.timeOre += o; r.total += o;
  }
  for (const ex of expenses) {
    if (!ex.billable || ex.invoiceId) continue;
    const r = ensure(ex.matter);
    r.expenseOre += ex.amount; r.total += ex.amount;
  }
  return Array.from(unbilled.values())
    .filter((r) => r.total > 0)
    .sort((a, b) => a.matterNumber.localeCompare(b.matterNumber, "sv"));
}

export async function GET(req: NextRequest) {
  const parsed = parseInputs(req);
  if (parsed instanceof NextResponse) return parsed;
  const { from, to, userId } = parsed;

  const org = await prisma.organization.findFirst();
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 404 });

  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setUTCHours(23, 59, 59, 999);

  const [user, timeEntries, expenses] = await loadReportData(org.id, userId, fromDate, toDate);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const mattersSorted = aggregateMatters(timeEntries, expenses);
  const { weeks, grid: weekGrid } = aggregateWeeks(timeEntries, fromDate, toDate);
  const unbilledSorted = aggregateUnbilled(timeEntries, expenses);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AVA";
  workbook.created = new Date();
  addMatterSheet(workbook, user.name, from, to, mattersSorted);
  addWeeklySheet(workbook, user.name, from, to, weeks, weekGrid);
  addUnbilledSheet(workbook, user.name, from, to, unbilledSorted);

  const buffer = await workbook.xlsx.writeBuffer();
  const safeName = user.name.replace(/[^\w-]+/g, "_");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rapport_${safeName}_${from}_${to}.xlsx"`,
    },
  });
}

type MatterRow = {
  matterNumber: string;
  title: string;
  client: string | null;
  totalMinutes: number;
  billableMinutes: number;
  workValueOre: number;
  expenseOre: number;
};

function addMatterSheet(
  workbook: ExcelJS.Workbook,
  userName: string,
  from: string,
  to: string,
  mattersSorted: MatterRow[],
) {
  const s = workbook.addWorksheet("Ärenden");
  s.mergeCells("A1:F1");
  const t = s.getCell("A1");
  t.value = `Ärenden — ${userName} (${from} till ${to})`;
  t.font = { bold: true, size: 14 };
  s.addRow([]);
  s.columns = [
    { key: "matterNumber", width: 14 },
    { key: "title", width: 36 },
    { key: "client", width: 24 },
    { key: "totalHours", width: 12 },
    { key: "billableHours", width: 12 },
    { key: "workValue", width: 16 },
    { key: "expense", width: 14 },
  ];
  const h = s.getRow(3);
  h.values = ["Ärendenr", "Ärende", "Klient", "Tid (tim)", "Deb. (tim)", "Arbetsvärde (kr)", "Utlägg (kr)"];
  h.eachCell((c) => { c.style = headerStyle; });

  let tMin = 0, bMin = 0, wv = 0, ex = 0;
  for (const m of mattersSorted) {
    s.addRow({
      matterNumber: m.matterNumber, title: m.title, client: m.client ?? "",
      totalHours: hours(m.totalMinutes), billableHours: hours(m.billableMinutes),
      workValue: ore(m.workValueOre), expense: m.expenseOre > 0 ? ore(m.expenseOre) : "",
    });
    tMin += m.totalMinutes; bMin += m.billableMinutes; wv += m.workValueOre; ex += m.expenseOre;
  }
  const tot = s.addRow({
    matterNumber: "", title: "", client: "Totalt",
    totalHours: hours(tMin), billableHours: hours(bMin), workValue: ore(wv), expense: ore(ex),
  });
  tot.eachCell((c) => { c.style = totalStyle; });
}

function addWeeklySheet(
  workbook: ExcelJS.Workbook,
  userName: string,
  from: string,
  to: string,
  weeks: ReturnType<typeof weeksInRange>,
  weekGrid: Map<string, { totalMinutes: number; billableMinutes: number; workValueOre: number }>,
) {
  const s = workbook.addWorksheet("Timdebitering per vecka");
  s.mergeCells("A1:E1");
  const t = s.getCell("A1");
  t.value = `Timdebitering per vecka — ${userName} (${from} till ${to})`;
  t.font = { bold: true, size: 14 };
  s.addRow([]);
  s.columns = [
    { key: "week", width: 12 },
    { key: "period", width: 20 },
    { key: "total", width: 12 },
    { key: "billable", width: 12 },
    { key: "workValue", width: 16 },
  ];
  const h = s.getRow(3);
  h.values = ["Vecka", "Period", "Tid (tim)", "Deb. (tim)", "Arbetsvärde (kr)"];
  h.eachCell((c) => { c.style = headerStyle; });

  let tMin = 0, bMin = 0, wv = 0;
  for (const w of weeks) {
    const cell = weekGrid.get(weekKey(w.isoYear, w.week))!;
    s.addRow({
      week: `${w.isoYear}-v${String(w.week).padStart(2, "0")}`,
      period: `${w.start.toISOString().slice(0, 10)} – ${w.end.toISOString().slice(0, 10)}`,
      total: cell.totalMinutes > 0 ? hours(cell.totalMinutes) : "",
      billable: cell.billableMinutes > 0 ? hours(cell.billableMinutes) : "",
      workValue: cell.workValueOre > 0 ? ore(cell.workValueOre) : "",
    });
    tMin += cell.totalMinutes; bMin += cell.billableMinutes; wv += cell.workValueOre;
  }
  const tot = s.addRow({
    week: "", period: "Totalt",
    total: hours(tMin), billable: hours(bMin), workValue: ore(wv),
  });
  tot.eachCell((c) => { c.style = totalStyle; });
}

type UnbilledRow = {
  matterNumber: string;
  title: string;
  client: string | null;
  timeOre: number;
  expenseOre: number;
  total: number;
};

function addUnbilledSheet(
  workbook: ExcelJS.Workbook,
  userName: string,
  from: string,
  to: string,
  unbilledSorted: UnbilledRow[],
) {
  const s = workbook.addWorksheet("Upparb. ej fakt.");
  s.mergeCells("A1:E1");
  const t = s.getCell("A1");
  t.value = `Upparbetat, icke fakturerat — ${userName} (${from} till ${to})`;
  t.font = { bold: true, size: 14 };
  s.addRow([]);
  s.columns = [
    { key: "matterNumber", width: 14 },
    { key: "title", width: 36 },
    { key: "client", width: 24 },
    { key: "time", width: 14 },
    { key: "expense", width: 14 },
    { key: "total", width: 14 },
  ];
  const h = s.getRow(3);
  h.values = ["Ärendenr", "Ärende", "Klient", "Tid (kr)", "Utlägg (kr)", "Summa (kr)"];
  h.eachCell((c) => { c.style = headerStyle; });

  let total = 0;
  for (const r of unbilledSorted) {
    s.addRow({
      matterNumber: r.matterNumber, title: r.title, client: r.client ?? "",
      time: r.timeOre > 0 ? ore(r.timeOre) : "",
      expense: r.expenseOre > 0 ? ore(r.expenseOre) : "",
      total: ore(r.total),
    });
    total += r.total;
  }
  const tot = s.addRow({
    matterNumber: "", title: "", client: "Totalt", time: "", expense: "", total: ore(total),
  });
  tot.eachCell((c) => { c.style = totalStyle; });
}
