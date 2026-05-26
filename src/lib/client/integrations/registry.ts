"use client";

/**
 * Singleton-registry för IntegrationConnectors. Comnectors registrerar
 * sig vid first import (likt jobb-workers). UI:n läser hela listan.
 */

import type { IntegrationConnector } from "./types";

const connectors = new Map<string, IntegrationConnector>();

export function registerConnector(c: IntegrationConnector): void {
  connectors.set(c.id, c);
}

export function getConnector(id: string): IntegrationConnector | undefined {
  return connectors.get(id);
}

export function listConnectors(): IntegrationConnector[] {
  return Array.from(connectors.values());
}
