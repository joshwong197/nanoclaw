/**
 * Validator — claim-tag enforcer.
 *
 * Implements the epistemic discipline rule set from TEAM.md.
 * Ported from Midori/prototype/reasoning/validator.py.
 *
 * The validator runs at two checkpoints:
 *   1. When an agent posts a position to the blackboard (catch in-session)
 *   2. At final output boundary (catch synthesis-generated claims)
 *
 * Unsourced claims are redacted. The agent receives a retry prompt. Up to
 * 2 retries before the orchestrator drops the claim and flags to Joker.
 */

import type { Claim, ValidationResult } from "./types.js";
import { VALID_SOURCE_TYPES } from "./types.js";

// ---- heuristics ----

const FIGURE_PATTERNS: readonly RegExp[] = [
  /\$\s?[\d,]+/,                 // dollar amounts
  /\b\d+\.?\d*\s?%/,             // percentages
  /\b\d+\s*(?:cents?|c)\b/,      // cents
  /\b\d+(?:,\d{3})+\b/,          // comma-separated large numbers
];

const PRECEDENT_KEYWORDS: readonly string[] = [
  "last year",
  "prior year",
  "in 2024",
  "in 2025",
  "historically",
  "average",
  "median",
  "benchmark",
  "across our portfolio",
  "recoveries last",
];

export function containsSpecificFigure(text: string): boolean {
  return FIGURE_PATTERNS.some((pat) => pat.test(text));
}

export function containsPrecedentLanguage(text: string): boolean {
  const lower = text.toLowerCase();
  return PRECEDENT_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---- per-claim validation ----

export function validateClaim(
  claim: Claim,
  retrievalCache: ReadonlyMap<string, unknown>,
): { passed: boolean; flags: string[] } {
  const flags: string[] = [];
  const text = claim.text ?? "";
  const source = claim.source ?? "";
  const sourceType = claim.source_type ?? "";

  // 1. source_type must be valid
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    flags.push(`invalid_source_type:${sourceType}`);
    return { passed: false, flags };
  }

  // 2. source key must exist for non-gap, non-inference types
  if (sourceType !== "explicit_gap" && sourceType !== "inference") {
    if (!source) {
      flags.push(`missing_source_key_for_type:${sourceType}`);
      return { passed: false, flags };
    }
  }

  // 3. mempalace/erp/statute sources must match retrieval cache
  if (sourceType === "mempalace" || sourceType === "erp" || sourceType === "statute") {
    if (!retrievalCache.has(source)) {
      flags.push(`claim_cites_unretrieved:${source}`);
      return { passed: false, flags };
    }
    const cached = retrievalCache.get(source);
    if (cached === null || cached === undefined) {
      // Retrieval was attempted but returned empty — you can't cite an empty drawer as fact
      flags.push(`claim_cites_empty_drawer:${source}`);
      return { passed: false, flags };
    }
  }

  // 4. external sources require URL shape AND must be in retrieval cache
  if (sourceType === "external") {
    if (!(source.startsWith("http://") || source.startsWith("https://"))) {
      flags.push("external_source_not_url");
      return { passed: false, flags };
    }
    if (!retrievalCache.has(source) || retrievalCache.get(source) === null) {
      flags.push(`external_unverified:${source}`);
      return { passed: false, flags };
    }
  }

  // 5. inference must carry a basis
  if (sourceType === "inference") {
    const basis = claim.basis ?? "";
    if (!basis) {
      flags.push("inference_without_basis");
      return { passed: false, flags };
    }
  }

  // 6. specific figures in inference claims get WARNED (not blocked)
  if (sourceType === "inference" && containsSpecificFigure(text)) {
    flags.push(`warn:specific_figure_in_inference:${source}`);
    // allowed through with flag — Joker reviews
  }

  // 7. precedent language on inference or explicit_gap claims is suspicious
  if (
    (sourceType === "inference" || sourceType === "explicit_gap") &&
    containsPrecedentLanguage(text)
  ) {
    flags.push(`warn:precedent_language_without_precedent_source:${text.slice(0, 60)}`);
    // allowed through with flag
  }

  return { passed: true, flags };
}

// ---- full position validation ----

export function validatePosition(
  claims: Claim[],
  retrievalCache: ReadonlyMap<string, unknown>,
): ValidationResult {
  const allFlags: string[] = [];
  const redacted: Array<{ claim: Claim; flags: string[] }> = [];
  const validated: Claim[] = [];

  for (const claim of claims) {
    const { passed, flags } = validateClaim(claim, retrievalCache);
    allFlags.push(...flags);
    if (passed) {
      validated.push(claim);
    } else {
      redacted.push({ claim, flags });
    }
  }

  // Position passes only if there are NO hard redactions. Warnings are tolerated but logged.
  const hardFail =
    allFlags.some((f) => !f.startsWith("warn:")) && redacted.length > 0;

  return {
    passed: !hardFail,
    flags: allFlags,
    redactedClaims: redacted,
    validatedClaims: validated,
  };
}
