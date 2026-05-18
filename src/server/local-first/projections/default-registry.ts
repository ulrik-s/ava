/**
 * `buildDefaultRegistry()` — fabriksfunktion som returnerar en
 * `ProjectionRegistry` förkonfigurerad med alla projektioner som
 * `LocalGitStore` levererar idag.
 *
 * Designval (Open-closed): när en ny entitet ska projiceras lägger man
 * till sin `register(...)` här (eller anropar caller-side om man behöver
 * specifika test-skedda subsets). Befintliga komponenter behöver inte
 * röras.
 */

import { ProjectionRegistry } from "./registry";
import { MatterProjection } from "./matter";
import { ContactProjection } from "./contact";
import { UserProjection } from "./user";

export function buildDefaultRegistry(): ProjectionRegistry {
  const r = new ProjectionRegistry();

  r.register({
    entity: "matter",
    projection: new MatterProjection(),
    ownsPath: (p) => p.startsWith("matters/"),
  });

  r.register({
    entity: "contact",
    projection: new ContactProjection(),
    ownsPath: (p) => p.startsWith("contacts/"),
  });

  r.register({
    entity: "user",
    projection: new UserProjection(),
    ownsPath: (p) => p.startsWith(".ava/users/"),
  });

  return r;
}
