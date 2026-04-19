/**
 * Blackboard — shared workspace for multi-agent reasoning sessions.
 *
 * Ported from Midori/prototype/reasoning/blackboard.py.
 * GWT-inspired shared-state primitive. Agents read from and write to the
 * blackboard; the session orchestrator coordinates access.
 */

import { randomUUID } from "node:crypto";

import type {
  DissentEntry,
  OverrideEvent,
  Position,
  RetrievalResult,
  SessionMode,
  SessionStatus,
  Synthesis,
} from "./types.js";

function utcnow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export class Blackboard {
  readonly sessionId: string;
  readonly question: string;
  readonly mode: SessionMode;
  readonly createdAt: string;

  participants: string[] = [];
  synthesisAuthority: string = "";
  retrievalManifests: Map<string, RetrievalResult[]> = new Map();
  retrievalCache: Map<string, unknown> = new Map();
  positions: Position[] = [];
  dissentLog: DissentEntry[] = [];
  overrideEvents: OverrideEvent[] = [];
  synthesis: Synthesis | null = null;
  finalOutput: string = "";
  status: SessionStatus = "created";

  constructor(sessionId: string, question: string, mode: SessionMode = "gwt") {
    this.sessionId = sessionId;
    this.question = question;
    this.mode = mode;
    this.createdAt = utcnow();
  }

  // ---- participants ----

  join(agentName: string): void {
    if (!this.participants.includes(agentName)) {
      this.participants.push(agentName);
    }
  }

  // ---- retrieval gate ----

  postRetrievalManifest(agent: string, manifest: RetrievalResult[]): void {
    this.retrievalManifests.set(agent, manifest);
    for (const entry of manifest) {
      if (entry.source && !this.retrievalCache.has(entry.source)) {
        // In prototype/test mode we cache the result here. In production,
        // retrieval is live via MCP and results flow through here too.
        this.retrievalCache.set(entry.source, entry.result);
      }
    }
  }

  hasRetrieved(agent: string): boolean {
    return this.retrievalManifests.has(agent);
  }

  retrievalContains(sourceKey: string): boolean {
    return this.retrievalCache.has(sourceKey);
  }

  // ---- positions ----

  postPosition(position: Position): void {
    this.positions.push(position);
  }

  positionsByAgent(agent: string): Position[] {
    return this.positions.filter((p) => p.agent === agent);
  }

  validatedPositions(): Position[] {
    return this.positions.filter((p) => p.validatorStatus === "passed");
  }

  // ---- dissent ----

  logDissent(dissentingAgent: string, fromPosition: Position, reason: string): void {
    this.dissentLog.push({
      agent: dissentingAgent,
      dissentFrom: fromPosition.agent,
      round: fromPosition.round,
      reason,
      timestamp: utcnow(),
    });
  }

  dissentCountWithConviction(threshold: number = 0.7): number {
    const dissentingAgents = new Set(this.dissentLog.map((d) => d.agent));
    let convicted = 0;
    for (const agent of dissentingAgents) {
      const agentPositions = this.positions.filter((p) => p.agent === agent);
      if (agentPositions.length === 0) continue;
      const maxConfidence = Math.max(...agentPositions.map((p) => p.confidence));
      if (maxConfidence >= threshold) convicted += 1;
    }
    return convicted;
  }

  // ---- overrides ----

  recordOverride(event: OverrideEvent): void {
    this.overrideEvents.push(event);
  }

  // ---- status ----

  advance(newStatus: SessionStatus): void {
    this.status = newStatus;
  }
}

export function newSession(question: string, mode: SessionMode = "gwt"): Blackboard {
  const sessionId = `SESSION-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  return new Blackboard(sessionId, question, mode);
}
