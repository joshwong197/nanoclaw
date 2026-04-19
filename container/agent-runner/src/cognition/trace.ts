/**
 * Trace composition — public thread + master + per-agent private.
 *
 * Ported from Midori/prototype/reasoning/trace.py.
 *
 * Three layered artifacts per session:
 *   1. Public thread — the narrative to humans
 *   2. Master trace — full record (structured, auditable)
 *   3. Per-agent private — linked via session_ref
 */

import { writeFile } from "node:fs/promises";

import type { Blackboard } from "./blackboard.js";
import type { Claim } from "./types.js";

export function composePublicThread(bb: Blackboard): string {
  const lines: string[] = [];
  lines.push(`=== SESSION ${bb.sessionId} ===`);
  lines.push(`Question: ${bb.question}`);
  lines.push(`Mode: ${bb.mode.toUpperCase()}`);
  lines.push(`Participants: ${bb.participants.join(", ")}`);
  lines.push(`Synthesis authority: ${bb.synthesisAuthority}`);
  lines.push("");

  // Retrieval summary
  lines.push("--- Retrieval Gate ---");
  for (const [agent, manifest] of bb.retrievalManifests) {
    const hits = manifest.filter((m) => (m.hits ?? 0) > 0).length;
    const gaps = manifest.filter((m) => (m.hits ?? 0) === 0).length;
    lines.push(
      `  ${agent}: ${hits} hits, ${gaps} explicit gaps across ${manifest.length} queries`,
    );
  }
  lines.push("");

  // Positions
  lines.push("--- Positions ---");
  for (const pos of bb.positions) {
    const statusMarker = pos.validatorStatus === "passed" ? "PASS" : "REDACTED";
    lines.push(
      `  [${statusMarker}] ${pos.agent} (round ${pos.round}, confidence ${pos.confidence.toFixed(2)})`,
    );
    lines.push(`    Rationale: ${pos.rationale}`);
    const taggedSummary = summariseTags(pos.claims);
    lines.push(`    Claims: ${taggedSummary}`);
    if (pos.validatorFlags && pos.validatorFlags.length > 0) {
      lines.push(`    Flags: ${JSON.stringify(pos.validatorFlags)}`);
    }
    lines.push("");
  }

  // Dissent
  if (bb.dissentLog.length > 0) {
    lines.push("--- Dissent ---");
    for (const d of bb.dissentLog) {
      lines.push(
        `  ${d.agent} dissents from ${d.dissentFrom} (round ${d.round}): ${d.reason}`,
      );
    }
    lines.push("");
  }

  // Overrides
  if (bb.overrideEvents.length > 0) {
    lines.push("--- Overrides ---");
    for (const ov of bb.overrideEvents) {
      lines.push(
        `  [${ov.overrideId}] ${ov.overridingParty} overrode ${ov.overriddenPosition.agent}`,
      );
      lines.push(`    Reasoning: ${ov.reasoning}`);
      if (ov.riskFlag) {
        lines.push(
          `    Risk flag from ${ov.acknowledgementAgent ?? ""}: ${ov.riskFlag}`,
        );
      }
    }
    lines.push("");
  }

  // Synthesis
  if (bb.synthesis) {
    lines.push("--- Synthesis ---");
    lines.push(`  By: ${bb.synthesis.by}`);
    lines.push(`  Call: ${bb.synthesis.call}`);
    lines.push(`  Action items:`);
    for (const item of bb.synthesis.actionItems) {
      lines.push(`    - ${item}`);
    }
    lines.push("");
  }

  lines.push(`--- Final Output ---`);
  lines.push(bb.finalOutput);
  return lines.join("\n");
}

function summariseTags(claims: Claim[]): string {
  if (claims.length === 0) return "(none)";
  const counts: Record<string, number> = {};
  for (const c of claims) {
    const st = c.source_type ?? "untagged";
    counts[st] = (counts[st] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");
}

export interface MasterTrace {
  session_id: string;
  question: string;
  mode: string;
  status: string;
  created_at: string;
  participants: string[];
  synthesis_authority: string;
  retrieval_manifests: Record<string, unknown>;
  positions: Array<Record<string, unknown>>;
  dissent_log: unknown[];
  override_events: Array<Record<string, unknown>>;
  synthesis: unknown;
  final_output: string;
}

export function composeMasterTrace(bb: Blackboard): MasterTrace {
  const retrievalManifests: Record<string, unknown> = {};
  for (const [agent, manifest] of bb.retrievalManifests) {
    retrievalManifests[agent] = manifest;
  }

  return {
    session_id: bb.sessionId,
    question: bb.question,
    mode: bb.mode,
    status: bb.status,
    created_at: bb.createdAt,
    participants: bb.participants,
    synthesis_authority: bb.synthesisAuthority,
    retrieval_manifests: retrievalManifests,
    positions: bb.positions.map((p) => ({
      agent: p.agent,
      round: p.round,
      timestamp: p.timestamp,
      rationale: p.rationale,
      confidence: p.confidence,
      claims: p.claims,
      dissent_from: p.dissentFrom,
      validator_status: p.validatorStatus,
      validator_flags: p.validatorFlags,
      score: p.score,
    })),
    dissent_log: bb.dissentLog,
    override_events: bb.overrideEvents.map((ov) => ({
      override_id: ov.overrideId,
      overriding_party: ov.overridingParty,
      overridden_position: ov.overriddenPosition,
      reasoning: ov.reasoning,
      acknowledgement_agent: ov.acknowledgementAgent,
      acknowledgement_response: ov.acknowledgementResponse,
      risk_flag: ov.riskFlag,
      timestamp: ov.timestamp,
    })),
    synthesis: bb.synthesis,
    final_output: bb.finalOutput,
  };
}

export async function saveTrace(bb: Blackboard, path: string): Promise<void> {
  const trace = composeMasterTrace(bb);
  await writeFile(path, JSON.stringify(trace, null, 2), { encoding: "utf-8" });
}
