/**
 * Ärendenumret med ansvarig jurists initialer (#1727).
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { MatterNumber } from "@/components/matter/matter-number";

let users: Array<{ id: string; matterNumberPrefix?: string | null }> | undefined;
vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { list: { useQuery: () => ({ data: users ? { users } : undefined }) } } },
}));

beforeEach(() => { users = [{ id: "u-ab", matterNumberPrefix: "AB" }, { id: "u-none", matterNumberPrefix: null }]; });

describe("MatterNumber", () => {
  it("visar initialerna i fetstil, ett mellanslag och numret", () => {
    const { container } = render(<MatterNumber matterNumber="2026-0001" responsibleLawyerId="u-ab" />);
    expect(container).toHaveTextContent(/^AB 2026-0001$/);
    expect(container.querySelector("strong")).toHaveTextContent(/^AB$/);
  });

  it("utan initialer visas bara numret", () => {
    const { container } = render(<MatterNumber matterNumber="AB2026-0001" responsibleLawyerId="u-ab" />);
    expect(container).toHaveTextContent(/^AB2026-0001$/);
    expect(container.querySelector("strong")).toBeNull();
  });

  it("juristen saknar prefix, eller ärendet saknar ansvarig → bara numret", () => {
    const a = render(<MatterNumber matterNumber="2026-0001" responsibleLawyerId="u-none" />);
    expect(a.container.querySelector("strong")).toBeNull();
    const b = render(<MatterNumber matterNumber="2026-0002" />);
    expect(b.container).toHaveTextContent(/^2026-0002$/);
  });

  it("innan användarlistan laddats visas bara numret", () => {
    users = undefined;
    const { container } = render(<MatterNumber matterNumber="2026-0001" responsibleLawyerId="u-ab" />);
    expect(container).toHaveTextContent(/^2026-0001$/);
  });
});
