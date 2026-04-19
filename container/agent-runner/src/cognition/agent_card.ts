/**
 * Agent Card — A2A-compatible envelope wrapping a Thief's genome.
 *
 * Ported from Midori/prototype/reasoning/agent_card.py.
 * Mirrors the A2A Protocol v1.0 Agent Card schema for future interoperability
 * with external agents.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentCard, Genome } from "./types.js";

// ---- role → synthesis-domain map (from multi-agent-reasoning-001.md §5.3) ----

const ROLE_SYNTHESIS_DOMAINS: Record<string, string[]> = {
  chief_executive: ["strategic", "exception", "cross_cutting"],
  orchestrator: ["operational_flow", "routing", "sla"],
  receptionist: ["customer_relationship", "intake", "tone"],
  growth_lead: ["growth", "design", "funnel"],
  credit_analyst: ["credit", "risk", "assessment"],
  account_manager: ["account_tactical", "collections_early"],
  portfolio_monitor: ["portfolio", "early_warning"],
  recovery_specialist: ["recovery", "enforcement_strategy"],
  compliance_officer: ["compliance", "regulatory", "audit"],
  legal_counsel: ["legal_drafting", "enforceability"],
};

const ROLE_RETRIEVAL_NAMESPACES: Record<string, string[]> = {
  chief_executive: ["*"],
  orchestrator: ["workflow", "sla", "routing"],
  receptionist: ["intake", "customer_profile"],
  growth_lead: ["funnel", "ab_tests", "portal"],
  credit_analyst: ["credit-framework", "bureau", "precedent-assessments"],
  account_manager: ["accounts", "communications", "payment-plans"],
  portfolio_monitor: ["portfolio", "indicators", "baselines"],
  recovery_specialist: ["recovery-precedents", "statutes", "demand-templates"],
  compliance_officer: ["policies", "audit-log", "privacy-act"],
  legal_counsel: ["contracts", "statutes", "precedent-legal"],
};

// ---- loader ----

export async function loadAgentCard(genomePath: string): Promise<AgentCard> {
  const text = await readFile(genomePath, "utf-8");
  const genome = JSON.parse(text) as Genome;

  const name = genome.agent;
  const codename = genome.codename ?? name;
  const displayName = `${genome.given_name ?? capitalize(name)} (${codename})`;
  const role = genome.role ?? "";

  return {
    name,
    displayName,
    description: `${codename} — ${role}`,
    role,
    genome,
    capabilities: ["concurrent", "sequential", "retrieval", "council_round"],
    synthesisDomains: ROLE_SYNTHESIS_DOMAINS[role] ?? [],
    retrievalNamespaces: ROLE_RETRIEVAL_NAMESPACES[role] ?? [],
    redLinesInherited: genome.red_lines_inherited ?? "TEAM.md",
    version: genome.version ?? "001",
  };
}

export async function loadTeam(genomesDir: string): Promise<Map<string, AgentCard>> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(genomesDir, { withFileTypes: true });
  const team = new Map<string, AgentCard>();

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const genomeFile = path.join(genomesDir, entry.name, "001.json");
    try {
      const card = await loadAgentCard(genomeFile);
      team.set(card.name, card);
    } catch (err) {
      // Skip agents without a valid genome file
      console.warn(`Skipping ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return team;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- trait-derived helpers ----

export function agentCardTraits(card: AgentCard) {
  return card.genome.traits;
}

export function agentCardCouncilWeights(card: AgentCard) {
  return card.genome.council_weights;
}

export function agentCardDirectors(card: AgentCard): string[] {
  return card.genome.directors.primary ?? [];
}

export function agentCardEmotionalBaseline(card: AgentCard) {
  return card.genome.emotional_baseline;
}
