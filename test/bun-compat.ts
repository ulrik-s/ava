/* eslint-disable @typescript-eslint/no-explicit-any -- typ-bryggande
 * kompat-shim: `vi`-API:t är medvetet dynamiskt (godtyckliga mockar,
 * globala stubbar) och kan inte uttryckas utan `any`. */

/**
 * Vitest → bun:test-kompat-shim (#92).
 *
 * Testfilerna importerar `describe/it/expect/vi/...` härifrån i stället
 * för från "vitest". bun:test:s primitiver re-exporteras orörda; `vi`
 * mappas mot bun:test:s `mock`/`spyOn`/`jest`. Så slipper vi skriva om
 * 750+ `vi.fn`-anrop — och kan beta av kvarvarande `vi`-bruk till native
 * bun:test över tid.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect as bunExpect,
  it,
  jest,
  mock,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";

export { afterAll, afterEach, beforeAll, beforeEach, describe, it, test };

// Loose-typad expect (vitest-likt). Buns generiska matchers (t.ex.
// `toBe(expected: T)`) är strängare än vitests och skulle kräva casts på
// ~50 ställen (branded ids ≠ string-literal m.m.). vitest typade matchers
// löst — vi gör likadant. Statiska (expect.any/objectContaining/extend)
// behålls via `typeof bunExpect`. (#92)
type LooseExpect = (<T>(actual?: T, message?: string) => any) & typeof bunExpect;
export const expect = bunExpect as unknown as LooseExpect;

interface Clearable {
  mockClear?: () => void;
  mockReset?: () => void;
  mockRestore?: () => void;
}

const tracked: Clearable[] = [];
const stubbedGlobals: Array<{ key: string; desc: PropertyDescriptor | undefined }> = [];
const stubbedEnvs: Array<{ key: string; had: boolean; prev: string | undefined }> = [];

function track<T extends Clearable>(m: T): T {
  tracked.push(m);
  return m;
}

async function flushMicrotasks(): Promise<void> {
  // Töm promise-kedjor som timer-callbacks spawnar (fetch→json→setState→
  // re-render→nästa setTimeout). vitests advanceTimersByTimeAsync gör detta;
  // vi approximerar med flera varv microtask-draining.
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

export const vi = {
  fn: (impl?: (...args: any[]) => any): any => track((impl ? mock(impl) : mock(() => undefined)) as any),
  spyOn: (obj: any, key: any): any => track(spyOn(obj, key) as any),
  mock: (path: string, factory?: () => any): void => {
    void mock.module(path, factory ?? (() => ({})));
  },
  mocked: <T>(x: T): any => x,
  clearAllMocks: (): void => {
    for (const m of tracked) m.mockClear?.();
  },
  resetAllMocks: (): void => {
    for (const m of tracked) m.mockReset?.();
  },
  restoreAllMocks: (): void => {
    for (const m of tracked) m.mockRestore?.();
  },
  useFakeTimers: (_opts?: unknown): void => {
    jest.useFakeTimers();
  },
  useRealTimers: (): void => {
    jest.useRealTimers();
  },
  advanceTimersByTime: (ms: number): void => {
    jest.advanceTimersByTime(ms);
  },
  advanceTimersByTimeAsync: async (ms: number): Promise<void> => {
    jest.advanceTimersByTime(ms);
    await flushMicrotasks();
  },
  runAllTimers: (): void => {
    (jest as any).runAllTimers();
  },
  getTimerCount: (): number => (jest as any).getTimerCount(),
  setSystemTime: (time?: number | Date): void => {
    setSystemTime(time);
  },
  stubGlobal: (key: string, value: unknown): void => {
    // defineProperty (inte direkt assign) → kan skriva över happy-doms
    // readonly getter-globaler (navigator/location/...).
    stubbedGlobals.push({ key, desc: Object.getOwnPropertyDescriptor(globalThis, key) });
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  },
  unstubAllGlobals: (): void => {
    while (stubbedGlobals.length > 0) {
      const s = stubbedGlobals.pop()!;
      if (s.desc) Object.defineProperty(globalThis, s.key, s.desc);
      else delete (globalThis as any)[s.key];
    }
  },
  stubEnv: (key: string, value: string): void => {
    stubbedEnvs.push({ key, had: key in process.env, prev: process.env[key] });
    process.env[key] = value;
  },
  unstubAllEnvs: (): void => {
    while (stubbedEnvs.length > 0) {
      const s = stubbedEnvs.pop()!;
      if (s.had) process.env[s.key] = s.prev;
      else delete process.env[s.key];
    }
  },
  hoisted: <T>(factory: () => T): T => factory(),
  resetModules: (): void => undefined,
};
