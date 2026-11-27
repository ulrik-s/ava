/**
 * Snapshotets märken (#1714): vilka rader en sparning bär över ur det lagrade
 * snapshotet, och hur de läggs in i flikens källa.
 */

import { describe, expect, it } from "vitest-compat";
import { carryRows, NO_MARKS, parseMarks, planCarry, type SnapshotMarks } from "@/lib/client/local-store/snapshot-marks";

const ref = (id: string, entity = "timeEntry") => ({ entity, id });
const marks = (...pending: Array<[string, string[]]>): SnapshotMarks =>
  ({ pending: pending.map(([id, ids]) => ({ id, refs: ids.map((r) => ref(r)) })), owed: [] });
/** Kön i ordning: platsen är postens index. */
const queue = (...ids: string[]) => (id: string): number | null => (ids.includes(id) ? ids.indexOf(id) : null);

describe("parseMarks", () => {
  it("läser sparade märken", () => {
    const stored = { pending: [{ id: "X", refs: [ref("x")] }], owed: [ref("o")] };
    expect(parseMarks(stored)).toEqual(stored);
  });

  it("inga eller trasiga märken → null", () => {
    expect(parseMarks(null)).toBeNull();
    expect(parseMarks({ pending: "alla" })).toBeNull();
    expect(parseMarks({ pending: [{ id: 1, refs: [] }], owed: [] })).toBeNull();
  });
});

describe("planCarry", () => {
  it("inga lagrade märken → inget bärs över", () => {
    expect(planCarry(NO_MARKS, marks(["M", ["m"]]), queue("M"), null)).toEqual({ unknown: [], carried: [], rows: [] });
  });

  it("flikens egna märken bärs inte över", () => {
    const mine = marks(["M", ["m"]]);
    expect(planCarry(mine, mine, queue("M"), null)).toEqual({ unknown: [], carried: [], rows: [] });
  });

  it("en annan fliks köade post bärs över med sina rader", () => {
    const plan = planCarry(marks(["X", ["x1", "x2"]]), marks(["M", ["m"]]), queue("X", "M"), null);
    expect(plan.unknown).toEqual([]);
    expect(plan.carried).toEqual([{ id: "X", refs: [ref("x1"), ref("x2")] }]);
    expect(plan.rows).toEqual([ref("x1"), ref("x2")]);
  });

  it("en post fliken inte känner igen → okänd, och inget bärs över förrän kön lästs om", () => {
    const plan = planCarry(marks(["X", ["x"]], ["Y", ["y"]]), NO_MARKS, queue("Y"), null);
    expect(plan).toEqual({ unknown: ["X"], carried: [], rows: [] });
  });

  it("efter omläsningen: en post som fortfarande saknas i kön är avgjord och bärs inte över", () => {
    const plan = planCarry(marks(["X", ["x"]], ["Y", ["y"]]), NO_MARKS, queue("Y"), new Set(["X"]));
    expect(plan.carried.map((m) => m.id)).toEqual(["Y"]);
    expect(plan.rows).toEqual([ref("y")]);
  });

  it("efter omläsningen: en post som nu ligger i kön bärs över", () => {
    const plan = planCarry(marks(["X", ["x"]]), NO_MARKS, queue("X"), new Set(["X"]));
    expect(plan.rows).toEqual([ref("x")]);
  });

  it("en post som dykt upp EFTER omläsningen bärs över — hellre en rad för mycket", () => {
    const plan = planCarry(marks(["X", ["x"]], ["Z", ["z"]]), NO_MARKS, queue(), new Set(["X"]));
    expect(plan.unknown).toEqual([]);
    expect(plan.carried.map((m) => m.id)).toEqual(["Z"]);
    expect(plan.rows).toEqual([ref("z")]);
  });

  it("samma rad i båda flikarna: den senast köade posten vinner", () => {
    // Flikens post M köades efter X → flikens läge gäller.
    expect(planCarry(marks(["X", ["r"]]), marks(["M", ["r"]]), queue("X", "M"), null).rows).toEqual([]);
    // X köades efter M → den andra flikens läge gäller.
    expect(planCarry(marks(["X", ["r"]]), marks(["M", ["r"]]), queue("M", "X"), null).rows).toEqual([ref("r")]);
  });

  it("flikens senaste post på raden räknas, inte den första", () => {
    const mine = marks(["M1", ["r"]], ["M2", ["r"]]);
    expect(planCarry(marks(["X", ["r", "s"]]), mine, queue("M1", "X", "M2"), null).rows).toEqual([ref("s")]);
  });

  it("samma id i en annan entitet är en annan rad", () => {
    const stored: SnapshotMarks = { pending: [{ id: "X", refs: [ref("r", "matter")] }], owed: [] };
    expect(planCarry(stored, marks(["M", ["r"]]), queue("X", "M"), null).rows).toEqual([ref("r", "matter")]);
  });
});

describe("carryRows", () => {
  it("utan rader att bära över är källan oförändrad", () => {
    const source = { timeEntries: [{ id: "a" }] };
    expect(carryRows(source, { timeEntries: [{ id: "b" }] }, [])).toEqual(source);
  });

  it("en rad som bara finns i lagringen läggs till; flikens källa ändras inte", () => {
    const source = { timeEntries: [{ id: "a" }] };
    const out = carryRows(source, { timeEntries: [{ id: "x", minutes: 45 }] }, [ref("x")]);
    expect(out.timeEntries).toEqual([{ id: "a" }, { id: "x", minutes: 45 }]);
    expect(source.timeEntries).toEqual([{ id: "a" }]);
  });

  it("en rad som finns på båda sidor byts på sin plats", () => {
    const source = { timeEntries: [{ id: "a" }, { id: "x", minutes: 30 }, { id: "b" }] };
    const out = carryRows(source, { timeEntries: [{ id: "x", minutes: 45 }] }, [ref("x")]);
    expect(out.timeEntries).toEqual([{ id: "a" }, { id: "x", minutes: 45 }, { id: "b" }]);
  });

  it("en rad som saknas i lagringen (köad radering) tas bort", () => {
    const source = { timeEntries: [{ id: "a" }, { id: "x" }] };
    expect(carryRows(source, { timeEntries: [] }, [ref("x")]).timeEntries).toEqual([{ id: "a" }]);
    expect(carryRows(source, {}, [ref("x")]).timeEntries).toEqual([{ id: "a" }]);
  });

  it("en källnyckel som fliken saknar skapas", () => {
    const out = carryRows({}, { matters: [{ id: "m" }] }, [ref("m", "matter")]);
    expect(out.matters).toEqual([{ id: "m" }]);
  });

  it("en okänd entitet och ett trasigt lagrat snapshot hoppas över", () => {
    const source = { timeEntries: [{ id: "a" }] };
    expect(carryRows(source, { timeEntries: [{ id: "x" }] }, [ref("x", "finnsInte")])).toEqual(source);
    expect(carryRows(source, null, [ref("a")]).timeEntries).toEqual([]);
    expect(carryRows(source, "trasig", [ref("q")]).timeEntries).toEqual([{ id: "a" }]);
  });

  it("rader utan sträng-id rörs inte", () => {
    const source = { timeEntries: [{ id: 7 }, { id: "x" }] };
    const out = carryRows(source, { timeEntries: [{ id: 7, lagrad: true }, { id: "x", minutes: 45 }] }, [ref("x")]);
    expect(out.timeEntries).toEqual([{ id: 7 }, { id: "x", minutes: 45 }]);
  });
});
