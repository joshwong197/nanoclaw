/**
 * Retrieval — pre-reasoning retrieval pass.
 *
 * Ported from Midori/prototype/reasoning/retrieval.py.
 *
 * Stubbed MemPalace + ERP + statute queries. Returns structured manifests
 * that the blackboard caches and the validator references.
 *
 * In production, each function below is intended to call the actual MCP tool
 * (`mcp__mempalace__*`) via the agent runtime. Those tools are exposed to
 * Claude, not invokable directly from this module; the live wiring is
 * deferred to agent.ts (the Claude-API swap point). This module therefore
 * keeps the Python prototype's synchronous in-memory store so session /
 * synthesis ports can run against identical fixtures.
 */

import type { RetrievalResult, SourceType } from "./types.js";

// ---- stubbed data store (mirrors retrieval.py) ----

const STUB_MEMPALACE: Record<string, { content: string; confidence: number } | null> = {
  "mempalace://drawer/credit-framework-principles": {
    content:
      "Our credit framework weights scorecard components: bureau 30%, payment history 25%, financial capacity 20%, trading history 10%, director 10%, application quality 5%.",
    confidence: 1.0,
  },
  "mempalace://drawer/team-decisions-2026-04": {
    content:
      "Team converged on Day 21 handoff from Ryuji to Anne (not Day 30). Bureau inflection data cited.",
    confidence: 1.0,
  },
  "mempalace://drawer/recovery-precedent-mythos": null,
  "mempalace://drawer/pmsi-vs-gsa-historical-recoveries": null,
  "mempalace://drawer/install-trade-fixture-losses": null,
};

const STUB_STATUTES: Record<string, { content: string }> = {
  "ppsa.1999/s36": {
    content:
      "A security agreement is enforceable against the debtor when the security interest has attached and the security agreement is in writing, signed by the debtor, with description of collateral.",
  },
  "ppsa.1999/s66": {
    content: "First-in-time priority rules for registered security interests on PPSR.",
  },
  "ppsa.1999/s70": {
    content: "PMSI extinguishes on accession/fixture where goods become part of other property.",
  },
  "ppsa.1999/s74": {
    content: "PMSI super-priority for goods registered on PPSR before delivery.",
  },
  "ppsa.1999/s107": {
    content: "Parties may contract out of specified Part 9 provisions.",
  },
  "fair_trading_act.1986/s9": {
    content: "Misleading or deceptive conduct in trade is prohibited.",
  },
  "limitation_act.2010/s11": {
    content: "6-year limitation for contract claims; 12-year for deeds.",
  },
  "companies_act.1993/s289": {
    content: "Statutory demand procedure. 15 working days to pay, arrange, or compound.",
  },
};

const STUB_ERP: Record<string, unknown> = {
  "erp://accounts/count_by_tier": {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    WATCH: 0,
    note: "Year one; no active accounts yet.",
  },
  "erp://portfolio/aging": { current: 0, "1-7": 0, "8-14": 0, "15-21": 0, "22+": 0 },
};

// ---- public API ----

function makeResult(
  source: string,
  sourceType: SourceType,
  result: unknown,
): RetrievalResult {
  return {
    source,
    source_type: sourceType,
    result: result ?? null,
    hits: result ? 1 : 0,
  };
}

export function mempalaceSearch(queryKey: string): RetrievalResult {
  const hit = Object.prototype.hasOwnProperty.call(STUB_MEMPALACE, queryKey)
    ? STUB_MEMPALACE[queryKey]
    : undefined;
  return makeResult(queryKey, "mempalace", hit ?? null);
}

export function statuteLookup(statuteKey: string): RetrievalResult {
  const hit = STUB_STATUTES[statuteKey];
  return makeResult(statuteKey, "statute", hit ?? null);
}

export function erpQuery(queryKey: string): RetrievalResult {
  const hit = STUB_ERP[queryKey];
  return makeResult(queryKey, "erp", hit ?? null);
}

export function externalFetch(url: string): RetrievalResult {
  return {
    source: url,
    source_type: "external",
    result: null,
    hits: 0,
  };
}

export function runRetrievalManifest(
  agentRole: string,
  _topicKeywords: string[],
): RetrievalResult[] {
  const manifest: RetrievalResult[] = [];

  manifest.push(mempalaceSearch("mempalace://drawer/team-decisions-2026-04"));

  if (agentRole === "credit_analyst") {
    manifest.push(mempalaceSearch("mempalace://drawer/credit-framework-principles"));
    manifest.push(statuteLookup("ppsa.1999/s36"));
    manifest.push(mempalaceSearch("mempalace://drawer/pmsi-vs-gsa-historical-recoveries"));
  } else if (agentRole === "recovery_specialist") {
    manifest.push(mempalaceSearch("mempalace://drawer/recovery-precedent-mythos"));
    manifest.push(statuteLookup("ppsa.1999/s74"));
    manifest.push(statuteLookup("ppsa.1999/s66"));
    manifest.push(statuteLookup("ppsa.1999/s70"));
  } else if (agentRole === "portfolio_monitor") {
    manifest.push(mempalaceSearch("mempalace://drawer/install-trade-fixture-losses"));
    manifest.push(erpQuery("erp://accounts/count_by_tier"));
    manifest.push(erpQuery("erp://portfolio/aging"));
  } else if (agentRole === "compliance_officer") {
    manifest.push(statuteLookup("fair_trading_act.1986/s9"));
    manifest.push(statuteLookup("ppsa.1999/s107"));
  } else if (agentRole === "account_manager") {
    manifest.push(erpQuery("erp://accounts/count_by_tier"));
  } else if (agentRole === "receptionist") {
    manifest.push(mempalaceSearch("mempalace://drawer/team-decisions-2026-04"));
  } else if (agentRole === "growth_lead") {
    manifest.push(mempalaceSearch("mempalace://drawer/team-decisions-2026-04"));
  } else if (agentRole === "legal_counsel") {
    for (const key of [
      "ppsa.1999/s36",
      "ppsa.1999/s66",
      "ppsa.1999/s70",
      "ppsa.1999/s74",
      "ppsa.1999/s107",
      "limitation_act.2010/s11",
    ]) {
      manifest.push(statuteLookup(key));
    }
  }

  return manifest;
}
