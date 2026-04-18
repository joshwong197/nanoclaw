/**
 * LiveAgent — Claude-backed implementation of AgentRuntime.
 *
 * Replaces the Python MockAgent. This is the "live Claude swap point":
 * runCouncilRound() calls Claude via the Claude Agent SDK already imported
 * by ../index.ts. Credentials flow through the OneCLI credential proxy via
 * ANTHROPIC_BASE_URL — this module does NOT read API keys and does NOT
 * change the credential model.
 *
 * Guarantees:
 *   - Epistemic discipline: returned claims are validated against the
 *     blackboard's retrieval cache (validator.ts). On failure we retry up to
 *     twice (once for parse, once for validator). Second failure returns a
 *     Position with only the validated claims + an explicit_gap noting the
 *     runtime redaction.
 *   - Joker's private_shadow field (any key beginning with "private_shadow"
 *     or "_private_shadow", at the top level of the genome) is stripped
 *     BEFORE prompt construction. It is never logged, never sent to the
 *     model, never written to the palace.
 *   - No prompt bodies (which contain SOUL + genome) are logged to stdout.
 */

import { readFile } from "node:fs/promises";

import { query } from "@anthropic-ai/claude-agent-sdk";

import type { Blackboard } from "./blackboard.js";
import { runRetrievalManifest } from "./retrieval.js";
import { validatePosition } from "./validator.js";
import type {
  AgentCard,
  Claim,
  Genome,
  Position,
  RetrievalResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal Claude client surface. Defaults to the SDK's `query()` stream.
 * Tests can inject their own implementation — it just needs to return the
 * final assistant text for a given system + user prompt pair.
 */
export interface ClaudeClient {
  complete(args: { system: string; user: string }): Promise<string>;
}

interface RawPositionPayload {
  rationale?: unknown;
  claims?: unknown;
  confidence?: unknown;
  dissent_from?: unknown;
  dissentFrom?: unknown;
}

// ---------------------------------------------------------------------------
// Default Claude client (uses the SDK `query()` already imported by index.ts)
// ---------------------------------------------------------------------------

function defaultClaudeClient(): ClaudeClient {
  return {
    async complete({ system, user }) {
      // NOTE: Do not log `system` or `user` — they contain SOUL + genome.
      let out = "";
      for await (const message of query({
        prompt: user,
        options: {
          // Non-interactive, minimal-context single turn. We want just a
          // structured JSON reply — no tools, no CLAUDE.md preset.
          systemPrompt: system,
          allowedTools: [],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          settingSources: [],
        },
      })) {
        if (message.type === "assistant") {
          const content = (message as { message?: { content?: unknown } }).message?.content;
          if (Array.isArray(content)) {
            for (const block of content as Array<{ type?: string; text?: string }>) {
              if (block?.type === "text" && typeof block.text === "string") {
                out += block.text;
              }
            }
          }
        } else if (message.type === "result") {
          const result = (message as { result?: string }).result;
          if (typeof result === "string" && result.length > out.length) {
            out = result;
          }
        }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Genome sanitisation (private_shadow filter)
// ---------------------------------------------------------------------------

/**
 * Strip any top-level genome key that is, or begins with, "private_shadow"
 * or "_private_shadow". This is the single code point that guarantees the
 * private layer never enters a prompt, never lands in a log, never leaves
 * Joker's runtime context.
 *
 * Exported for the test harness; do not use it elsewhere.
 */
export function stripPrivateShadow(genome: Genome): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(genome)) {
    const lk = k.toLowerCase();
    if (lk === "private_shadow" || lk === "_private_shadow") continue;
    if (lk.startsWith("private_shadow") || lk.startsWith("_private_shadow")) continue;
    clean[k] = v;
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function utcnow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function tryReadFile(p: string | undefined): Promise<string> {
  if (!p) return Promise.resolve("");
  return readFile(p, "utf-8").catch(() => "");
}

/**
 * Extract the first complete JSON object from a string. Handles cases where
 * the model has wrapped the JSON in prose or code fences.
 */
function extractJsonObject(text: string): string | null {
  // Code-fence form first
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

function parsePositionPayload(text: string): RawPositionPayload | null {
  const block = extractJsonObject(text);
  if (!block) return null;
  try {
    return JSON.parse(block) as RawPositionPayload;
  } catch {
    return null;
  }
}

function coerceClaim(raw: unknown): Claim | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text : null;
  const sourceType = typeof r.source_type === "string" ? r.source_type : null;
  const source = typeof r.source === "string" ? r.source : "";
  if (!text || !sourceType) return null;
  const claim: Claim = { text, source_type: sourceType, source };
  if (typeof r.basis === "string") claim.basis = r.basis;
  return claim;
}

function coerceClaims(raw: unknown): Claim[] {
  if (!Array.isArray(raw)) return [];
  const out: Claim[] = [];
  for (const item of raw) {
    const c = coerceClaim(item);
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LiveAgent
// ---------------------------------------------------------------------------

export interface LiveAgentOptions {
  card: AgentCard;
  soulPath: string;
  skillsPath: string;
  genomePath: string;
  /** Optional Claude client override for testing. */
  claudeClient?: ClaudeClient;
}

export class LiveAgent {
  readonly card: AgentCard;
  readonly soulPath: string;
  readonly skillsPath: string;
  readonly genomePath: string;
  private readonly client: ClaudeClient;

  private soulCache: string | null = null;
  private skillsCache: string | null = null;
  private genomeJsonCache: string | null = null;

  constructor(opts: LiveAgentOptions) {
    this.card = opts.card;
    this.soulPath = opts.soulPath;
    this.skillsPath = opts.skillsPath;
    this.genomePath = opts.genomePath;
    this.client = opts.claudeClient ?? defaultClaudeClient();
  }

  get name(): string {
    return this.card.name;
  }

  // ---- retrieval ----

  async runRetrieval(blackboard: Blackboard): Promise<RetrievalResult[]> {
    const keywords = blackboard.question.toLowerCase().split(/\s+/).filter(Boolean);
    const results = runRetrievalManifest(this.card.role, keywords);
    blackboard.postRetrievalManifest(this.card.name, results);
    return results;
  }

  // ---- council round (the live Claude call) ----

  async runCouncilRound(blackboard: Blackboard, roundNum: number = 1): Promise<Position> {
    const manifest = blackboard.retrievalManifests.get(this.card.name) ?? [];

    const system = await this.buildSystemPrompt();
    const baseUser = this.buildUserPrompt(blackboard, manifest, roundNum);

    // First attempt.
    let rawText = await this.client.complete({ system, user: baseUser });
    let payload = parsePositionPayload(rawText);

    // Retry #1: parse failure → ask for JSON only.
    if (!payload) {
      const retryUser =
        baseUser +
        "\n\n---\nYour previous response was not valid JSON. Respond with ONLY the JSON object matching the schema — no prose, no code fences.";
      rawText = await this.client.complete({ system, user: retryUser });
      payload = parsePositionPayload(rawText);
    }

    // If still no payload, return a minimal redaction Position.
    if (!payload) {
      return this.buildRedactionPosition(
        manifest,
        roundNum,
        [],
        1,
        "model_returned_unparseable_output_after_retry",
      );
    }

    let claims = coerceClaims(payload.claims);
    const rationale = typeof payload.rationale === "string" ? payload.rationale : "";
    const confidence =
      typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
        ? Math.max(0, Math.min(1, payload.confidence))
        : 0.5;
    const dissentFromRaw = payload.dissent_from ?? payload.dissentFrom;
    const dissentFrom = Array.isArray(dissentFromRaw)
      ? dissentFromRaw.filter((x): x is string => typeof x === "string")
      : [];

    // Validate.
    let validation = validatePosition(claims, blackboard.retrievalCache);

    // Retry #2: validator rejected → ask the model to revise.
    if (!validation.passed) {
      const flagList = validation.flags.join("\n - ");
      const revisionUser =
        baseUser +
        "\n\n---\nYour previous response had claims that failed epistemic validation. Flags:\n - " +
        flagList +
        "\n\nRevise the flagged claims: either add a valid source tag from the retrieval manifest, or convert them to source_type=\"inference\" with a basis, or source_type=\"explicit_gap\" if the information was not retrieved. Respond with ONLY the corrected JSON object.";
      const revisedText = await this.client.complete({ system, user: revisionUser });
      const revisedPayload = parsePositionPayload(revisedText);
      if (revisedPayload) {
        const revisedClaims = coerceClaims(revisedPayload.claims);
        const revisedValidation = validatePosition(revisedClaims, blackboard.retrievalCache);
        if (revisedValidation.passed) {
          claims = revisedClaims;
          validation = revisedValidation;
        } else {
          // Second failure: keep only the validated subset of the revised attempt,
          // then append an explicit_gap capturing the redaction count.
          return this.buildRedactionPosition(
            manifest,
            roundNum,
            revisedValidation.validatedClaims,
            revisedValidation.redactedClaims.length,
            `validator_rejected_on_retry: ${revisedValidation.flags.join(",")}`,
            rationale,
            confidence,
            dissentFrom,
          );
        }
      } else {
        // Revision returned unparseable JSON. Fall back to validated subset of round-1.
        return this.buildRedactionPosition(
          manifest,
          roundNum,
          validation.validatedClaims,
          validation.redactedClaims.length,
          "revision_unparseable_after_validator_reject",
          rationale,
          confidence,
          dissentFrom,
        );
      }
    }

    const position: Position = {
      agent: this.card.name,
      round: roundNum,
      timestamp: utcnow(),
      retrievalManifest: manifest,
      claims,
      rationale,
      confidence,
      dissentFrom,
      councilTraceRef: `trace://${this.card.name}/round-${roundNum}`,
    };
    return position;
  }

  // ---- prompt construction ----

  private async buildSystemPrompt(): Promise<string> {
    if (this.soulCache === null) this.soulCache = await tryReadFile(this.soulPath);
    if (this.skillsCache === null) this.skillsCache = await tryReadFile(this.skillsPath);
    if (this.genomeJsonCache === null) {
      const raw = await tryReadFile(this.genomePath);
      let parsed: Genome | null = null;
      try {
        parsed = raw ? (JSON.parse(raw) as Genome) : null;
      } catch {
        parsed = null;
      }
      // Always strip from the on-disk genome; the card's genome is also filtered.
      const source: Genome = parsed ?? this.card.genome;
      const stripped = stripPrivateShadow(source);
      this.genomeJsonCache = JSON.stringify(stripped, null, 2);
    }

    const soul = this.soulCache ?? "";
    const skills = this.skillsCache ?? "";
    const genomeJson = this.genomeJsonCache ?? "{}";

    return [
      `You are ${this.card.displayName}, role: ${this.card.role}.`,
      "",
      "--- SOUL ---",
      soul,
      "",
      "--- SKILLS ---",
      skills,
      "",
      "--- GENOME (JSON) ---",
      genomeJson,
      "",
      "--- EPISTEMIC DISCIPLINE (NON-NEGOTIABLE) ---",
      "Every factual claim you make MUST carry a source_type from this set:",
      "  mempalace | erp | statute | external | inference | explicit_gap",
      "Rules:",
      "  - mempalace/erp/statute/external claims MUST cite a source key that appears in the retrieval manifest below. Do not invent sources.",
      "  - external claims require a URL (http:// or https://) that was retrieved.",
      "  - inference claims MUST include a `basis` field explaining the reasoning chain.",
      "  - If you do not know something, use source_type=\"explicit_gap\" with a source describing what was searched and came up empty.",
      "  - Never fabricate figures, precedents, or statute text.",
      "  - A claim without a valid source tag will be redacted and you will be asked to retry. A second failure results in runtime redaction.",
      "",
      "Respond with a single JSON object, no prose, matching this schema:",
      "{",
      '  "rationale": string,',
      '  "claims": [ { "text": string, "source_type": string, "source": string, "basis"?: string } ],',
      '  "confidence": number between 0 and 1,',
      '  "dissent_from": string[]   // names of other agents you explicitly disagree with, or []',
      "}",
    ].join("\n");
  }

  private buildUserPrompt(
    blackboard: Blackboard,
    manifest: RetrievalResult[],
    roundNum: number,
  ): string {
    const sections: string[] = [];
    sections.push("--- SESSION QUESTION ---");
    sections.push(blackboard.question);
    sections.push("");
    sections.push("--- RETRIEVAL MANIFEST (your citable sources) ---");
    sections.push(JSON.stringify(manifest, null, 2));
    sections.push("");

    if (roundNum > 1) {
      const priorPositions = blackboard.positions.filter((p) => p.agent !== this.card.name);
      if (priorPositions.length > 0) {
        sections.push(`--- OTHER AGENTS' POSITIONS (round ${roundNum - 1}) ---`);
        const brief = priorPositions.map((p) => ({
          agent: p.agent,
          round: p.round,
          rationale: p.rationale,
          claims: p.claims,
          confidence: p.confidence,
        }));
        sections.push(JSON.stringify(brief, null, 2));
        sections.push("");
      }
    }

    sections.push(`--- YOUR TASK ---`);
    sections.push(
      `Produce your council-round-${roundNum} position as a JSON object matching the schema in the system prompt. ` +
        `Base every factual claim on an entry in the retrieval manifest, or tag it as inference (with basis) or explicit_gap. ` +
        `Respond with ONLY the JSON object.`,
    );
    return sections.join("\n");
  }

  private buildRedactionPosition(
    manifest: RetrievalResult[],
    roundNum: number,
    validatedClaims: Claim[],
    redactedCount: number,
    reason: string,
    rationale: string = "",
    confidence: number = 0.1,
    dissentFrom: string[] = [],
  ): Position {
    const gapClaim: Claim = {
      text: `runtime_validator_redaction: ${redactedCount} claim(s) removed (${reason})`,
      source_type: "explicit_gap",
      source: `runtime://validator/${this.card.name}/round-${roundNum}`,
    };
    return {
      agent: this.card.name,
      round: roundNum,
      timestamp: utcnow(),
      retrievalManifest: manifest,
      claims: [...validatedClaims, gapClaim],
      rationale:
        rationale ||
        `Position finalised after runtime validator redaction (${redactedCount} claim(s) removed).`,
      confidence,
      dissentFrom,
      councilTraceRef: `trace://${this.card.name}/round-${roundNum}`,
    };
  }
}
