# Cognition — Multi-Agent Reasoning Layer

TypeScript port of the Python prototype at `Midori/prototype/reasoning/`.

Runs inside the NanoClaw agent container. Implements the multi-agent reasoning
protocol specified in `Midori/multi-agent-reasoning-001.md`.

## Module status

| Module | Ported | Notes |
|--------|--------|-------|
| `types.ts` | ✅ | All shared types / interfaces |
| `agent_card.ts` | ✅ | Genome loader + A2A envelope |
| `blackboard.ts` | ✅ | Shared workspace |
| `validator.ts` | ✅ | Claim-tag enforcer (load-bearing) |
| `retrieval.ts` | ⏳ | MemPalace MCP integration — next |
| `synthesis.ts` | ⏳ | Scoring + rotating authority — next |
| `session.ts` | ⏳ | Orchestrator lifecycle — next |
| `trace.ts` | ⏳ | Trace composition — next |
| `agent.ts` | ⏳ | Live Claude API integration — last |

## Rules

1. Validator enforces the epistemic discipline codified in `Midori/TEAM.md`.
2. No factual claim reaches output without a traceable source.
3. Every module maintains TypeScript strict-mode compliance.
4. Python prototype is the reference; this port mirrors behaviour exactly.

## Integration points

- Genomes: `Midori/palace/genomes/{agent}/001.json`
- MemPalace MCP tools: `mcp__mempalace__*` (retrieval layer)
- ERP API: `/api/accounts/*`, `/api/invoices/*` (retrieval layer)
- Existing audit log: trace writes (final integration)

## Next session commitments

1. Port `retrieval.ts` with MemPalace MCP integration
2. Port `synthesis.ts` + `session.ts` + `trace.ts`
3. Add unit tests against the same scenarios the Python prototype runs
4. Wire into the agent-runner process
