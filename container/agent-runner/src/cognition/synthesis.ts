/**
 * Synthesis — score-based, Free-MAD pattern.
 *
 * Ported from Midori/prototype/reasoning/synthesis.py.
 *
 * No majority voting. Every posted position is scored; the highest-scoring
 * position synthesises. Scoring weights:
 *   alignment 0.20, evidence_quality 0.30, confidence 0.15,
 *   breadth 0.10, epistemic_honesty 0.25.
 */

import type { AgentCard, Position, PositionScore } from "./types.js";
import { SCORE_WEIGHTS } from "./types.js";

const STRONG_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "mempalace",
  "erp",
  "statute",
]);

const HONEST_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "explicit_gap",
  "inference",
]);

const TAGGED_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "mempalace",
  "erp",
  "statute",
  "external",
  "inference",
  "explicit_gap",
]);

export function scorePosition(
  position: Position,
  synthesisingAgent: AgentCard,
  questionDomain: string,
): PositionScore {
  const agentName = position.agent;

  // ---- alignment ----
  let alignment = 0.5;
  if (synthesisingAgent.synthesisDomains.includes(questionDomain)) {
    alignment = agentName === synthesisingAgent.name ? 0.9 : 0.7;
  }

  // ---- evidence quality ----
  const claims = position.claims;
  let evidenceQuality = 0.0;
  if (claims.length > 0) {
    const strongCount = claims.filter((c) =>
      STRONG_SOURCE_TYPES.has(c.source_type as string),
    ).length;
    evidenceQuality = strongCount / Math.max(claims.length, 1);
  }

  // ---- confidence ----
  const confidence = position.confidence;

  // ---- breadth ----
  const sourceTypesUsed = new Set(claims.map((c) => c.source_type));
  const breadth = Math.min(1.0, sourceTypesUsed.size / 4.0);

  // ---- epistemic honesty ----
  let honesty = 0.0;
  if (claims.length > 0) {
    const honestCount = claims.filter((c) =>
      HONEST_SOURCE_TYPES.has(c.source_type as string),
    ).length;
    const allTagged = claims.every((c) =>
      TAGGED_SOURCE_TYPES.has(c.source_type as string),
    );
    honesty = (honestCount / claims.length) * 0.5 + (allTagged ? 0.5 : 0.0);
  }

  const total =
    alignment * SCORE_WEIGHTS.alignment +
    evidenceQuality * SCORE_WEIGHTS.evidenceQuality +
    confidence * SCORE_WEIGHTS.confidence +
    breadth * SCORE_WEIGHTS.breadth +
    honesty * SCORE_WEIGHTS.epistemicHonesty;

  return {
    positionAgent: agentName,
    alignment,
    evidenceQuality,
    confidence,
    breadth,
    epistemicHonesty: honesty,
    total,
  };
}

// ---- rotating synthesis authority ----

export const DOMAIN_TO_PRIMARY_SYNTHESISER: Readonly<Record<string, string>> = {
  credit: "kasumi",
  risk: "kasumi",
  assessment: "kasumi",
  customer_relationship: "haru",
  intake: "haru",
  tone: "haru",
  operational_flow: "futaba",
  routing: "futaba",
  sla: "futaba",
  compliance: "makoto",
  regulatory: "makoto",
  audit: "makoto",
  legal_drafting: "akechi",
  enforceability: "akechi",
  recovery: "anne",
  enforcement_strategy: "anne",
  portfolio: "morgana",
  early_warning: "morgana",
  growth: "yusuke",
  design: "yusuke",
  funnel: "yusuke",
  account_tactical: "ryuji",
  strategic: "joker",
  exception: "joker",
  cross_cutting: "joker",
};

export function pickSynthesiser(
  questionDomain: string,
  participants: string[],
): string {
  const primary = DOMAIN_TO_PRIMARY_SYNTHESISER[questionDomain] ?? "joker";
  if (participants.includes(primary)) return primary;
  if (participants.includes("joker")) return "joker";
  return participants[0];
}
