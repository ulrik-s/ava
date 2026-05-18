/**
 * `/demo` — landing-page för AVA demo-läget.
 *
 * Server Component-wrapper som monterar en Client Component med
 * default-runtime-factory (`cloneFromGithub()`). Tester av Client-
 * Component:n använder en injicerad fake-factory så vi inte beror på
 * isomorphic-git/http.
 *
 * Designval (Single responsibility):
 *   - Den här filen bara wirar produktions-factory:n. Ingen UI-logik
 *     här — allt bor i `_demo-client.tsx`.
 */

import { DemoClient } from "./_demo-client";
import { DemoRuntime } from "@/server/local-first/demo-runtime";
import { cloneFromGithub } from "@/server/local-first/clone-from-github";

export const metadata = {
  title: "AVA Demo",
  description: "Läs in ett publikt git-repo med demo-data och se AVA i action — utan installation.",
};

function defaultRuntime(): DemoRuntime {
  return DemoRuntime.create({ cloneFn: cloneFromGithub() });
}

export default function DemoPage() {
  return <DemoClient runtimeFactory={defaultRuntime} />;
}
