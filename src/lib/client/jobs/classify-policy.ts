/**
 * Vem klassificerar ett uppladdat dokument? (#1220)
 *
 * Förr köade klienten ALLTID sitt `classify-document`-jobb (filnamns-
 * heuristik) — även i server-first, där servern samtidigt klassificerar med
 * text + LLM och segmenterar dokumentet i delar. Båda skrev `documentType`,
 * och den som blev klar sist vann: klientens filnamnsgissning skrev ofta över
 * serverns bättre svar.
 *
 * Nu: finns en durabel server-jobbkö (kapabiliteten `jobs`, ADR 0027 — aldrig
 * bygg-flaggan) OCH har bytes:en nått servern, så äger servern klassificeringen
 * och klienten avstår. Annars (demo, offline-FSA utan server-bytes) klassificerar
 * klienten som förut.
 */
export function shouldClassifyOnClient(serverJobs: boolean, bytesSentToServer: boolean): boolean {
  return !(serverJobs && bytesSentToServer);
}
