/**
 * `/demo` — landing-page för AVA demo-läget.
 *
 * Server Component som mountrar `DemoClient`. Vi propar INTE en
 * runtime-factory hit ner — Next 16/RSC tillåter inte att funktioner
 * skickas över Server/Client-gränsen. Client Component:n bygger sin
 * egen default-runtime via `cloneFromGithub()`; tester kan fortfarande
 * propa en fake.
 */

import { DemoClient } from "./_demo-client";

export const metadata = {
  title: "AVA Demo",
  description:
    "Läs in ett publikt git-repo med demo-data och se AVA i action — utan installation.",
};

export default function DemoPage() {
  return <DemoClient />;
}
