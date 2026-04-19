/**
 * LQ Council debate endpoint.
 *
 * Exposes `POST /debate` on a dedicated port. Every request spawns a
 * fresh Akechi container in the `debate_akechi` group, passes the
 * council's round payload, extracts the JSON block the agent emits, and
 * returns it to the council. Stateless per round — the council carries
 * debate state across rounds via the `context` array.
 *
 * No authentication (council manages its own auth). Bind to 127.0.0.1
 * until the droplet is live; a reverse proxy / tunnel handles TLS.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { ChildProcess } from 'child_process';

import { runContainerAgent } from './container-runner.js';
import { logger } from './logger.js';
import type { RegisteredGroup } from './types.js';

const DEBATE_GROUP: RegisteredGroup = {
  name: 'LQ Council — Akechi',
  folder: 'debate_akechi',
  trigger: '',
  added_at: new Date(0).toISOString(),
  requiresTrigger: false,
  isMain: false,
};

interface ContextEntry {
  pseudonym: string;
  round: number;
  response: string;
  confidence: number | null;
}

interface DebateRequest {
  session_id: string;
  round: number;
  role: string;
  context: ContextEntry[];
  prompt: string;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  proponent: 'Construct the strongest case FOR the proposition.',
  skeptic: 'Challenge assumptions and demand evidence.',
  devils_advocate:
    'Argue positions you may not hold, to stress-test reasoning.',
  empiricist:
    'Demand factual grounding. Flag unsupported assertions.',
  steelman: 'Strengthen opposing arguments before engaging them.',
};

function buildRoundPrompt(req: DebateRequest): string {
  const roleDesc = ROLE_DESCRIPTIONS[req.role] ?? `Role: ${req.role}`;
  const parts: string[] = [];

  parts.push(`# LQ Council Debate — Round ${req.round}`);
  parts.push('');
  parts.push(`**Session**: ${req.session_id}`);
  parts.push(`**Your assigned role**: ${req.role} — ${roleDesc}`);
  parts.push('');

  if (req.context.length > 0) {
    parts.push('## Prior rounds (anonymised)');
    parts.push('');
    for (const entry of req.context) {
      const conf =
        entry.confidence == null ? 'n/a' : `${entry.confidence}/100`;
      parts.push(
        `- **${entry.pseudonym}** (round ${entry.round}, confidence ${conf}):`,
      );
      parts.push(`  ${entry.response.replace(/\n/g, '\n  ')}`);
      parts.push('');
    }
  }

  parts.push("## This round's instruction (from the council)");
  parts.push('');
  parts.push(req.prompt);
  parts.push('');

  parts.push('## Required JSON fields for THIS round');
  parts.push('');
  parts.push('- `response` (string, required)');
  if (req.round >= 1) {
    parts.push('- `confidence` (integer 0-100, required)');
  }
  if (req.round === 2) {
    parts.push(
      '- `challenge` (object with `claim_targeted`, `counter_evidence`, `type` — one of `factual`, `logical`, `premise`)',
    );
  }
  if (req.round === 4) {
    parts.push(
      '- `position_change` (object with `changed`, `from_summary`, `to_summary`, `reason`)',
    );
  }
  parts.push('');
  parts.push(
    'Use your tools (WebSearch, MemPalace, etc.) BEFORE drafting. Then output the final JSON as a fenced ```json block. That block is what goes to the council.',
  );

  return parts.join('\n');
}

/**
 * Extracts the last ```json ...``` fenced block from the agent's reply.
 * Returns null if nothing parseable is found.
 */
function extractJsonBlock(text: string): unknown | null {
  const fenceRe = /```json\s*\n([\s\S]*?)\n```/gi;
  let lastMatch: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    lastMatch = m[1];
  }
  if (lastMatch) {
    try {
      return JSON.parse(lastMatch);
    } catch {
      // fall through
    }
  }
  // Last-ditch: try the whole trimmed body as JSON
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function buildFallbackResponse(round: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    response: 'I was unable to formulate a response for this round.',
  };
  if (round >= 1) out.confidence = 50;
  return out;
}

function validateRequest(body: unknown): DebateRequest | string {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (typeof b.session_id !== 'string') return 'session_id must be a string';
  if (typeof b.round !== 'number' || b.round < 0 || b.round > 4)
    return 'round must be an integer 0-4';
  if (typeof b.role !== 'string') return 'role must be a string';
  if (typeof b.prompt !== 'string') return 'prompt must be a string';
  if (!Array.isArray(b.context)) return 'context must be an array';
  return {
    session_id: b.session_id,
    round: b.round,
    role: b.role,
    context: b.context as ContextEntry[],
    prompt: b.prompt,
  };
}

async function handleDebate(req: DebateRequest): Promise<unknown> {
  const chatJid = `debate:${req.session_id}:${req.round}`;
  const roundPrompt = buildRoundPrompt(req);

  logger.info(
    {
      session: req.session_id,
      round: req.round,
      role: req.role,
      contextLen: req.context.length,
    },
    'Debate round received',
  );

  const output = await runContainerAgent(
    DEBATE_GROUP,
    {
      prompt: roundPrompt,
      groupFolder: DEBATE_GROUP.folder,
      chatJid,
      isMain: false,
      isScheduledTask: true,
    },
    (_proc: ChildProcess, _name: string) => {
      // no-op — debate containers are one-shot, not tracked by the queue
    },
  );

  if (output.status !== 'success' || !output.result) {
    logger.warn(
      { session: req.session_id, round: req.round, err: output.error },
      'Debate container returned error',
    );
    return buildFallbackResponse(req.round);
  }

  const parsed = extractJsonBlock(output.result);
  if (!parsed || typeof parsed !== 'object') {
    logger.warn(
      {
        session: req.session_id,
        round: req.round,
        resultPreview: output.result.slice(0, 200),
      },
      'Debate response had no parseable JSON block — using fallback',
    );
    return buildFallbackResponse(req.round);
  }

  logger.info(
    {
      session: req.session_id,
      round: req.round,
      keys: Object.keys(parsed as Record<string, unknown>),
    },
    'Debate round responded',
  );
  return parsed;
}

export function startDebateServer(port: number, host = '127.0.0.1'): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/debate') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', async () => {
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
      const validated = validateRequest(payload);
      if (typeof validated === 'string') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: validated }));
        return;
      }
      try {
        const result = await handleDebate(validated);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        logger.error({ err }, 'Debate handler threw');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(buildFallbackResponse(validated.round)));
      }
    });
  });

  server.listen(port, host, () => {
    logger.info({ port, host }, 'LQ Council debate endpoint started');
  });
}
