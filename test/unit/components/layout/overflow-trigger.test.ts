/**
 * Överflödesknappen i dockviews flikrad (#1292): flikar som inte ryms låg bakom
 * en liten grå "⌄ 1" — en div utan roll, som inte gick att nå med tangentbordet.
 * `labelOverflowTriggers` gör den till en riktig knapp med ett begripligt namn.
 */
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest-compat";
import { labelOverflowTriggers, overflowLabel, useOverflowTriggerLabels } from "@/components/layout/overflow-trigger";

/**
 * happy-dom levererar MutationObserver-anrop via en timer. Positiva fall väntar
 * därför med `waitFor`; negativa (inget ska hända) väntar en generös stund.
 */
const settle = (): Promise<void> => new Promise((r) => { setTimeout(r, 30); });

/** En överflödesknapp som dockview bygger den: root > default > (ikon, antal). */
function dockviewTrigger(count: string): { root: HTMLElement; text: HTMLElement } {
  const root = document.createElement("div");
  root.className = "dv-tabs-overflow-dropdown-root";
  const inner = document.createElement("div");
  inner.className = "dv-tabs-overflow-dropdown-default";
  const text = document.createElement("span");
  text.textContent = count;
  inner.append(document.createElement("svg"), text);
  root.append(inner);
  return { root, text };
}

let container: HTMLElement | null = null;
let stop = (): void => {};
afterEach(() => { stop(); stop = () => {}; container?.remove(); container = null; });

function mount(): HTMLElement {
  const c = document.createElement("div");
  document.body.append(c);
  container = c;
  stop = labelOverflowTriggers(c);
  return c;
}

describe("overflowLabel", () => {
  it("singular och plural", () => {
    expect(overflowLabel(1)).toBe("1 dold flik");
    expect(overflowLabel(3)).toBe("3 dolda flikar");
  });
});

describe("labelOverflowTriggers (#1292)", () => {
  it("en knapp som redan finns får roll, tabbstopp och namn", () => {
    const c = document.createElement("div");
    document.body.append(c);
    container = c;
    const { root } = dockviewTrigger("2");
    c.append(root);
    stop = labelOverflowTriggers(c);
    expect(root.getAttribute("role")).toBe("button");
    expect(root.tabIndex).toBe(0);
    expect(root.getAttribute("aria-label")).toBe("2 dolda flikar");
    expect(root.title).toBe("2 dolda flikar");
  });

  it("en knapp som dockview lägger till senare märks också", async () => {
    const c = mount();
    const { root } = dockviewTrigger("1");
    c.append(root);
    await waitFor(() => { expect(root.getAttribute("aria-label")).toBe("1 dold flik"); });
  });

  it("namnet följer antalet när fler flikar göms", async () => {
    const c = document.createElement("div");
    document.body.append(c);
    container = c;
    const { root, text } = dockviewTrigger("1");
    c.append(root);
    stop = labelOverflowTriggers(c);
    text.textContent = "3";
    await waitFor(() => { expect(root.getAttribute("aria-label")).toBe("3 dolda flikar"); });
  });

  it("Enter och mellanslag öppnar listan (klick vid knappen, som dockview förankrar menyn i)", async () => {
    const c = mount();
    const { root } = dockviewTrigger("1");
    c.append(root);
    await settle();
    const clicks: Array<{ x: number; y: number }> = [];
    root.addEventListener("click", (e) => { clicks.push({ x: e.clientX, y: e.clientY }); });
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(clicks).toHaveLength(2);
  });

  it("Enter sprids inte vidare — dockview stänger annars listan på samma tryck", async () => {
    const c = mount();
    const { root } = dockviewTrigger("1");
    c.append(root);
    await settle();
    const seenAbove: string[] = [];
    c.addEventListener("keydown", (e) => { seenAbove.push(e.key); });
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(seenAbove).toEqual(["a"]);
  });

  it("andra tangenter öppnar inte listan", async () => {
    const c = mount();
    const { root } = dockviewTrigger("1");
    c.append(root);
    await settle();
    let clicks = 0;
    root.addEventListener("click", () => { clicks++; });
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(clicks).toBe(0);
  });

  it("tangentlyssnaren läggs bara till en gång, även om knappen märks om", async () => {
    const c = mount();
    const { root, text } = dockviewTrigger("1");
    c.append(root);
    await settle();
    text.textContent = "2";
    await settle();
    let clicks = 0;
    root.addEventListener("click", () => { clicks++; });
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(clicks).toBe(1);
  });

  it("ett antal som inte går att läsa → ett allmänt namn", () => {
    const c = document.createElement("div");
    document.body.append(c);
    container = c;
    const { root } = dockviewTrigger("");
    c.append(root);
    stop = labelOverflowTriggers(c);
    expect(root.getAttribute("aria-label")).toBe("Dolda flikar");
  });

  it("efter stopp märks inga nya knappar", async () => {
    const c = mount();
    stop();
    const { root } = dockviewTrigger("1");
    c.append(root);
    await settle();
    expect(root.getAttribute("role")).toBeNull();
  });
});

describe("useOverflowTriggerLabels", () => {
  function Host() {
    return createElement("div", { ref: useOverflowTriggerLabels(), "data-testid": "host" });
  }

  it("märker upp knappar i behållaren medan den är monterad, och slutar efter avmontering", async () => {
    const { getByTestId, unmount } = render(createElement(Host));
    const host = getByTestId("host");
    const first = dockviewTrigger("2");
    host.append(first.root);
    await waitFor(() => { expect(first.root.getAttribute("aria-label")).toBe("2 dolda flikar"); });

    const detached = host;
    unmount();
    const later = dockviewTrigger("1");
    detached.append(later.root);
    await settle();
    expect(later.root.getAttribute("role")).toBeNull();
  });
});
