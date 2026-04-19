/**
 * Shared types for the multi-agent reasoning layer.
 *
 * Mirrors the schemas specified in Midori/multi-agent-reasoning-001.md §4.
 * Ported from Midori/prototype/reasoning/ (Python prototype).
 */

// ============================================================================
// Agent Card (A2A-compatible envelope)
// ============================================================================

export interface GenomeTraits {
  rigour: number;
  pace: number;
  warmth: number;
  assertiveness: number;
  risk_appetite: number;
  openness: number;
  empathy: number;
  pride: number;
  persistence: number;
  loyalty: number;
  discipline: number;
  courage: number;
}

export interface CouncilWeights {
  cortex: number;
  seer: number;
  oracle: number;
  house: number;
  prudence: number;
  hypothalamus: number;
  amygdala: number;
  conscience: number;
}

export interface DirectorConfig {
  primary: string[];
  default: string;
  rules?: Record<string, string>;
}

export interface EmotionalBaseline {
  valence: number;
  arousal: number;
  focus: number;
  decay_seconds?: number;
}

export interface Genome {
  agent: string;
  codename: string;
  given_name?: string;
  arcana: string;
  role: string;
  version: string;
  locked_at?: string;
  genome_schema_version: string;
  traits: GenomeTraits;
  council_weights: CouncilWeights;
  directors: DirectorConfig;
  emotional_baseline: EmotionalBaseline;
  emotional_triggers?: unknown[];
  relationships?: unknown;
  mask?: unknown;
  shadow?: unknown;
  red_lines_inherited?: string;
  [key: string]: unknown; // allow additional fields (e.g. private_shadow for Joker)
}

export interface AgentCard {
  name: string;             // e.g. "kasumi_violet"
  displayName: string;      // e.g. "Kasumi Yoshizawa (Violet)"
  description: string;
  role: string;
  genome: Genome;
  capabilities: string[];
  synthesisDomains: string[];
  retrievalNamespaces: string[];
  redLinesInherited: string;
  version: string;
}

// ============================================================================
// Claim Tagging (epistemic discipline — the load-bearing piece)
// ============================================================================

export type SourceType =
  | "mempalace"
  | "erp"
  | "statute"
  | "external"
  | "inference"
  | "explicit_gap";

export interface Claim {
  text: string;
  source_type: SourceType | string; // string for invalid types caught by validator
  source: string;
  basis?: string; // required when source_type === "inference"
}

export const VALID_SOURCE_TYPES: ReadonlySet<string> = new Set<SourceType>([
  "mempalace",
  "erp",
  "statute",
  "external",
  "inference",
  "explicit_gap",
]);

// ============================================================================
// Retrieval
// ============================================================================

export interface RetrievalResult {
  source: string;
  source_type: SourceType;
  result: unknown | null; // null = explicit gap (retrieval returned nothing)
  hits: number;
}

// ============================================================================
// Blackboard — shared workspace
// ============================================================================

export type SessionMode = "gwt" | "debate";

export type SessionStatus =
  | "created"
  | "retrieval"
  | "position"
  | "synthesis"
  | "shipped";

export type ValidatorStatus = "pending" | "passed" | "redacted" | "retry";

export interface Position {
  agent: string;
  round: number;
  timestamp: string;
  retrievalManifest: RetrievalResult[];
  claims: Claim[];
  rationale: string;
  confidence: number;
  dissentFrom: string[];
  councilTraceRef: string;
  validatorStatus?: ValidatorStatus;
  validatorFlags?: string[];
  score?: number;
}

export interface DissentEntry {
  agent: string;
  dissentFrom: string;
  round: number;
  reason: string;
  timestamp: string;
}

export interface OverrideEvent {
  overrideId: string;
  overridingParty: string;
  overriddenPosition: {
    agent: string;
    round: number;
    claim: string;
  };
  reasoning: string;
  acknowledgementAgent?: string;
  acknowledgementResponse?: string;
  riskFlag?: string;
  timestamp: string;
}

export interface Synthesis {
  by: string;
  topScorer: string | null;
  topScore: number;
  call: string;
  allScores: PositionScore[];
  actionItems: string[];
}

// ============================================================================
// Synthesis scoring
// ============================================================================

export interface PositionScore {
  positionAgent: string;
  alignment: number;
  evidenceQuality: number;
  confidence: number;
  breadth: number;
  epistemicHonesty: number;
  total: number;
}

export const SCORE_WEIGHTS = {
  alignment: 0.2,
  evidenceQuality: 0.3,
  confidence: 0.15,
  breadth: 0.1,
  epistemicHonesty: 0.25,
} as const;

// ============================================================================
// Validator
// ============================================================================

export interface ValidationResult {
  passed: boolean;
  flags: string[];
  redactedClaims: Array<{ claim: Claim; flags: string[] }>;
  validatedClaims: Claim[];
}
