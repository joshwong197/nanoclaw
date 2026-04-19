/**
 * Session — the reasoning orchestrator.
 *
 * Ported from Midori/prototype/reasoning/session.py.
 *
 * Lifecycle per multi-agent-reasoning-001.md §4.2:
 *   1. SESSION_CREATE
 *   2. RETRIEVAL_GATE (mandatory)
 *   3. POSITION_ROUND (concurrent in GWT, sequential in Debate)
 *   4. VALIDATOR_PASS (runs on every post + final)
 *   5. SCORE_AND_SYNTHESISE (Free-MAD, score-based)
 *   6. DISSENT_CHECK
 *   7. JOKER_GATE
 *   8. OUTPUT + TRACE
 */

import { Blackboard, newSession } from "./blackboard.js";
import { validatePosition } from "./validator.js";
import { pickSynthesiser, scorePosition } from "./synthesis.js";
import type {
  OverrideEvent,
  Position,
  PositionScore,
  RetrievalResult,
  SessionMode,
  Synthesis,
} from "./types.js";

export interface AgentRuntime {
  name: string;
  card: import("./types.js").AgentCard;
  runRetrieval(blackboard: Blackboard): RetrievalResult[] | Promise<RetrievalResult[]>;
  runCouncilRound(
    blackboard: Blackboard,
    roundNum: number,
  ): Position | Promise<Position>;
}

export type DissentThreshold = [number, number]; // [K agents, conviction]

export interface SessionOptions {
  question: string;
  questionDomain: string;
  participants: AgentRuntime[];
  mode?: SessionMode;
  maxRounds?: number;
  dissentThreshold?: DissentThreshold;
}

export class Session {
  readonly blackboard: Blackboard;
  readonly questionDomain: string;
  readonly participants: Map<string, AgentRuntime>;
  readonly maxRounds: number;
  readonly dissentThreshold: DissentThreshold;
  readonly log: string[] = [];

  constructor(opts: SessionOptions) {
    const {
      question,
      questionDomain,
      participants,
      mode = "gwt",
      maxRounds = 3,
      dissentThreshold = [2, 0.7],
    } = opts;

    this.blackboard = newSession(question, mode);
    this.questionDomain = questionDomain;
    this.participants = new Map(participants.map((p) => [p.name, p]));
    this.maxRounds = maxRounds;
    this.dissentThreshold = dissentThreshold;

    for (const p of participants) {
      this.blackboard.join(p.name);
    }

    this.blackboard.synthesisAuthority = pickSynthesiser(
      questionDomain,
      Array.from(this.participants.keys()),
    );
  }

  // ---- logging helper ----

  private _log(msg: string): void {
    this.log.push(msg);
  }

  // ---- phase 1: retrieval gate ----

  async runRetrievalGate(): Promise<void> {
    this.blackboard.advance("retrieval");
    this._log("=== RETRIEVAL GATE ===");
    for (const [name, agent] of this.participants) {
      const manifest = await agent.runRetrieval(this.blackboard);
      const hits = manifest.filter((m) => (m.hits ?? 0) > 0).length;
      const gaps = manifest.filter((m) => (m.hits ?? 0) === 0).length;
      this._log(`  ${name}: ${hits} hits, ${gaps} explicit gaps`);
    }
  }

  // ---- phase 2: positions + validation ----

  async runPositionRound(roundNum: number = 1): Promise<void> {
    this.blackboard.advance("position");
    this._log(`=== POSITION ROUND ${roundNum} ===`);

    for (const [name, agent] of this.participants) {
      if (!this.blackboard.hasRetrieved(name)) {
        this._log(`  ${name}: SKIPPED (no retrieval manifest)`);
        continue;
      }

      const position = await agent.runCouncilRound(this.blackboard, roundNum);

      const validation = validatePosition(
        position.claims,
        this.blackboard.retrievalCache,
      );
      position.validatorFlags = validation.flags;
      if (validation.passed) {
        position.validatorStatus = "passed";
        position.claims = validation.validatedClaims;
        this._log(
          `  ${name}: PASSED (${position.claims.length} claims, confidence ${position.confidence.toFixed(2)})`,
        );
      } else {
        position.validatorStatus = "redacted";
        this._log(
          `  ${name}: REDACTED (${validation.redactedClaims.length} claims, flags: ${JSON.stringify(validation.flags)})`,
        );
      }

      this.blackboard.postPosition(position);
    }
  }

  // ---- phase 3: dissent check ----

  checkDissent(): boolean {
    const [kRequired, conviction] = this.dissentThreshold;
    const dissenting = this.blackboard.dissentCountWithConviction(conviction);
    if (dissenting >= kRequired) {
      this._log(
        `  DISSENT THRESHOLD MET: ${dissenting} agents at conviction >=${conviction}`,
      );
      return true;
    }
    return false;
  }

  // ---- phase 4: score + synthesise ----

  runSynthesis(): Synthesis {
    this.blackboard.advance("synthesis");
    this._log("=== SCORE + SYNTHESISE ===");

    const synthesiserName = this.blackboard.synthesisAuthority;
    let synthesiserAgent = this.participants.get(synthesiserName);
    if (!synthesiserAgent) {
      synthesiserAgent =
        this.participants.get("joker") ??
        this.participants.values().next().value;
      if (!synthesiserAgent) {
        throw new Error("No participants available to synthesise");
      }
      this.blackboard.synthesisAuthority = synthesiserAgent.name;
    }

    const validatedPositions = this.blackboard.validatedPositions();

    const scores: PositionScore[] = [];
    for (const pos of validatedPositions) {
      const score = scorePosition(pos, synthesiserAgent.card, this.questionDomain);
      pos.score = score.total;
      scores.push(score);
      this._log(
        `  ${pos.agent}: score=${score.total.toFixed(3)} (align=${score.alignment.toFixed(2)}, evidence=${score.evidenceQuality.toFixed(2)}, honesty=${score.epistemicHonesty.toFixed(2)})`,
      );
    }

    scores.sort((a, b) => b.total - a.total);

    const topScorer = scores.length > 0 ? scores[0].positionAgent : null;
    const topScore = scores.length > 0 ? scores[0].total : 0.0;

    const synthesis: Synthesis = {
      by: synthesiserAgent.name,
      topScorer,
      topScore,
      call: `[Synthesis by ${synthesiserAgent.name}, led by ${topScorer ?? "none"}'s position]`,
      allScores: scores,
      actionItems: [
        "Action items emerge from the top-scoring position(s) + dissent integration",
      ],
    };

    this.blackboard.synthesis = synthesis;
    return synthesis;
  }

  // ---- phase 5: Joker gate + output ----

  jokerGate(override: OverrideEvent | null = null): void {
    this._log("=== JOKER GATE ===");
    if (override) {
      this.blackboard.recordOverride(override);
      this._log(`  Joker applied override: ${override.reasoning.slice(0, 80)}`);
    } else {
      this._log("  Joker accepts synthesis as drafted");
    }
  }

  finalise(outputText: string): void {
    this.blackboard.finalOutput = outputText;
    this.blackboard.advance("shipped");
    this._log("=== SHIPPED ===");
  }

  // ---- full run ----

  async run(outputText: string = ""): Promise<void> {
    await this.runRetrievalGate();
    for (let r = 1; r <= this.maxRounds; r++) {
      await this.runPositionRound(r);
      if (r === 1) {
        // Single round for GWT default; debate mode may continue
        break;
      }
    }
    if (this.checkDissent()) {
      // Would route to Joker human escalation path
    }
    this.runSynthesis();
    this.jokerGate();
    this.finalise(outputText || this.blackboard.synthesis?.call || "");
  }
}
